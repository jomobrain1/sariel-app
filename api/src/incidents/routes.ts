import { randomUUID } from 'node:crypto';
import { Membership } from '@tilcayo/auth';
import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { Config, id, platformOnly } from '../administration/config.js';
import { roles, defaults } from '../administration/policies.js';
import { events, type StatusEvent } from '../individual/status.js';
import { profiles } from '../individual/profile.js';
import { eligible, initialIncident, severity, type Incident, type AuditEntry } from './routing.js';

const denied=()=>createHttpError(403,'FORBIDDEN','Incident access denied.');
const missing=()=>createHttpError(404,'NOT_FOUND','Incident unavailable.');
const stale=()=>createHttpError(409,'CONFLICT','Incident changed. Reload and try again.');
const params=z.strictObject({handle:z.uuid()});
const note=z.string().trim().min(1).max(1500);
const command=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('assign'),officer:id}),
  z.strictObject({action:z.literal('acknowledge')}),
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
    timeline:incident.audit.filter(entry=>entry.tenant===user.tenant)};
}
export default defineRoutes(router=>{
  const authenticated=[...auth.requestMiddleware,auth.middleware];
  router.group({prefix:'/api/incidents',middleware:authenticated},()=>{
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
      const audit:AuditEntry[]=[{at,tenant:user.tenant,actor:user.id,action:cmd.action}];
      if(cmd.action==='assign'){
        if(!user.manager) throw denied();
        const membership=await Membership.first({tenantId:user.tenant,userId:cmd.officer,suspendedAt:null,deletedAt:null});
        if(!membership || !(await permissions(user.tenant,membership.roles)).responder) throw denied();
        change.officer=cmd.officer;
      }else if(cmd.action==='acknowledge'){
        if(incident.state!=='assigned') throw stale();
        change.state='acknowledged';
        change.officer=incident.officer??user.id;
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
        if(!(await events().updateOne(filter,{$set:{incident}})).modifiedCount) throw stale();
      }
      return ctx.response.success({state:incident.state});
    },{validate:{params:z.object({reference:z.string().regex(/^[a-f0-9]{64}$/)})}});
  });
});
