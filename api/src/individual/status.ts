import { initialIncident, pendingIncident, type Incident } from '../incidents/routing.js';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { registerJob } from '../jobs/worker.js';
import { country, label } from '../administration/config.js';
import { individual } from './account.js';

export const levels=['UNKNOWN','CONFIRMED_SAFE','ASSISTANCE_NEEDED','SAFETY_CONCERN','SERIOUS_DANGER','CRITICAL_DANGER'] as const;
// "Travelling" is a level-1 (not danger) update with this category, so it never opens an incident.
export const TRAVELLING='travelling';
const coordinates=z.strictObject({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracy:z.number().min(0).max(100_000),
  recordedAt:z.iso.datetime({offset:true}).transform(value=>new Date(value)).refine(value=>value.getTime()<=Date.now()+300_000,'Location time is in the future.').optional(),
  source:z.enum(['report','last-known']).optional()});
export interface EventLocation { latitude:number; longitude:number; accuracy:number; recordedAt:Date; source:'report'|'last-known' }
export const reportInput=z.strictObject({
  requestId:z.uuid(), category:label.default('welfare'), country:country.optional(),
});
const update=reportInput.extend({level:z.number().int().min(0).max(5),
  // Optional description of what is happening, shown to the administrators handling the incident.
  note:z.string().trim().max(1000).optional(),
  // Where the person was when reporting danger (asked from the browser at that moment).
  location:coordinates.optional()});
