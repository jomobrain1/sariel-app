import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from '../individual/account.js';
import { onSafeCheckIn, recordStatus } from '../individual/status.js';
import { access, closeCheckInRequests, names, onCircleEvent, recipients } from '../circle/members.js';
import { lastKnownLocation } from '../circle/location.js';
import { notify } from '../notifications/engine.js';
import { registerJob } from '../jobs/worker.js';

// A missed check-in raises a concern; it is never treated as proof of danger. Status becomes
// UNKNOWN and the circle is asked to reach out. A responder incident is created only when the
// person opted into escalation in advance.
export const INTERVALS = [6, 12, 24, 48, 72] as const;
export const GRACE = [1, 2, 4, 8] as const;
export const ESCALATION = [2, 6, 12, 24] as const;
const HOUR = 60 * 60 * 1000;

type State = 'ok' | 'reminded' | 'concern' | 'escalated';
interface Welfare {
  _id:string; enabled:boolean; intervalHours:number; graceHours:number; shareLocation:boolean; escalateAfterHours:number|null;
  state:State; lastCheckInAt:Date; dueAt:Date; stateChangedAt:Date;
}
type EventKind = 'enabled' | 'disabled' | 'check-in' | 'reminder' | 'concern' | 'escalated' | 'resolved';
interface WelfareEvent { _id:string; owner:string; kind:EventKind; at:Date; detail?:string }

export const welfare = () => mongoose.connection.collection<Welfare>('sariel_welfare');
const history = () => mongoose.connection.collection<WelfareEvent>('sariel_welfare_events');
let indexed: Promise<unknown> | undefined;
const ensureIndexes = () => indexed ??= Promise.all([
  welfare().createIndex({enabled:1, state:1, dueAt:1}),
  history().createIndex({owner:1, at:-1}),
]).catch(error => { indexed = undefined; throw error; });

const log = (owner:string, kind:EventKind, at:Date, detail?:string) =>
  history().insertOne({_id:randomUUID(), owner, kind, at, ...(detail ? {detail} : {})});
const when = (value:Date) => value.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

/** Records a check-in: resets the schedule and, if a concern was raised, tells the circle it is resolved. */
export async function recordCheckIn(owner:string, now = new Date(), {recordSafe = false} = {}) {
  await ensureIndexes();
  const before = await welfare().findOneAndUpdate({_id:owner, enabled:true}, [{$set:{
    lastCheckInAt:now, dueAt:{$add:[now, {$multiply:['$intervalHours', HOUR]}]}, state:'ok', stateChangedAt:now}}], {returnDocument:'before'});
  if (recordSafe) {
    await recordStatus(owner, {level:1, category:'welfare', requestId:randomUUID()}, 'account');
    await closeCheckInRequests(owner);
  }
  if (!before) return false;
  await log(owner, 'check-in', now);
  if (before.state === 'concern' || before.state === 'escalated') {
    await log(owner, 'resolved', now);
    const name = (await names([owner])).get(owner) ?? 'Someone';
    await Promise.all((await recipients(owner, 'status')).map(member =>
      notify(member, 'welfare-resolved', {name}, `welfare-resolved:${owner}:${now.getTime()}`)));
  }
  return true;
}

// Check-ins from the dashboard ("Confirm I'm safe") and circle requests ("I'm OK") count too.
onSafeCheckIn(owner => recordCheckIn(owner).then(() => undefined));
onCircleEvent(async event => { if (event.kind === 'checked-in') await recordCheckIn(event.owner); });

