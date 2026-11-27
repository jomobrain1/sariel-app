import { initialIncident, pendingIncident, type Incident } from '../incidents/routing.js';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { country, label } from '../administration/config.js';
import { individual } from './account.js';

export const levels=['UNKNOWN','CONFIRMED_SAFE','ASSISTANCE_NEEDED','SAFETY_CONCERN','SERIOUS_DANGER','CRITICAL_DANGER'] as const;
export const reportInput=z.strictObject({
  requestId:z.uuid(), category:label.default('welfare'), country:country.optional(),
});
const update=reportInput.extend({level:z.number().int().min(0).max(5)});
export type Report=z.output<typeof update>;
export interface StatusEvent {
  _id:string; owner:string; level:number; channel:'account'|'gateway'|'welfare'|'image'; createdAt:Date;
  incident?:Incident; active:boolean; category:string; country?:string; fingerprint:string;
}
export const events=()=>mongoose.connection.collection<StatusEvent>('sariel_safety_events');
export async function recordStatus(owner:string,report:Report,channel:StatusEvent['channel']){
  const key=createHash('sha256').update(owner+'/'+report.requestId).digest('hex');
  const fingerprint=JSON.stringify([report.level,report.category,report.country??null,channel]);
  const event:StatusEvent={_id:key,owner,level:report.level,category:report.category,country:report.country,
    active:report.level>=2,channel,createdAt:new Date(),fingerprint};
  if(event.active) event.incident=pendingIncident(event);
  try { await events().insertOne(event); }
  catch(error){
    if(!(error instanceof mongoose.mongo.MongoServerError && error.code===11000)) throw error;
    const existing=await events().findOne({_id:key});
    if(existing?.fingerprint!==fingerprint)
      throw createHttpError(409,'CONFLICT','Request ID already used for a different report.');
  }
  // Commit intake first. If routing is interrupted, the pending queue and a retry
  // with the original request ID can both recover the same report.
  if(event.active){
    const pending=await events().findOne({_id:key,'incident.state':'pending'});
    if(pending){
      const assigned=await initialIncident(pending);
      if(assigned.tenant) await events().updateOne({_id:key,'incident.state':'pending','incident.version':pending.incident!.version},{$set:{incident:assigned}});
    }
  }
  return {reference:key,level:report.level,status:levels[report.level]};
}
// An unresolved report outranks every routine update, including UNKNOWN.
// Pass channels to limit which reports count, e.g. to keep discreet link reports out of circle views.
export async function currentStatus(owner:string,channels?:StatusEvent['channel'][]){
  const filter={owner,...(channels?{channel:{$in:channels}}:{})};
  const highest=await events().find({...filter,active:true}).sort({level:-1,createdAt:-1,_id:-1}).limit(1).next();
  const latest=highest??await events().find(filter).sort({createdAt:-1,_id:-1}).limit(1).next();
  const level=latest && (latest.active || latest.level<2)?latest.level:0;
  return {level,status:levels[level],reportedAt:latest?.createdAt??null};
}
// Lets other features (welfare check-ins) react when someone confirms they're safe from the dashboard.
const safeListeners:((owner:string)=>Promise<void>)[]=[];
export function onSafeCheckIn(listener:(owner:string)=>Promise<void>){ safeListeners.push(listener); }
export default defineRoutes(router=>{
  router.group({prefix:'/api/individual',middleware:individual},()=>{
    router.post('/status',async ctx=>{
      const owner=auth.user(ctx).id;
      const result=await recordStatus(owner,ctx.body as Report,'account');
      if(result.level===1) await Promise.all(safeListeners.map(listener=>listener(owner).catch(()=>undefined)));
      return ctx.response.success(result);
    },{validate:{body:update}});
    router.get('/status',async ctx=>ctx.response.success(await currentStatus(auth.user(ctx).id)));
    router.get('/status/history',async ctx=>{
      const history=await events().find({owner:auth.user(ctx).id},{projection:{_id:1,level:1,active:1,channel:1,createdAt:1}})
        .sort({createdAt:-1,_id:-1}).limit(100).toArray();
      return ctx.response.success(history);
    });
  });
});
