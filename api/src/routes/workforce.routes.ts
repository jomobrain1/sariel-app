import { randomBytes, createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { defineRoutes, createHttpError } from '@tilcayo/core';
import { Membership, Tenant } from '@tilcayo/auth';
import { z } from 'zod';
import { auth } from '../auth.js';
import { Config, id, label, platformOnly, profile, requireTenant, save } from '../administration/config.js';
import { defaults, roles, routing } from '../administration/policies.js';

const deny = () => createHttpError(403,'FORBIDDEN','Workspace permission required');
const invalid = (message:string) => createHttpError(422,'VALIDATION_ERROR',message);
const Invitation = mongoose.model('SarielInvitation',new mongoose.Schema({
  _id:String, tenantId:{type:String,required:true}, account:{type:String,required:true}, role:{type:String,required:true},
  expiresAt:{type:Date,required:true,expires:0},
}));
async function audit(tenant: string, actor: string, action: string, subject: string) {
  const objectId = (value: string) => new mongoose.Types.ObjectId(value);
  await mongoose.connection.collection('tilcayo_tenant_audit').insertOne({
    tenantId: objectId(tenant), actorId: objectId(actor), subjectId: objectId(subject), action, createdAt: new Date(),
  });
}
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
async function tenantRoles(tenantId:string) {
  return roles.parse((await Config.findById('roles/'+tenantId))?.value ?? {roles:defaults}).roles;
}
export default defineRoutes(router=>{
  const authenticated=[...auth.requestMiddleware,auth.middleware];
  router.group({prefix:'/api/sariel/admin',middleware:[...authenticated,platformOnly]},()=>{
    for (const [kind,schema] of [['roles',roles],['routing',routing]] as const){
      const params=z.object({id});
      router.get('/'+kind+'/:id',async ctx=>{
        await requireTenant(id.parse(ctx.params.id));
        return ctx.response.success(await Config.findById(kind+'/'+id.parse(ctx.params.id)).select('value revision'));
      },{validate:{params}});
      router.put('/'+kind+'/:id',async ctx=>{
        const tenantId=id.parse(ctx.params.id);
        const tenant=await requireTenant(tenantId);
        const {revision,value}=ctx.body as {revision:number;value:unknown};
        if(kind==='routing'){
          const {rules}=routing.parse(value);
          if(rules.length){
            const scope=profile.safeParse((await Config.findById('organization/'+tenantId))?.value);
            if(!scope.success||scope.data.verification!=='verified'||!scope.data.available||tenant.status!=='active') throw invalid('Verify and activate an available organization first.');
            for(const rule of rules){
              if(rule.countries.some(c=>!scope.data.countries.includes(c))||rule.capabilities.some(c=>!scope.data.capabilities.includes(c))||rule.incidentCategories.some(c=>!scope.data.incidentCategories.includes(c))) throw invalid('Rule exceeds verified organization scope.');
              for(const target of new Set(rule.referralTenantIds)){
                const other=await Config.findById('organization/'+target);
                if(target===tenantId||other?.value?.verification!=='verified'||!other?.value?.available||!await Tenant.first({_id:target,status:'active',deletedAt:null})) throw invalid('Referral requires another active, verified, available organization.');
              }
            }
          }
        }
        const record=await save(kind+'/'+tenantId,revision,value,auth.user(ctx).id);
        return ctx.response.success({revision:record.revision,value:record.value});
      },{validate:{params,body:z.strictObject({revision:z.number().int().nonnegative(),value:schema})}});
    }
    router.post('/invitations/:id',async ctx=>{
      const tenantId=id.parse(ctx.params.id);
      const {email,role}=ctx.body as {email:string;role:string};
      const tenant=await requireTenant(tenantId);
      if(tenant.status!=='active'||!(await tenantRoles(tenantId)).some(r=>r.name===role)) throw invalid('Select an active tenant and configured role.');
      const account=await mongoose.connection.collection('users').findOne({email,deletedAt:null,suspendedAt:null},{projection:{_id:1}});
      if(!account) throw invalid('Create the individual account first.');
      if(await Membership.first({tenantId,userId:account._id})) throw invalid('Manage this existing membership in staff access.');
      const token=randomBytes(32).toString('hex');
      await Invitation.create({_id:digest(token),tenantId,account:String(account._id),role,expiresAt:new Date(Date.now()+86400000)});
      await audit(tenantId,auth.user(ctx).id,'staff.invited',String(account._id));
      return ctx.response.success({token});
    },{validate:{params:z.object({id}),body:z.strictObject({email:z.email().toLowerCase(),role:label})}});
    router.put('/staff/:id/:member',async ctx=>{
      const {role}=ctx.body as {role:string|null};
      await requireTenant(id.parse(ctx.params.id));
      if(role && !(await tenantRoles(id.parse(ctx.params.id))).some(r=>r.name===role)) throw invalid('Unknown staff role.');
      const member=await Membership.raw.findOneAndUpdate({tenantId:id.parse(ctx.params.id),userId:id.parse(ctx.params.member),deletedAt:null,roles:{$ne:'admin'}},{$set:{roles:role?['sariel:'+role]:[],suspendedAt:role?null:new Date()},$inc:{sessionVersion:1}});
      if(!member) throw invalid('Select a non-administrator staff member.');
      await audit(id.parse(ctx.params.id),auth.user(ctx).id,role?'staff.role-assigned':'staff.suspended',id.parse(ctx.params.member));
      return ctx.response.noContent();
    },{validate:{params:z.object({id,member:id}),body:z.strictObject({role:label.nullable()})}});
  });
  router.group({prefix:'/api/sariel/staff',middleware:authenticated},()=>{
    router.post('/accept',async ctx=>{
      const user=auth.user(ctx);
      if(user.tenant) throw deny();
      const invite=await Invitation.findOne({_id:digest((ctx.body as {token:string}).token),account:user.id,expiresAt:{$gt:new Date()}});
      if(!invite||!await Tenant.first({_id:invite.tenantId,deletedAt:null,status:'active'})||!(await tenantRoles(invite.tenantId)).some(r=>r.name===invite.role)) throw invalid('Invitation unavailable.');
      await Membership.raw.updateOne({tenantId:invite.tenantId,userId:user.id},{$setOnInsert:{roles:['sariel:'+invite.role]}},{upsert:true});
      await invite.deleteOne();
      await audit(invite.tenantId,user.id,'staff.invitation-accepted',user.id);
      return ctx.response.noContent();
    },{validate:{body:z.strictObject({token:z.string().regex(/^[a-f0-9]{64}$/)})}});
    router.get('/workspace',async ctx=>{
      const user=auth.user(ctx);
      if(!user.tenant) throw deny();
      const tenant=user.tenant.id;
      const granted=new Set((await tenantRoles(tenant)).filter(r=>user.roles?.includes('sariel:'+r.name)).flatMap(r=>r.permissions));
      const admin=user.roles?.includes('admin');
      if(!admin&&!granted.size) throw deny();
      const scope=admin||granted.has('scope.read')?(await Config.findById('organization/'+tenant))?.value:undefined;
      const rules=admin||granted.has('routing.read')?(await Config.findById('routing/'+tenant))?.value:undefined;
      return ctx.response.success({scope,routing:rules});
    });
  });
});