/** Advances overdue schedules one step. Each step is a guarded state change, so parallel runs cannot repeat it. */
export async function welfareCycle(now = new Date(), limit = 50) {
  await ensureIndexes();
  let steps = 0;
  // 1. Due → remind the person themselves.
  for (; steps < limit; steps++) {
    const row = await welfare().findOneAndUpdate({enabled:true, state:'ok', dueAt:{$lte:now}},
      {$set:{state:'reminded', stateChangedAt:now}}, {returnDocument:'after'});
    if (!row) break;
    await log(row._id, 'reminder', now);
    await notify(row._id, 'welfare-reminder', {}, `welfare-reminder:${row._id}:${row.dueAt.getTime()}`);
  }
  // 2. Grace period over → status UNKNOWN and a welfare concern for the circle.
  for (; steps < limit; steps++) {
    const row = await welfare().findOneAndUpdate({enabled:true, state:'reminded',
      $expr:{$lte:[{$add:['$dueAt', {$multiply:['$graceHours', HOUR]}]}, now]}},
      {$set:{state:'concern', stateChangedAt:now}}, {returnDocument:'after'});
    if (!row) break;
    const owner = row._id;
    await recordStatus(owner, {level:0, category:'welfare', requestId:randomUUID()}, 'welfare');
    await log(owner, 'concern', now, `No check-in since ${when(row.lastCheckInAt)}.`);
    const [name, location, members] = await Promise.all([
      names([owner]).then(map => map.get(owner) ?? 'Someone'),
      row.shareLocation ? lastKnownLocation(owner) : null,
      recipients(owner, 'status'),
    ]);
    await Promise.all(members.map(async member => {
      let detail = `They haven’t checked in since ${when(row.lastCheckInAt)}. Their status is now Unknown. Try contacting them.`;
      // Location is disclosed only if the person allowed it for concerns and this member has location access.
      if (location && (await access(owner, member))?.location)
        detail += ` Last known location: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} (±${Math.round(location.accuracy)} m) at ${when(location.recordedAt)}.`;
      await notify(member, 'welfare-concern', {name, detail}, `welfare-concern:${owner}:${row.dueAt.getTime()}`);
    }));
  }
  // 3. Optional escalation to responders, only when configured.
  for (; steps < limit; steps++) {
    const row = await welfare().findOneAndUpdate({enabled:true, state:'concern', escalateAfterHours:{$ne:null},
      $expr:{$lte:[{$add:['$stateChangedAt', {$multiply:['$escalateAfterHours', HOUR]}]}, now]}},
      {$set:{state:'escalated', stateChangedAt:now}}, {returnDocument:'after'});
    if (!row) break;
    // A deterministic request ID keeps a repeated escalation of the same missed check-in from creating two incidents.
    const requestId = uuidFrom(`${row._id}:${row.dueAt.getTime()}`);
    await recordStatus(row._id, {level:2, category:'welfare', requestId}, 'welfare');
    await log(row._id, 'escalated', now, 'A welfare report was sent to responders.');
  }
  return steps;
}
function uuidFrom(seed:string) {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

registerJob('welfare-monitoring', 60_000, now => welfareCycle(now));

const settingsBody = z.strictObject({
  enabled:z.boolean(),
  intervalHours:z.number().int().refine(n => (INTERVALS as readonly number[]).includes(n)),
  graceHours:z.number().int().refine(n => (GRACE as readonly number[]).includes(n)),
  shareLocation:z.boolean(),
  escalateAfterHours:z.number().int().refine(n => (ESCALATION as readonly number[]).includes(n)).nullable(),
});

async function overview(owner:string) {
  const [row, events] = await Promise.all([
    welfare().findOne({_id:owner}),
    history().find({owner}).sort({at:-1}).limit(30).toArray(),
  ]);
  return {
    enabled:row?.enabled ?? false, intervalHours:row?.intervalHours ?? 24, graceHours:row?.graceHours ?? 2,
    shareLocation:row?.shareLocation ?? false, escalateAfterHours:row?.escalateAfterHours ?? null,
    state:row?.enabled ? row.state : null, lastCheckInAt:row?.lastCheckInAt ?? null, dueAt:row?.enabled ? row.dueAt : null,
    options:{intervals:INTERVALS, grace:GRACE, escalation:ESCALATION},
    events:events.map(e => ({id:e._id, kind:e.kind, at:e.at, detail:e.detail ?? null})),
  };
}

export default defineRoutes(router => {
  router.group({prefix:'/api/individual/welfare', middleware:individual}, () => {
    router.get('/', async ctx => {
      await ensureIndexes();
      return ctx.response.success(await overview(auth.user(ctx).id));
    });
    router.put('/', async ctx => {
      await ensureIndexes();
      const owner = auth.user(ctx).id;
      const body = ctx.body as z.output<typeof settingsBody>;
      const now = new Date();
      const current = await welfare().findOne({_id:owner});
      const turningOn = body.enabled && !current?.enabled;
      // Turning on (or changing the interval) starts a fresh schedule from now.
      const restart = turningOn || (body.enabled && current?.intervalHours !== body.intervalHours);
      await welfare().updateOne({_id:owner}, {$set:{...body, ...(restart || !current ? {
        state:'ok' as State, lastCheckInAt:now, dueAt:new Date(now.getTime() + body.intervalHours * HOUR), stateChangedAt:now} : {})}}, {upsert:true});
      if (turningOn) await log(owner, 'enabled', now, `Every ${body.intervalHours} hours.`);
      else if (!body.enabled && current?.enabled) await log(owner, 'disabled', now);
      return ctx.response.success(await overview(owner));
    }, {validate:{body:settingsBody}});
    router.post('/check-in', async ctx => {
      const owner = auth.user(ctx).id;
      await recordCheckIn(owner, new Date(), {recordSafe:true});
      return ctx.response.success(await overview(owner));
    });
  });
});
