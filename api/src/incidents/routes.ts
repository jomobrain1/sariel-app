import { randomUUID } from 'node:crypto';
import { Membership, Tenant } from '@tilcayo/auth';
import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { Config, id, platformOnly } from '../administration/config.js';
import { roles, defaults } from '../administration/policies.js';
import { events, type StatusEvent } from '../individual/status.js';
import { profiles } from '../individual/profile.js';
import { eligible, initialIncident, severity, type Incident, type AuditEntry } from './routing.js';
import { incidentAccess, notApproved } from './access.js';

const denied=()=>createHttpError(403,'FORBIDDEN','Incident access denied.');
const missing=()=>createHttpError(404,'NOT_FOUND','Incident unavailable.');
const stale=()=>createHttpError(409,'CONFLICT','Incident changed. Reload and try again.');
const params=z.strictObject({handle:z.uuid()});
const note=z.string().trim().min(1).max(1500);
const command=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('assign'),officer:id}),
  z.strictObject({action:z.literal('acknowledge')}),
  z.strictObject({action:z.literal('dispatch'),confirmed:z.literal(true)}),
  z.strictObject({action:z.literal('note'),note}),
  z.strictObject({action:z.literal('refer'),tenant:id,note}),
  z.strictObject({action:z.literal('resolve'),note}),
]);
async function permissions(tenant:string,names:string[]){
  const config=roles.parse((await Config.findById('roles/'+tenant))?.value??{roles:defaults});
  const granted=config.roles.filter(r=>names.includes('sariel:'+r.name)).flatMap(r=>r.permissions);
  const manager=names.includes('admin')||granted.includes('incidents.manage');
  return {manager,responder:manager||granted.includes('incidents.respond')};
}
async function staff(ctx:Parameters<typeof auth.user>[0]){
  const user=auth.user(ctx);
  if(!user.tenant) throw denied();
  const access=await permissions(user.tenant.id,user.roles??[]);
  if(!access.responder) throw denied();
  if(!(await incidentAccess(user.tenant.id)).allowed) throw notApproved();
  return {id:user.id,tenant:user.tenant.id,...access};
}
type Staff=Awaited<ReturnType<typeof staff>>;
function scope(user:Staff){
  return {'incident.tenant':user.tenant,...(user.manager?{}:{'incident.officer':user.id})};
}
async function inspect(event:StatusEvent,user:Staff){
  const incident=event.incident!;
  const match=(await eligible(event,user.tenant)).find(m=>m.rule.name===incident.rule);
  const fields=new Set(match?.rule.disclose);
  return {handle:incident.handle,state:incident.state,version:incident.version,officer:incident.officer,
    ...(fields.has('category')?{category:event.category}:{}),...(fields.has('severity')?{severity:severity(event.level)}:{}),
    ...(fields.has('country')?{country:match!.country}:{}),...(fields.has('incident-reference')?{reference:event._id}:{}),
    timeline:incident.audit.filter(entry=>entry.tenant===user.tenant || entry.action.startsWith('gallery-'))};
}
export default defineRoutes(router=>{
  const authenticated=[...auth.requestMiddleware,auth.middleware];
  router.group({prefix:'/api/incidents',middleware:authenticated},()=>{
    // Lets the workspace console decide whether to show the Incidents tab.
    router.get('/access',async ctx=>{
      const user=auth.user(ctx);
      if(!user.tenant) return ctx.response.success({allowed:false,verified:false,enabled:false,responder:false});
      const [state,perm]=await Promise.all([incidentAccess(user.tenant.id),permissions(user.tenant.id,user.roles??[])]);
      return ctx.response.success({...state,allowed:state.allowed&&perm.responder,responder:perm.responder,manager:perm.manager});
    });
    router.get('/',async ctx=>{
      const user=await staff(ctx);
      const rows=await events().find(scope(user)).sort({createdAt:-1,_id:-1}).skip((Number(ctx.query.page)-1)*50).limit(50).toArray();
      return ctx.response.success(rows.map(e=>({handle:e.incident!.handle,state:e.incident!.state,officer:e.incident!.officer,createdAt:e.createdAt})));
    },{validate:{query:z.object({page:z.coerce.number().int().min(1).max(100000).default(1)})}});
    router.get('/:handle',async ctx=>{
      const user=await staff(ctx);
      const event=await events().findOne({...scope(user),'incident.handle':String(ctx.params.handle)});
      if(!event) throw missing();
      return ctx.response.success(await inspect(event,user));
    },{validate:{params}});
    router.get('/:handle/disclosure',async ctx=>{
      const user=await staff(ctx);
      const event=await events().findOne({...scope(user),'incident.handle':String(ctx.params.handle),active:true});
      if(!event) throw missing();
      if(!(await eligible(event,user.tenant)).some(m=>m.rule.name===event.incident!.rule)) throw denied();
      const profile=await profiles().findOne({_id:event.owner});
      const grant=profile?.disclosure.find(g=>g.tenantId===user.tenant);
      return ctx.response.success(Object.fromEntries((grant?.fields??[]).map(k=>[k,profile?.information[k]])));
    },{validate:{params}});
    router.post('/:handle/actions',async ctx=>{
      const user=await staff(ctx);
      const event=await events().findOne({...scope(user),'incident.handle':String(ctx.params.handle),active:true});
      if(!event?.incident) throw missing();
      const incident=event.incident;
      const body=ctx.body as {version:number;command:z.output<typeof command>};
      if(body.version!==incident.version) throw stale();
      const cmd=body.command;
      const change:Partial<Incident>={};
      const at=new Date();
      const audit:AuditEntry[]=[{at,tenant:user.tenant,actor:user.id,actorName:auth.user(ctx).name,action:cmd.action}];
      if(cmd.action==='assign'){
        if(!user.manager) throw denied();
        const membership=await Membership.first({tenantId:user.tenant,userId:cmd.officer,suspendedAt:null,deletedAt:null});
        if(!membership || !(await permissions(user.tenant,membership.roles)).responder) throw denied();
        change.officer=cmd.officer;
      }else if(cmd.action==='acknowledge'){
        if(incident.state!=='assigned') throw stale();
        change.state='acknowledged';
        change.officer=incident.officer??user.id;
      }else if(cmd.action==='dispatch'){
        if(incident.state!=='acknowledged' || incident.audit.some(e=>e.action==='dispatch')) throw stale();
      }else if(cmd.action==='refer'){
        if(!user.manager||cmd.tenant===user.tenant) throw denied();
        const source=(await eligible(event,user.tenant)).find(m=>m.rule.name===incident.rule);
        const [target]=await eligible(event,cmd.tenant);
        if(!source?.rule.referralTenantIds.includes(cmd.tenant)||!target) throw denied();
        Object.assign(change,{tenant:target.tenant,officer:null,handle:randomUUID(),rule:target.rule.name,state:'assigned'});
        audit[0].note=cmd.note;
        audit.push({at,tenant:target.tenant,action:'received-referral'});
      }else{
        audit[0].note=cmd.note;
        if(cmd.action==='resolve'){
          if(incident.state!=='acknowledged') throw stale();
          change.state='resolved';
        }
      }
      const updated=await events().updateOne({_id:event._id,...scope(user),'incident.version':body.version,active:true},
        {$set:{...Object.fromEntries(Object.entries(change).map(([k,v])=>['incident.'+k,v])),active:change.state!=='resolved'},
          $inc:{'incident.version':1},$push:{'incident.audit':{$each:audit}}});
      if(!updated.modifiedCount) throw stale();
      return ctx.response.noContent();
    },{validate:{params,body:z.strictObject({version:z.number().int().nonnegative(),command})}});
  });
  router.group({prefix:'/api/platform/incidents',middleware:[...authenticated,platformOnly]},()=>{
    const pending={active:true,$or:[{'incident.state':'pending'},{incident:{$exists:false as const}}]};
    router.get('/',async ctx=>{
      const page=Number(ctx.query.page);
      const perPage=25;
      const search=String(ctx.query.search);
      const group=String(ctx.query.group);
      const level=Number(ctx.query.level);
      const groupFilter=group==="all"?{}:{group};
      const levelFilter=level?{level}:{};
      const [result]=await events().aggregate([
        {$match:{level:{$gte:2}}},
        {$sort:{createdAt:-1,_id:-1}},
        {$set:{accountId:{$convert:{input:'$owner',to:'objectId',onError:null,onNull:null}},
          orgId:{$convert:{input:'$incident.tenant',to:'objectId',onError:null,onNull:null}}}},
        {$lookup:{from:'users',localField:'accountId',foreignField:'_id',pipeline:[{$project:{name:1,email:1}}],as:'account'}},
        {$lookup:{from:Tenant.raw.collection.name,localField:'orgId',foreignField:'_id',pipeline:[{$project:{name:1}}],as:'org'}},
        {$project:{_id:0,reference:'$_id',level:1,category:1,note:1,createdAt:1,channel:1,location:1,
          version:'$incident.version',signals:{$map:{input:{$filter:{input:{$ifNull:['$incident.audit',[]]},as:'e',
            cond:{$in:['$$e.action',['gallery-road','gallery-bridge','gallery-mountain','photo-link-spread','acknowledge','dispatch','contact','note','refer','resolve']]}}},
            as:'e',in:{action:'$$e.action',at:'$$e.at',actorName:'$$e.actorName',note:'$$e.note'}}},
          account:{$ifNull:[{$arrayElemAt:['$account',0]},null]},
          organization:{$ifNull:[{$arrayElemAt:['$org.name',0]},null]},
          state:{$ifNull:['$incident.state',{$cond:['$active','pending','resolved']}]}}}
        ,{$set:{group:{$switch:{branches:[
          {case:{$eq:['$state','pending']},then:'open'},
          {case:{$eq:['$state','resolved']},then:'resolved'}],default:'progress'}}}},
        ...(search?[{$match:{$or:['reference','category','account.name','account.email','organization'].map(field=>({
          [field]:{$regex:search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'}
        }))}}]:[]),
        {$facet:{
          items:[{$match:{...groupFilter,...levelFilter}},{$skip:(page-1)*perPage},{$limit:perPage}],
          total:[{$match:{...groupFilter,...levelFilter}},{$count:'value'}],
          levels:[{$match:groupFilter},{$group:{_id:'$level',count:{$sum:1}}}],
          groups:[{$match:levelFilter},{$group:{_id:'$group',count:{$sum:1}}}]
        }}
      ]).toArray();
      const counts=(rows:{_id:string|number;count:number}[])=>Object.fromEntries(rows.map(r=>[r._id,r.count]));
      const total=result.total[0]?.value??0;
      return ctx.response.success({items:result.items,total,hasNext:page*perPage<total,levels:counts(result.levels),groups:counts(result.groups)});
    },{validate:{query:z.object({page:z.coerce.number().int().min(1).max(100000).default(1),search:z.string().trim().max(100).default(''),
      group:z.enum(['all','open','progress','resolved']).default('all'),level:z.coerce.number().int().refine(n=>[0,2,3,4,5].includes(n)).default(0)})}});
    const version=z.number().int().nonnegative();
    const responseAction=z.discriminatedUnion('action',[
      z.strictObject({action:z.literal('acknowledge'),version}),
      z.strictObject({action:z.literal('dispatch'),confirmed:z.literal(true),version}),
      // The platform team reached the person (or someone with them).
      z.strictObject({action:z.literal('contact'),version,note:note.optional()}),
      z.strictObject({action:z.literal('note'),version,note}),
      z.strictObject({action:z.literal('resolve'),version,note}),
    ]);
    router.post('/:reference/response',async ctx=>{
      const body=ctx.body as z.output<typeof responseAction>;
      const filter={_id:String(ctx.params.reference),active:true,'incident.version':body.version};
      const event=await events().findOne(filter);
      if(!event?.incident) throw stale();
      const {audit}=event.incident;
      // Acknowledge and dispatch happen once, in order; contact, notes and resolving can happen at any point.
      if(body.action==='acknowledge' && audit.some(e=>e.action==='acknowledge')) throw stale();
      if(body.action==='dispatch' && (audit.some(e=>e.action==='dispatch') || !audit.some(e=>e.action==='acknowledge'))) throw stale();
      const actor=auth.user(ctx);
      const entry={at:new Date(),action:body.action,actor:actor.id,actorName:actor.name,...('note' in body && body.note?{note:body.note}:{})};
      const resolving=body.action==='resolve';
      const update=await events().updateOne(filter,{$inc:{'incident.version':1},$push:{'incident.audit':entry},
        ...(resolving?{$set:{'incident.state':'resolved' as const,active:false}}:{})});
      if(!update.modifiedCount) throw stale();
      // The person's status shows their highest open incident, so resolving one would leave them red while
      // another stays open. The platform team sees every incident: resolving closes all of the person's open ones.
      let alsoClosed=0;
      if(resolving){
        const others={owner:event.owner,active:true,_id:{$ne:event._id}};
        const linked={...entry,note:`Resolved together with incident ${event._id.slice(0,8)}: ${body.note}`};
        alsoClosed=(await events().updateMany(others,{$inc:{'incident.version':1},$push:{'incident.audit':linked},
          $set:{'incident.state':'resolved' as const,active:false}})).modifiedCount;
      }
      return resolving ? ctx.response.success({alsoClosed}) : ctx.response.noContent();
    },{validate:{params:z.object({reference:z.string().regex(/^[a-f0-9]{64}$/)}),body:responseAction}});
    router.get('/pending',async ctx=>{
      const items=await events().find(pending,{projection:{_id:1,createdAt:1}}).sort({createdAt:1,_id:1})
        .skip((Number(ctx.query.page)-1)*50).limit(50).toArray();
      return ctx.response.success(items);
    },{validate:{query:z.object({page:z.coerce.number().int().min(1).max(100000).default(1)})}});
    router.post('/:reference/retry',async ctx=>{
      const filter={...pending,_id:String(ctx.params.reference)};
      const event=await events().findOne(filter);
      if(!event) throw missing();
      const incident=await initialIncident(event);
      if(incident.tenant){
        incident.audit=[...(event.incident?.audit??[{at:event.createdAt,action:'created'}]),
          {at:new Date(),action:'routed',tenant:incident.tenant,actor:auth.user(ctx).id}];
        if(!(await events().updateOne({...filter,'incident.version':event.incident?.version??{$exists:false}},{$set:{incident}})).modifiedCount) throw stale();
      }
      return ctx.response.success({state:incident.state});
    },{validate:{params:z.object({reference:z.string().regex(/^[a-f0-9]{64}$/)})}});
  });
});
