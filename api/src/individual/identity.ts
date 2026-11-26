import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, currentTenantScope, defineRoutes, rateLimit, type Middleware } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from './account.js';

type Credential = {digest:string; level:number};
type Identity = {_id:string; selector:string; codes:Credential[]};
const identities=()=>mongoose.connection.collection<Identity>('sariel_safety_identities');
const token=()=>randomBytes(32).toString('base64url');
const hash=(secret:string)=>createHash('sha256').update(secret).digest('hex');
export const credential=z.strictObject({selector:z.string().regex(/^[\w-]{43}$/),secret:z.string().regex(/^[\w-]{43}$/)});
const mainDomain:Middleware=(ctx,next)=>{
  if(currentTenantScope()?.tenantId) throw createHttpError(404,'NOT_FOUND','Unavailable.');
  return next();
};
export const publicReporting=[...auth.requestMiddleware,mainDomain,rateLimit({windowMs:60_000,max:30})];
export async function resolveCredential(input:z.infer<typeof credential>){
  const digest=hash(input.secret);
  const row=await identities().findOne({selector:input.selector,'codes.digest':digest});
  const code=row?.codes.find(item=>item.digest===digest);
  if(!row || !code || !await mongoose.connection.collection('users').findOne({
    _id:new mongoose.Types.ObjectId(row._id),deletedAt:null,suspendedAt:null},{projection:{_id:1}}))
    throw createHttpError(403,'INVALID_CREDENTIAL','Credential unavailable.');
  return {owner:row._id,level:code.level};
}
export default defineRoutes(router=>{
  router.group({prefix:'/api/individual',middleware:individual},()=>{
    router.post('/safety-identity',async ctx=>{
      const selector=token();
      const codes=Array.from({length:6},(_,level)=>({level,secret:token()}));
      await identities().createIndex({selector:1},{unique:true});
      await identities().replaceOne({_id:auth.user(ctx).id},{selector,codes:codes.map(c=>({level:c.level,digest:hash(c.secret)}))},{upsert:true});
      return ctx.response.created({selector,codes,reportUrl:'/safety/index.html#'+selector});
    });
    router.delete('/safety-identity',async ctx=>{
      await identities().deleteOne({_id:auth.user(ctx).id});
      return ctx.response.noContent();
    });
  });
  router.group({prefix:'/api/auth/safety',middleware:publicReporting},()=>{
    router.post('/validate',async ctx=>{
      const {level}=await resolveCredential(ctx.body as z.infer<typeof credential>);
      return ctx.response.success({level});
    },{validate:{body:credential}});
  });
});
