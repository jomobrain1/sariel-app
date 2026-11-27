import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from '../individual/account.js';
import { circleRecipients, names, onCircleEvent, recipients } from '../circle/members.js';
import { alertEmergencyContacts, claimContactAlerts } from '../circle/contacts.js';
import { defaultPreferences, deliveries, ensureNotificationIndexes, notifications, notify, preferences } from './engine.js';
import mongoose from 'mongoose';
import { onIncidentCreated, type StatusEvent } from '../individual/status.js';

const levelNames = ['Unknown', 'Confirmed safe', 'Assistance needed', 'Safety concern', 'Serious danger', 'Critical danger'];
const channelNames:Record<string, string> = {account:'In-app report', gateway:'Reporting link', welfare:'Missed check-in', image:'Report photo', public:'Public report'};
// What every danger alert says: level, time, the person's note and (where allowed) a map link.
const when = (date:Date) => new Intl.DateTimeFormat('en-GB', {dateStyle:'medium', timeStyle:'short', timeZone:'UTC'}).format(date) + ' UTC';
const mapLink = (event:StatusEvent) => event.location ? `https://maps.google.com/?q=${event.location.latitude.toFixed(5)},${event.location.longitude.toFixed(5)}` : undefined;
function details(event:StatusEvent, withLocation:boolean, noteLength:number) {
  const map = withLocation ? mapLink(event) : undefined;
  return {level:levelNames[event.level] ?? 'needs help', time:when(event.createdAt), ...(event.note ? {note:event.note.slice(0, noteLength)} : {}),
    ...(map ? {map, mapSource:(event.location!.source === 'report' ? 'report location' : 'last shared location')+
      ', captured '+when(event.location!.recordedAt)+', accuracy +/-'+Math.round(event.location!.accuracy)+' m'} : {})};
}
// Every new incident alerts the platform administrators by email and SMS, at every level, always with the location:
// they may need to involve the authorities.
onIncidentCreated(async event => {
  const admins = await mongoose.connection.collection('users').find({roles:'superadmin', deletedAt:null}, {projection:{_id:1}}).toArray();
  const name = (await names([event.owner])).get(event.owner) ?? 'Someone';
  await Promise.all(admins.map(admin => notify(String(admin._id), 'incident-new', {
    name, channel:channelNames[event.channel] ?? 'Report', category:event.category, ...details(event, true, 160),
  }, 'incident-new:' + event._id)));
});
// Emergency contacts (who may not use Sariel) are told about in-app, discreet-link and report-photo incidents.
onIncidentCreated(async event => {
  if (event.channel === 'welfare') return;
  await alertEmergencyContacts(event.owner, {level:levelNames[event.level] ?? 'needs help', ...(event.note ? {note:event.note.slice(0, 200)} : {})}, event._id);
});
// The circle (members with status access) hears about in-app and discreet-link reports. The location is
// included only for members the person allowed to see it. Report photos alert the circle separately.
onIncidentCreated(async event => {
  if (event.channel !== 'account' && event.channel !== 'gateway') return;
  const name = (await names([event.owner])).get(event.owner) ?? 'Someone';
  await Promise.all((await circleRecipients(event.owner, 'status')).map(member => notify(member.member, 'circle-incident', {
    name, ...details(event, member.permissions.location, 200),
  }, 'circle-incident:' + event._id)));
});

// Circle activity becomes notifications. Removal and leaving are deliberately silent.
onCircleEvent(async event => {
  if (event.kind === 'invited' && event.entry.member)
    await notify(event.entry.member, 'circle-invite', {name:event.ownerName}, 'invite:' + event.entry._id);
  else if (event.kind === 'accepted')
    await notify(event.entry.owner, 'circle-accepted', {name:event.memberName}, 'accepted:' + event.entry._id);
  else if (event.kind === 'check-in-requested')
    await notify(event.owner, 'check-in-request', {name:event.requesterName});
  else if (event.kind === 'update-posted')
    await Promise.all((await recipients(event.owner, 'updates')).map(member =>
      notify(member, 'circle-update', {name:event.ownerName, text:event.text}, 'update:' + event.update)));
});

