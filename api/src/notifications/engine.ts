import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { registerJob } from '../jobs/worker.js';
import { render, type NotificationKind } from './templates.js';
import { permanentSmtpError, sendEmail, smtpConfigured } from './email.js';
import { sendSms, smsConfigured, SmsError } from './sms.js';

export type Channel = 'email' | 'sms';
export interface Notification {
  queueState?:'pending'|'done'; queuePlan?:Delivery[];
  _id:string; recipient:string; kind:NotificationKind; title:string; body:string; link:string;
  priority:'normal'|'emergency'; dedupeKey?:string; createdAt:Date; readAt:Date|null; acknowledgedAt:Date|null;
}
export interface Delivery {
  _id:string; notification:string; recipient:string; channel:Channel; target:string; subject:string; text:string;
  /** App page the email's button opens (e.g. /circle). */
  link?:string;
  state:'queued'|'sending'|'sent'|'failed'|'skipped'; attempts:number; nextAttemptAt:Date; lockedUntil:Date|null;
  lastError:string|null; sentAt:Date|null; history:{at:Date; outcome:'sent'|'failed'|'skipped'; error?:string}[];
}
export interface Preferences { _id:string; email:boolean; sms:boolean }

export const notifications = () => mongoose.connection.collection<Notification>('sariel_notifications');
export const deliveries = () => mongoose.connection.collection<Delivery>('sariel_notification_deliveries');
export const preferences = () => mongoose.connection.collection<Preferences>('sariel_notification_preferences');
export const defaultPreferences = {email:true, sms:false};

export const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60];
const LEASE_MS = 60_000;

let indexed: Promise<unknown> | undefined;
export function ensureNotificationIndexes() {
  indexed ??= Promise.all([
    notifications().createIndex({recipient:1, createdAt:-1}),
    notifications().createIndex({recipient:1, readAt:1}),
    notifications().createIndex({recipient:1, dedupeKey:1}, {unique:true, partialFilterExpression:{dedupeKey:{$type:'string'}}}),
    deliveries().createIndex({state:1, nextAttemptAt:1}),
    deliveries().createIndex({notification:1}),
  ]).catch(error => { indexed = undefined; throw error; });
  return indexed;
}

async function contacts(recipient:string) {
  const [user, account] = await Promise.all([
    /^[a-f0-9]{24}$/.test(recipient) ? mongoose.connection.collection('users').findOne(
      {_id:new mongoose.Types.ObjectId(recipient), deletedAt:null, suspendedAt:null}, {projection:{email:1}}) : null,
    mongoose.connection.collection<{_id:string; phone?:string}>('sariel_individuals').findOne({_id:recipient}, {projection:{phone:1}}),
  ]);
  return {email:user?.email as string | undefined, phone:account?.phone, active:!!user};
}

/**
 * Stores an in-app notification and queues email/SMS deliveries the recipient allows.
 * A dedupe key makes repeated calls for the same event a no-op.
 */
/** Email and SMS say exactly what the in-app notification says: its title (the email subject) and its text. */
export function externalCopy(message:{title:string; body:string}, channel:Channel) {
  const body = message.body.trim();
  return {subject:message.title, text:channel === 'email' ? (body || message.title) : (body ? `${message.title}. ${body}` : message.title).slice(0, 459)};
}

/** Stable IDs and setOnInsert preserve attempts and sent states during queue repair. */
export async function queueDeliveries(queue:Delivery[]) {
  for(const delivery of queue) {
    if(await deliveries().findOne({notification:delivery.notification,channel:delivery.channel},{projection:{_id:1}})) continue;
    const _id=createHash('sha256').update(delivery.notification+'/'+delivery.channel).digest('hex');
    await deliveries().updateOne({_id},{$setOnInsert:{...delivery,_id}},{upsert:true});
  }
}
async function finishQueue(note:Notification) {
  if(note.queueState==='done') return;
  await queueDeliveries(note.queuePlan??[]);
  await notifications().updateOne({_id:note._id},{$set:{queueState:'done'},$unset:{queuePlan:''}});
}
export async function repairNotificationQueues(limit=50) {
  const rows=await notifications().find({queueState:'pending'}).sort({createdAt:1}).limit(limit).toArray();
  for(const note of rows) await finishQueue(note);
}
export async function notify(recipient:string,kind:NotificationKind,data:Record<string,string>={},dedupeKey?:string) {
  await ensureNotificationIndexes();
  const message=render(kind,data),now=new Date();
  let note:Notification|null=dedupeKey?await notifications().findOne({recipient,dedupeKey}):null;
  if(note?.queueState==='done')return null;
  if(!note?.queuePlan) {
    const _id=note?._id??randomUUID();
    const [prefs,reach]=await Promise.all([preferences().findOne({_id:recipient}),contacts(recipient)]);
    const allowed={...defaultPreferences,...prefs};
    const queue:Delivery[]=[];
    for(const channel of message.external) {
      const target=channel==='email'?reach.email:reach.phone;
      if(!reach.active||!target||(message.priority!=='emergency'&&!allowed[channel]))continue;
      queue.push({_id:randomUUID(),notification:_id,recipient,channel,target,...externalCopy(note??message,channel),
        link:note?.link??message.link,state:'queued',attempts:0,nextAttemptAt:now,lockedUntil:null,lastError:null,sentAt:null,history:[]});
    }
    if(note) {
      await notifications().updateOne({_id:note._id,queueState:{$exists:false}},{$set:{queueState:'pending',queuePlan:queue}});
      note=await notifications().findOne({_id:note._id});
    } else {
      note={_id,recipient,kind,title:message.title,body:message.body,link:message.link,priority:message.priority,
        ...(dedupeKey?{dedupeKey}:{}),createdAt:now,readAt:null,acknowledgedAt:null,queueState:'pending',queuePlan:queue};
      try {await notifications().insertOne(note);}
      catch(error) {
        if(!(error instanceof mongoose.mongo.MongoServerError&&error.code===11000)||!dedupeKey)throw error;
        note=await notifications().findOne({recipient,dedupeKey});
      }
    }
  }
  if(note)await finishQueue(note);
  return note;
}

