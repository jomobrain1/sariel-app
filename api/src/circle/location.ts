import mongoose from 'mongoose';
import { createHttpError, defineRoutes, rateLimit } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from '../individual/account.js';
import { access, objectId } from './members.js';

export const RETENTION_DAYS = 30;
export const SHARE_INTERVAL_MINUTES = 5;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

interface LocationPoint {
  _id:string; owner:string; latitude:number; longitude:number; accuracy:number; recordedAt:Date; receivedAt:Date;
}
export interface MonitoringSettings { _id:string; locationSharing:boolean; updatedAt:Date }
export const locations = () => mongoose.connection.collection<LocationPoint>('sariel_locations');
export const settings = () => mongoose.connection.collection<MonitoringSettings>('sariel_monitoring_settings');

let indexed: Promise<unknown> | undefined;
function ensureIndexes() {
  indexed ??= Promise.all([
    locations().createIndex({owner:1, recordedAt:-1}),
    // Points older than the retention window are deleted automatically.
    locations().createIndex({recordedAt:1}, {expireAfterSeconds:RETENTION_DAYS * 24 * 60 * 60}),
  ]).catch(error => { indexed = undefined; throw error; });
  return indexed;
}
const view = (p:LocationPoint) => ({latitude:p.latitude, longitude:p.longitude, accuracy:p.accuracy, recordedAt:p.recordedAt});
export async function lastKnownLocation(owner:string) {
  const latest = await locations().find({owner}).sort({recordedAt:-1}).limit(1).next();
  return latest ? view(latest) : null;
}

const point = z.strictObject({
  clientId:z.uuid(),
  latitude:z.number().min(-90).max(90),
  longitude:z.number().min(-180).max(180),
  accuracy:z.number().min(0).max(100_000),
  recordedAt:z.iso.datetime({offset:true}).transform(value => new Date(value)),
});
const batch = z.strictObject({points:z.array(point).min(1).max(100)});

export default defineRoutes(router => {
  router.group({prefix:'/api/individual', middleware:individual}, () => {
    router.get('/location/settings', async ctx => {
      const row = await settings().findOne({_id:auth.user(ctx).id});
      return ctx.response.success({sharing:row?.locationSharing ?? false, intervalMinutes:SHARE_INTERVAL_MINUTES, retentionDays:RETENTION_DAYS});
    });
    router.put('/location/settings', async ctx => {
      const {sharing} = ctx.body as {sharing:boolean};
      await settings().updateOne({_id:auth.user(ctx).id}, {$set:{locationSharing:sharing, updatedAt:new Date()}}, {upsert:true});
      return ctx.response.success({sharing, intervalMinutes:SHARE_INTERVAL_MINUTES, retentionDays:RETENTION_DAYS});
    }, {validate:{body:z.strictObject({sharing:z.boolean()})}});

    // Accepts one or many points. Client IDs make retries after a dropped connection safe.
    router.post('/location', async ctx => {
      await ensureIndexes();
      const owner = auth.user(ctx).id;
      if (!(await settings().findOne({_id:owner}))?.locationSharing)
        throw createHttpError(409, 'SHARING_OFF', 'Turn on location sharing first.');
      const now = Date.now();
      const {points} = ctx.body as z.output<typeof batch>;
      if (points.some(p => p.recordedAt.getTime() > now + MAX_CLOCK_SKEW_MS))
        throw createHttpError(422, 'INVALID_TIME', 'Location time is in the future.');
      const fresh = points.filter(p => p.recordedAt.getTime() >= now - MAX_AGE_MS);
      if (fresh.length) await locations().bulkWrite(fresh.map(p => ({updateOne:{
        filter:{_id:owner + ':' + p.clientId},
        update:{$setOnInsert:{owner, latitude:p.latitude, longitude:p.longitude, accuracy:p.accuracy, recordedAt:p.recordedAt, receivedAt:new Date()}},
        upsert:true,
      }})), {ordered:false});
      return ctx.response.success({accepted:fresh.length, skipped:points.length - fresh.length});
    }, {middleware:[rateLimit({windowMs:60_000, max:30})], validate:{body:batch}});

    router.get('/location', async ctx => {
      const rows = await locations().find({owner:auth.user(ctx).id}).sort({recordedAt:-1}).limit(100).toArray();
      return ctx.response.success(rows.map(view));
    });
    router.delete('/location', async ctx => {
      await locations().deleteMany({owner:auth.user(ctx).id});
      return ctx.response.noContent();
    });

    // Last-known location and the past day's trail, for members with location permission.
    router.get('/circle/people/:owner/location', async ctx => {
      const owner = String(ctx.params.owner);
      const permissions = await access(owner, auth.user(ctx).id);
      if (!permissions?.location) throw createHttpError(404, 'NOT_FOUND', 'Location unavailable.');
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [row, history] = await Promise.all([
        settings().findOne({_id:owner}),
        locations().find({owner, recordedAt:{$gte:since}}).sort({recordedAt:-1}).limit(100).toArray(),
      ]);
      return ctx.response.success({sharing:row?.locationSharing ?? false, latest:await lastKnownLocation(owner), history:history.map(view)});
    }, {validate:{params:z.object({owner:objectId})}});
  });
});