const PAGE_SIZE = 30;
const missing = () => createHttpError(404, 'NOT_FOUND', 'Notification unavailable.');

export default defineRoutes(router => {
  router.group({prefix:'/api/individual', middleware:individual}, () => {
    router.get('/notifications', async ctx => {
      await ensureNotificationIndexes();
      const recipient = auth.user(ctx).id;
      await claimContactAlerts(recipient, auth.user(ctx).email);
      const page = Number(ctx.query.page);
      const [items, unread, total] = await Promise.all([
        notifications().find({recipient}).sort({createdAt:-1,_id:-1}).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
        notifications().countDocuments({recipient, readAt:null}),
        notifications().countDocuments({recipient}),
      ]);
      const sent = items.length ? await deliveries().find({notification:{$in:items.map(n => n._id)}},
        {projection:{notification:1, channel:1, state:1, attempts:1, sentAt:1, lastError:1}}).toArray() : [];
      return ctx.response.success({unread, total, page, pageSize:PAGE_SIZE, totalPages:Math.max(1,Math.ceil(total/PAGE_SIZE)), hasNext:page * PAGE_SIZE < total, items:items.map(n => ({
        id:n._id, kind:n.kind, title:n.title, body:n.body, link:n.link, priority:n.priority, createdAt:n.createdAt,
        readAt:n.readAt, acknowledgedAt:n.acknowledgedAt,
        // Delivery history shows whether a message left Sariel; acknowledgement shows a person acted on it.
        deliveries:sent.filter(d => d.notification === n._id).map(d => ({channel:d.channel, state:d.state, attempts:d.attempts, sentAt:d.sentAt, lastError:d.lastError})),
      }))});
    }, {validate:{query:z.object({page:z.coerce.number().int().min(1).max(10_000).default(1)})}});

    router.get('/notifications/unread', async ctx => {
      await ensureNotificationIndexes();
      const recipient = auth.user(ctx).id;
      await claimContactAlerts(recipient, auth.user(ctx).email);
      const [unread, urgent] = await Promise.all([
        notifications().countDocuments({recipient, readAt:null}),
        notifications().countDocuments({recipient, priority:'emergency', acknowledgedAt:null}),
      ]);
      return ctx.response.success({unread, urgent});
    });

    router.post('/notifications/read', async ctx => {
      await notifications().updateMany({recipient:auth.user(ctx).id, readAt:null}, {$set:{readAt:new Date()}});
      return ctx.response.noContent();
    });
    const params = {validate:{params:z.object({id:z.uuid()})}};
    router.post('/notifications/:id/read', async ctx => {
      const result = await notifications().updateOne({_id:String(ctx.params.id), recipient:auth.user(ctx).id}, [{$set:{readAt:{$ifNull:['$readAt', '$$NOW']}}}]);
      if (!result.matchedCount) throw missing();
      return ctx.response.noContent();
    }, params);
    router.post('/notifications/:id/acknowledge', async ctx => {
      const result = await notifications().updateOne({_id:String(ctx.params.id), recipient:auth.user(ctx).id},
        [{$set:{acknowledgedAt:{$ifNull:['$acknowledgedAt', '$$NOW']}, readAt:{$ifNull:['$readAt', '$$NOW']}}}]);
      if (!result.matchedCount) throw missing();
      return ctx.response.noContent();
    }, params);

    router.get('/notification-preferences', async ctx => {
      const row = await preferences().findOne({_id:auth.user(ctx).id});
      return ctx.response.success({email:row?.email ?? defaultPreferences.email, sms:row?.sms ?? defaultPreferences.sms});
    });
    router.put('/notification-preferences', async ctx => {
      const body = ctx.body as {email:boolean; sms:boolean};
      await preferences().updateOne({_id:auth.user(ctx).id}, {$set:body}, {upsert:true});
      return ctx.response.success(body);
    }, {validate:{body:z.strictObject({email:z.boolean(), sms:z.boolean()})}});
  });
});
