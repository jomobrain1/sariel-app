import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from '../individual/account.js';
import { queueDeliveries, notifications, notify, type Delivery } from '../notifications/engine.js';
import { render } from '../notifications/templates.js';
import { names } from './members.js';

// Emergency contacts are people a person trusts who don't need a Sariel account. When the person
// reports danger, they get a discreet email (or SMS). If they later join Sariel with that email,
// the alerts are waiting in their notifications.
export const relationships = ['family', 'partner', 'friend', 'colleague', 'other'] as const;
interface Contact { _id:string; owner:string; name:string; email?:string; phone?:string; relationship:typeof relationships[number]; createdAt:Date }
interface ContactAlert {
  _id:string; contact:string; owner:string; email?:string; title:string; body:string; createdAt:Date; claimedBy:string|null;
}
const contacts = () => mongoose.connection.collection<Contact>('sariel_emergency_contacts');
const alerts = () => mongoose.connection.collection<ContactAlert>('sariel_contact_alerts');
let indexed: Promise<unknown> | undefined;
const ensureIndexes = () => indexed ??= Promise.all([
  contacts().createIndex({owner:1, createdAt:1}),
  alerts().createIndex({email:1, claimedBy:1}),
]).catch(error => { indexed = undefined; throw error; });

export const MAX_CONTACTS = 10;
const view = (c:Contact) => ({id:c._id, name:c.name, email:c.email ?? null, phone:c.phone ?? null, relationship:c.relationship, createdAt:c.createdAt});

/**
 * Tells a person's emergency contacts they may need help. Registered contacts get an in-app alert
 * (emailed as urgent); everyone else gets a discreet email or SMS, and the alert is kept so they can
 * read it if they join with the same email.
 */
export async function alertEmergencyContacts(owner:string, detail:{level:string; note?:string}, eventKey:string) {
  await ensureIndexes();
  const list = await contacts().find({owner}).toArray();
  if (!list.length) return;
  const name = (await names([owner])).get(owner) ?? 'Someone';
  const message = render('contact-alert', {name, detail:`They reported: ${detail.level}.${detail.note ? ` They wrote: “${detail.note}”.` : ''}`});
  await Promise.all(list.map(async contact => {
    const dedupeKey = `contact-alert:${contact._id}:${eventKey}`;
    const account = contact.email ? await mongoose.connection.collection('users').findOne({email:contact.email, deletedAt:null}, {projection:{_id:1}}) : null;
    if (account && String(account._id) !== owner) {
      await notify(String(account._id), 'contact-alert', {name, detail:message.body.replace(`${name} listed you as an emergency contact. `, '')}, dedupeKey);
      return;
    }
    const alertId = createHash('sha256').update(dedupeKey).digest('hex');
    try {
      await alerts().insertOne({_id:alertId, contact:contact._id, owner, ...(contact.email ? {email:contact.email} : {}), title:message.title, body:message.body, createdAt:new Date(), claimedBy:null});
    } catch(error) { if(!(error instanceof mongoose.mongo.MongoServerError&&error.code===11000))throw error; }
    const now = new Date();
    const queue:Delivery[] = [];
    const base = {notification:'contact:' + alertId, recipient:'contact:' + contact._id, subject:message.subject, state:'queued' as const,
      attempts:0, nextAttemptAt:now, lockedUntil:null, lastError:null, sentAt:null, history:[]};
    if (contact.email) queue.push({_id:randomUUID(), ...base, channel:'email', target:contact.email,
      text:'Someone who listed you as an emergency contact on Sariel may need help. To see who and what happened, create a free Sariel account or sign in with this email address.'});
    if (contact.phone) queue.push({_id:randomUUID(), ...base, channel:'sms', target:contact.phone,
      text:'Someone who listed you as an emergency contact on Sariel may need help. Sign in to Sariel with your email to see details.'});
    await queueDeliveries(queue);
  }));
}

/** Moves alerts sent to this email before the person had an account into their notifications. */
export async function claimContactAlerts(userId:string, email:string) {
  await ensureIndexes();
  const pending = await alerts().find({email:email.toLowerCase(), claimedBy:null}).toArray();
  for (const alert of pending) {
    if (alert.owner === userId) continue;
    try {
      await notifications().insertOne({_id:randomUUID(), recipient:userId, kind:'contact-alert', title:alert.title, body:alert.body,
        link:'/notifications', priority:'emergency', dedupeKey:'contact-alert-claim:' + alert._id, createdAt:alert.createdAt, readAt:null, acknowledgedAt:null});
    } catch(error) { if(!(error instanceof mongoose.mongo.MongoServerError&&error.code===11000))throw error; }
    await alerts().updateOne({_id:alert._id}, {$set:{claimedBy:userId}});
  }
}

const body = z.strictObject({
  name:z.string().trim().min(1).max(80),
  email:z.string().trim().toLowerCase().email().max(254).optional(),
  phone:z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +254712345678').optional(),
  relationship:z.enum(relationships).default('family'),
}).refine(c => c.email || c.phone, 'Add an email address or phone number.');

export default defineRoutes(router => {
  router.group({prefix:'/api/individual/emergency-contacts', middleware:individual}, () => {
    router.get('/', async ctx => {
      await ensureIndexes();
      return ctx.response.success((await contacts().find({owner:auth.user(ctx).id}).sort({createdAt:1}).toArray()).map(view));
    });
    router.post('/', async ctx => {
      await ensureIndexes();
      const user = auth.user(ctx);
      const input = ctx.body as z.output<typeof body>;
      if (input.email && input.email === user.email.toLowerCase()) throw createHttpError(422, 'INVALID_CONTACT', 'Add someone other than yourself.');
      if (await contacts().countDocuments({owner:user.id}) >= MAX_CONTACTS) throw createHttpError(422, 'TOO_MANY_CONTACTS', `You can add up to ${MAX_CONTACTS} emergency contacts.`);
      const contact:Contact = {_id:randomUUID(), owner:user.id, name:input.name, ...(input.email ? {email:input.email} : {}), ...(input.phone ? {phone:input.phone} : {}),
        relationship:input.relationship, createdAt:new Date()};
      await contacts().insertOne(contact);
      return ctx.response.created(view(contact));
    }, {validate:{body}});
    router.delete('/:id', async ctx => {
      const result = await contacts().deleteOne({_id:String(ctx.params.id), owner:auth.user(ctx).id});
      if (!result.deletedCount) throw createHttpError(404, 'NOT_FOUND', 'Contact not found.');
      return ctx.response.noContent();
    }, {validate:{params:z.object({id:z.uuid()})}});
  });
});
