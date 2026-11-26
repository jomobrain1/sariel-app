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
  _id:string; owner:string; level:number; channel:'account'|'gateway'; createdAt:Date;
  active:boolean; category:string; country?:string; fingerprint:string;
}
export const events=()=>mongoose.connection.collection<StatusEvent>('sariel_safety_events');
export async function recordStatus(owner:string,report:Report,channel:StatusEvent['channel']){
  const key=createHash('sha256').update(owner+'/'+report.requestId).digest('hex');
  const fingerprint=JSON.stringify([report.level,report.category,report.country??null,channel]);
  const event:StatusEvent={_id:key,owner,level:report.level,category:report.category,country:report.country,
    active:report.level>=2,channel,createdAt:new Date(),fingerprint};
  try { await events().insertOne(event); }
  catch(error){
    if(!(error instanceof mongoose.mongo.MongoServerError && error.code===11000)) throw error;
    if((await events().findOne({_id:key}))?.fingerprint!==fingerprint)
      throw createHttpError(409,'CONFLICT','Request ID already used for a different report.');
  }
  return {reference:key,level:report.level,status:levels[report.level]};
}
export default defineRoutes(router=>{
  router.group({prefix:'/api/individual',middleware:individual},()=>{
    router.post('/status',async ctx=>ctx.response.success(await recordStatus(auth.user(ctx).id,ctx.body as Report,'account')),
      {validate:{body:update}});
    router.get('/status',async ctx=>{
      const owner=auth.user(ctx).id;
      // An unresolved report outranks every routine update, including UNKNOWN.
      const highest=await events().find({owner,active:true}).sort({level:-1,createdAt:-1,_id:-1}).limit(1).next();
      const latest=highest??await events().find({owner}).sort({createdAt:-1,_id:-1}).limit(1).next();
      const level=latest && (latest.active || latest.level<2)?latest.level:0;
      return ctx.response.success({level,status:levels[level],reportedAt:latest?.createdAt??null});
    });
    router.get('/status/history',async ctx=>{
      const history=await events().find({owner:auth.user(ctx).id},{projection:{_id:1,level:1,active:1,channel:1,createdAt:1}})
        .sort({createdAt:-1,_id:-1}).limit(100).toArray();
      return ctx.response.success(history);
    });
  });
});