// ── Providers ───────────────────────────────────────────────
// Email and SMS go to one delivery webhook (NOTIFICATION_DELIVERY_URL), the same pattern as
// account verification. Any email/SMS service can sit behind it. Without it, deliveries are skipped.
type Outcome = {ok:true} | {ok:false; retry:boolean; error:string};
async function sendThroughProvider(delivery:Delivery): Promise<Outcome> {
  const endpoint = process.env.NOTIFICATION_DELIVERY_URL;
  const key = process.env.NOTIFICATION_DELIVERY_TOKEN;
  let url: URL | undefined;
  try { url = endpoint ? new URL(endpoint) : undefined; } catch { url = undefined; }
  const local = url && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  const webhook = !!url && !!key && (url.protocol === 'https:' || (!!local && url.protocol === 'http:'));
  // Without a delivery webhook, email goes straight out over SMTP (MAIL_* settings).
  if (!webhook && delivery.channel === 'email' && smtpConfigured()) {
    try { await sendEmail(delivery.target, delivery.subject, delivery.text, delivery._id, delivery.link); return {ok:true}; }
    catch (error) {
      return {ok:false, retry:!permanentSmtpError(error), error:'Email failed: ' + (error instanceof Error ? error.message.slice(0, 160) : 'unknown error')};
    }
  }
  // Without a delivery webhook, SMS goes out through Mobile Sasa (MOBILESASA_TOKEN).
  if (!webhook && delivery.channel === 'sms' && smsConfigured()) {
    try { await sendSms(delivery.target, delivery.text); return {ok:true}; }
    catch (error) { return {ok:false, retry:error instanceof SmsError ? error.retryable : true, error:'SMS failed: ' + (error instanceof Error ? error.message.slice(0, 160) : 'unknown error')}; }
  }
  if (!webhook || !url) return {ok:false, retry:false, error:delivery.channel === 'sms' ? 'SMS is not configured (set MOBILESASA_TOKEN).' : 'Email is not configured (set MAIL_USER and MAIL_PASS).'};
  try {
    const response = await fetch(url, {method:'POST', redirect:'error', signal:AbortSignal.timeout(10_000),
      headers:{'Content-Type':'application/json', Authorization:'Bearer ' + key, 'Idempotency-Key':delivery._id},
      body:JSON.stringify({channel:delivery.channel, target:delivery.target, subject:delivery.subject, text:delivery.text})});
    if (response.ok) return {ok:true};
    return {ok:false, retry:response.status >= 500 || response.status === 429, error:`Provider responded ${response.status}.`};
  } catch (error) {
    return {ok:false, retry:true, error:error instanceof Error ? error.message : 'Delivery failed.'};
  }
}

/** Sends due deliveries. Safe to run on several instances at once: each delivery is claimed with a lease. */
export async function deliveryCycle(now = new Date(), limit = 25) {
  await ensureNotificationIndexes();
  await repairNotificationQueues();
  let processed = 0;
  for (; processed < limit; processed++) {
    const claimed = await deliveries().findOneAndUpdate(
      {nextAttemptAt:{$lte:now}, $or:[{state:'queued'}, {state:'sending', lockedUntil:{$lt:now}}]},
      {$set:{state:'sending', lockedUntil:new Date(now.getTime() + LEASE_MS)}, $inc:{attempts:1}},
      {sort:{nextAttemptAt:1}, returnDocument:'after'});
    if (!claimed) break;
    const outcome = await sendThroughProvider(claimed);
    const at = new Date();
    if (outcome.ok) {
      await deliveries().updateOne({_id:claimed._id}, {$set:{state:'sent', sentAt:at, lockedUntil:null, lastError:null}, $push:{history:{at, outcome:'sent'}}});
    } else if (!outcome.retry) {
      await deliveries().updateOne({_id:claimed._id}, {$set:{state:'skipped', lockedUntil:null, lastError:outcome.error}, $push:{history:{at, outcome:'skipped', error:outcome.error}}});
    } else {
      const done = claimed.attempts >= MAX_ATTEMPTS;
      const wait = BACKOFF_MINUTES[Math.min(claimed.attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000;
      await deliveries().updateOne({_id:claimed._id}, {$set:{state:done ? 'failed' : 'queued', lockedUntil:null, lastError:outcome.error,
        nextAttemptAt:new Date(now.getTime() + wait)}, $push:{history:{at, outcome:'failed', error:outcome.error}}});
    }
  }
  return processed;
}

registerJob('notification-delivery', 15_000, now => deliveryCycle(now));