export type Report=z.output<typeof update>;
export interface StatusEvent {
  notificationDelivery?:{state:'pending'|'done';attempts:number;nextAttemptAt:Date;lockedUntil:Date|null;lastError:string|null};
  _id:string; owner:string; level:number; channel:'account'|'gateway'|'welfare'|'image'; createdAt:Date;
  incident?:Incident; active:boolean; category:string; country?:string; note?:string; fingerprint:string; location?:EventLocation;
}
export const events=()=>mongoose.connection.collection<StatusEvent>('sariel_safety_events');
// Lets other features (platform notifications) react to new incidents without a circular import.
const incidentListeners:((event:StatusEvent)=>Promise<void>)[]=[];
let notificationIndexes:Promise<unknown>|undefined;
export function onIncidentCreated(listener:(event:StatusEvent)=>Promise<void>){ incidentListeners.push(listener); }
export async function recordStatus(owner:string,report:Report,channel:StatusEvent['channel']){
  const key=createHash('sha256').update(owner+'/'+report.requestId).digest('hex');
  const fingerprint=JSON.stringify([report.level,report.category,report.country??null,channel,...(report.note?[report.note]:[])]);
  const event:StatusEvent={_id:key,owner,level:report.level,category:report.category,country:report.country,
    active:report.level>=2,channel,createdAt:new Date(),fingerprint,...(report.note?{note:report.note}:{})};
  if(event.active){
    event.incident=pendingIncident(event);
    event.notificationDelivery={state:'pending',attempts:0,nextAttemptAt:event.createdAt,lockedUntil:null,lastError:null};
    // Danger reports carry a location for responders: the one sent with the report, else the last shared point.
    const location=report.location ? {...report.location,recordedAt:report.location.recordedAt??event.createdAt,source:report.location.source??'report' as const} : await lastLocation(owner);
    if(location) event.location=location;
  }
  try { await events().insertOne(event); }
  catch(error){
    if(!(error instanceof mongoose.mongo.MongoServerError && error.code===11000)) throw error;
    const existing=await events().findOne({_id:key});
    if(existing?.fingerprint!==fingerprint)
      throw createHttpError(409,'CONFLICT','Request ID already used for a different report.');
  }
  if(event.active) await deliverIncidentNotifications(key,new Date(),true);
  // Commit intake first. If routing is interrupted, the pending queue and a retry
  // with the original request ID can both recover the same report.
  if(event.active){
    const pending=await events().findOne({_id:key,'incident.state':'pending'});
    if(pending){
      const assigned=await initialIncident(pending);
      if(assigned.tenant) await events().updateOne({_id:key,'incident.state':'pending','incident.version':pending.incident!.version},{$set:{incident:assigned}});
    }
  }
  const saved=event.active ? await events().findOne({_id:key},{projection:{notificationDelivery:1}}) : null;
  return {reference:key,level:report.level,status:levels[report.level],notificationsPending:saved?.notificationDelivery?.state==='pending'};
}
// Intake and pending work are one atomic document. A replay always uses the stored event.
export async function deliverIncidentNotifications(reference:string,now=new Date(),force=false) {
  const row=await events().findOneAndUpdate({_id:reference,'notificationDelivery.state':'pending',
    ...(force?{}:{'notificationDelivery.nextAttemptAt':{$lte:now}}),
    $or:[{'notificationDelivery.lockedUntil':null},{'notificationDelivery.lockedUntil':{$lte:now}}]},
    {$set:{'notificationDelivery.lockedUntil':new Date(now.getTime()+60_000)},$inc:{'notificationDelivery.attempts':1}},
    {returnDocument:'after'});
  if(!row) return;
  const outcomes=await Promise.allSettled(incidentListeners.map(listener=>listener(row)));
  const failed=outcomes.some(result=>result.status==='rejected');
  await events().updateOne({_id:reference,'notificationDelivery.lockedUntil':row.notificationDelivery!.lockedUntil},
    {$set:{'notificationDelivery.state':failed?'pending':'done','notificationDelivery.lockedUntil':null,
      'notificationDelivery.nextAttemptAt':new Date(now.getTime()+Math.min(3600,30*2**Math.min(row.notificationDelivery!.attempts,7))*1000),
      'notificationDelivery.lastError':failed?'Notification creation incomplete; retry scheduled.':null}});
}
export async function recoverIncidentNotifications(now=new Date(),limit=25) {
  notificationIndexes??=events().createIndex({'notificationDelivery.state':1,'notificationDelivery.nextAttemptAt':1}).catch(error=>{notificationIndexes=undefined;throw error;});
  await notificationIndexes;
  const rows=await events().find({'notificationDelivery.state':'pending','notificationDelivery.nextAttemptAt':{$lte:now}})
    .sort({'notificationDelivery.nextAttemptAt':1}).limit(limit).toArray();
  for(const row of rows) await deliverIncidentNotifications(row._id,now);
  return rows.length;
}
registerJob('incident-notifications',15_000,now=>recoverIncidentNotifications(now));
async function lastLocation(owner:string):Promise<EventLocation|undefined>{
  const point=await mongoose.connection.collection('sariel_locations').find({owner}).sort({recordedAt:-1}).limit(1).next();
  return point ? {latitude:point.latitude,longitude:point.longitude,accuracy:point.accuracy,recordedAt:point.recordedAt,source:'last-known'} : undefined;
}
// An unresolved report outranks every routine update. Without one, people are Confirmed safe
// (also when they've never reported, or after an incident is resolved) until they say otherwise.
// Only an explicit UNKNOWN (a missed scheduled check-in) shows Unknown.
// Pass channels to limit which reports count.
export async function currentStatus(owner:string,channels?:StatusEvent['channel'][]){
  const filter={owner,...(channels?{channel:{$in:channels}}:{})};
  const highest=await events().find({...filter,active:true}).sort({level:-1,createdAt:-1,_id:-1}).limit(1).next();
  const latest=highest??await events().find(filter).sort({createdAt:-1,_id:-1}).limit(1).next();
  const level=!latest ? 1 : latest.active || latest.level<2 ? latest.level : 1;
  const travelling=level===1 && latest?.level===1 && latest.category===TRAVELLING;
  return {level,status:travelling?'TRAVELLING':levels[level],reportedAt:latest?.createdAt??null};
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
      const history=await events().find({owner:auth.user(ctx).id},{projection:{_id:1,level:1,active:1,channel:1,category:1,createdAt:1,note:1}})
        .sort({createdAt:-1,_id:-1}).limit(100).toArray();
      return ctx.response.success(history);
    });
  });
});
