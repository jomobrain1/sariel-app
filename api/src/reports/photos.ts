import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes, rateLimit } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from '../individual/account.js';
import { publicReporting } from '../individual/identity.js';
import { events, recordStatus } from '../individual/status.js';
import { country, label, platformOnly } from '../administration/config.js';
import { names, recipients } from '../circle/members.js';
import { notify } from '../notifications/engine.js';
import { open, seal as sealSecret } from '../ai/secrets.js';
import { coverPng } from '../images/covers.js';
import { decode, encodePng, fromDataUrl, imageBody } from '../images/codec.js';
import { embed, extract, seal, unseal } from './stego.js';

interface ReportKey { _id:string /* owner */; selector:string /* hex */; key:string /* sealed */; createdAt:Date }
interface ReportPhoto {
  _id:string /* report id, hex */; owner:string; selector:string; level:number; category:string; country?:string; description?:string;
  token:string; createdAt:Date; revokedAt:Date|null; generation:number; lastTriggeredAt:Date|null; triggerCount:number;
}
const keys = () => mongoose.connection.collection<ReportKey>('sariel_report_keys');
export const reportPhotos = () => mongoose.connection.collection<ReportPhoto>('sariel_report_photos');
// One row per distinct visitor of a report link, per incident generation.
const linkVisits = () => mongoose.connection.collection<{_id:string; report:string; generation:number; at:Date}>('sariel_report_link_visits');
export const SPREAD_THRESHOLD = 3;
let indexed: Promise<unknown> | undefined;
const ensureIndexes = () => indexed ??= Promise.all([
  keys().createIndex({selector:1}, {unique:true}),
  reportPhotos().createIndex({token:1}, {unique:true}),
  reportPhotos().createIndex({owner:1, createdAt:-1}),
  linkVisits().createIndex({report:1, generation:1}),
  linkVisits().createIndex({at:1}, {expireAfterSeconds:90 * 24 * 60 * 60}),
]).catch(error => { indexed = undefined; throw error; });

const levelLabels = ['Unknown', 'Confirmed safe', 'Assistance needed', 'Safety concern', 'Serious danger', 'Critical danger'];
const linkPath = (token:string) => '/p/' + token;
const digest = (value:string) => createHash('sha256').update(value).digest('hex');
function uuidFrom(seed:string) {
  const h = digest(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function ownKey(owner:string) {
  await ensureIndexes();
  const existing = await keys().findOne({_id:owner});
  if (existing) {
    // Fails when this server's SARIEL_DATA_KEY differs from the one that stored the key (e.g. local vs. Vercel on one database).
    try { return {selector:existing.selector, key:open(existing.key, 'report-key:' + owner)}; }
    catch { throw createHttpError(503, 'KEY_UNAVAILABLE', 'Report photos can’t be created right now: this server can’t read your report key. An administrator needs to check SARIEL_DATA_KEY.'); }
  }
  const selector = randomBytes(16).toString('hex'), key = randomBytes(32);
  try { await keys().insertOne({_id:owner, selector, key:sealSecret(key, 'report-key:' + owner), createdAt:new Date()}); }
  catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) return ownKey(owner);
    throw error;
  }
  return {selector, key};
}

type Outcome =
  | {ok:true; duplicate:boolean; reference:string; report:ReportPhoto}
  | {ok:false; reason:'no-report'|'unknown-key'|'tampered'|'unknown-report'|'revoked'|'unreadable'; report?:ReportPhoto};

/** Turns a valid report photo or link into an incident. Repeats while an incident is open add nothing. */
async function trigger(report:ReportPhoto, create = true): Promise<Outcome> {
  const current = await keys().findOne({_id:report.owner});
  if (report.revokedAt || current?.selector !== report.selector) return {ok:false, reason:'revoked', report};
  let generation = report.generation;
  for (let attempt = 0; attempt < 3; attempt++) {
    const requestId = uuidFrom(`${report._id}:${generation}`);
    const reference = digest(report.owner + '/' + requestId);
    const existing = await events().findOne({_id:reference}, {projection:{active:1}});
    if (existing?.active) {
      if (create) await reportPhotos().updateOne({_id:report._id}, {$set:{lastTriggeredAt:new Date()}, $inc:{triggerCount:1}});
      return {ok:true, duplicate:true, reference, report};
    }
    if (existing) {
      // The earlier incident was resolved, so this use starts a new one.
      const moved = await reportPhotos().findOneAndUpdate({_id:report._id, generation}, {$inc:{generation:1}}, {returnDocument:'after'});
      generation = moved?.generation ?? (await reportPhotos().findOne({_id:report._id}))!.generation;
      continue;
    }
    if (!create) return {ok:true, duplicate:false, reference, report};
    await recordStatus(report.owner, {level:report.level, category:report.category, country:report.country, note:report.description, requestId}, 'image');
    await reportPhotos().updateOne({_id:report._id}, {$set:{lastTriggeredAt:new Date()}, $inc:{triggerCount:1}});
    const name = (await names([report.owner])).get(report.owner) ?? 'Someone';
    await Promise.all((await recipients(report.owner, 'status')).map(member =>
      notify(member, 'photo-report', {name, ...(report.description ? {note:report.description} : {})}, `photo-report:${report._id}:${generation}`)));
    return {ok:true, duplicate:false, reference, report};
  }
  return {ok:false, reason:'unreadable', report};
}

/**
 * Counts distinct visitors of a report link. When the third different person opens it (or taps the
 * picture), the open incident gets a "link spreading" alert and the circle is alerted again, once.
 */
async function countVisitor(report:ReportPhoto, visitor:string, reference:string) {
  const current = await reportPhotos().findOne({_id:report._id}, {projection:{generation:1}});
  const generation = current?.generation ?? report.generation;
  try { await linkVisits().insertOne({_id:`${report._id}:${generation}:${digest(visitor)}`, report:report._id, generation, at:new Date()}); }
  catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) return; // Same visitor again.
    throw error;
  }
  if (await linkVisits().countDocuments({report:report._id, generation}) !== SPREAD_THRESHOLD) return;
  const updated = await events().updateOne({_id:reference, active:true, 'incident.audit.action':{$ne:'photo-link-spread'}},
    {$push:{'incident.audit':{at:new Date(), action:'photo-link-spread', note:`Opened by ${SPREAD_THRESHOLD} different people`}}, $inc:{'incident.version':1}});
  if (!updated.modifiedCount) return;
  const name = (await names([report.owner])).get(report.owner) ?? 'Someone';
  await Promise.all((await recipients(report.owner, 'status')).map(member =>
    notify(member, 'photo-link-spread', {name}, `photo-link-spread:${report._id}:${generation}`)));
}

/** Reads the hidden report from an image and, when valid, triggers it. */
async function fromImage(bytes:Buffer, create = true): Promise<Outcome> {
  await ensureIndexes();
  let image;
  try { image = decode(bytes); } catch { return {ok:false, reason:'unreadable'}; }
  const frame = extract(image);
  if (!frame) return {ok:false, reason:'no-report'};
  const owner = await keys().findOne({selector:frame.subarray(0, 16).toString('hex')});
  if (!owner) {
    // A rotated key leaves old photos unreadable on purpose; tell revoked apart from unknown when we can.
    return {ok:false, reason:'unknown-key'};
  }
  let payload;
  try { payload = unseal(frame, open(owner.key, 'report-key:' + owner._id)); } catch { return {ok:false, reason:'tampered'}; }
  const report = await reportPhotos().findOne({_id:payload.r, owner:owner._id});
  if (!report) return {ok:false, reason:'unknown-report'};
  return trigger(report, create);
}

const view = (r:ReportPhoto) => ({id:r._id, level:r.level, status:levelLabels[r.level], category:r.category, country:r.country ?? null, description:r.description ?? null,
  link:linkPath(r.token), createdAt:r.createdAt, revoked:!!r.revokedAt, lastUsedAt:r.lastTriggeredAt, uses:r.triggerCount});
const reasonText:Record<string, string> = {
  'no-report':'No Sariel report was found in this image. It may be an ordinary photo, or it was compressed (for example by WhatsApp or Facebook).',
  'unknown-key':'The image carries a report, but its key was revoked or is unknown.',
  tampered:'The hidden report failed verification. The image was changed or damaged after it was created.',
  'unknown-report':'The report in this image no longer exists.',
  revoked:'This report photo was revoked by its owner.',
  unreadable:'The image could not be read.',
};

const createBody = z.strictObject({coverId:z.uuid(), level:z.number().int().min(2).max(5), category:label.max(60), country:country.optional(),
  description:z.string().trim().max(500).optional()});

export default defineRoutes(router => {
  router.group({prefix:'/api/individual/report-photos', middleware:individual}, () => {
    router.get('/', async ctx => {
      await ensureIndexes();
      const rows = await reportPhotos().find({owner:auth.user(ctx).id}).sort({createdAt:-1}).limit(50).toArray();
      return ctx.response.success(rows.map(view));
    });

    // Hides an encrypted report in one of the person's cover photos. The finished image is not stored.
    router.post('/', async ctx => {
      const owner = auth.user(ctx).id;
      const body = ctx.body as z.output<typeof createBody>;
      const image = decode(await coverPng(owner, body.coverId));
      const {selector, key} = await ownKey(owner);
      const report:ReportPhoto = {_id:randomBytes(16).toString('hex'), owner, selector, level:body.level, category:body.category,
        ...(body.country ? {country:body.country} : {}), ...(body.description ? {description:body.description} : {}), token:randomBytes(9).toString('base64url'), createdAt:new Date(),
        revokedAt:null, generation:0, lastTriggeredAt:null, triggerCount:0};
      const frame = seal({v:1, r:report._id, l:report.level, c:report.category, ...(report.country ? {k:report.country} : {}), ...(report.description ? {d:report.description} : {}),
        t:Math.floor(report.createdAt.getTime() / 1000)}, Buffer.from(selector, 'hex'), key);
      const png = encodePng(embed(image, frame));
      await reportPhotos().insertOne(report);
      return ctx.response.created({...view(report), dataUrl:'data:image/png;base64,' + png.toString('base64'), filename:`photo-${report.token.slice(0, 6)}.png`});
    }, {middleware:[rateLimit({windowMs:60_000, max:10})], validate:{body:createBody}});

    router.delete('/:id', async ctx => {
      const result = await reportPhotos().updateOne({_id:String(ctx.params.id), owner:auth.user(ctx).id, revokedAt:null}, {$set:{revokedAt:new Date()}});
      if (!result.matchedCount) throw createHttpError(404, 'NOT_FOUND', 'Report photo unavailable.');
      return ctx.response.noContent();
    }, {validate:{params:z.object({id:z.string().regex(/^[a-f0-9]{32}$/)})}});

    // A new key makes every earlier report photo unreadable, wherever copies exist.
    router.post('/revoke-all', async ctx => {
      const owner = auth.user(ctx).id;
      await keys().deleteOne({_id:owner});
      await reportPhotos().updateMany({owner, revokedAt:null}, {$set:{revokedAt:new Date()}});
      return ctx.response.noContent();
    });
  });

  // Public intake. The response never says whether anything was found, so senders learn nothing.
  router.group({prefix:'/api/auth/safety', middleware:publicReporting}, () => {
    router.post('/photo', async ctx => {
      try { await fromImage(fromDataUrl((ctx.body as {image:string}).image)); } catch { /* Same answer either way. */ }
      return ctx.response.success({received:true});
    }, {middleware:[imageBody], validate:{body:z.strictObject({image:z.string().min(32)})}});

    router.post('/photo-link', async ctx => {
      await ensureIndexes();
      const body = ctx.body as {token:string; visitor?:string};
      const report = await reportPhotos().findOne({token:body.token});
      if (report) {
        const outcome = await trigger(report);
        if (outcome.ok && body.visitor) await countVisitor(report, body.visitor, outcome.reference);
      }
      return ctx.response.noContent();
    }, {validate:{body:z.strictObject({token:z.string().regex(/^[A-Za-z0-9_-]{12}$/), visitor:z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional()})}});
  });

  // Superadmin check: decode any image and optionally create the incident.
  router.group({prefix:'/api/platform/photo-check', middleware:[...auth.requestMiddleware, auth.middleware, platformOnly]}, () => {
    router.post('/', async ctx => {
      const body = ctx.body as {image:string; createIncident:boolean};
      const outcome = await fromImage(fromDataUrl(body.image), body.createIncident);
      const report = outcome.report;
      const person = report ? await mongoose.connection.collection('users').findOne({_id:new mongoose.Types.ObjectId(report.owner)}, {projection:{name:1, email:1}}) : null;
      return ctx.response.success({
        valid:outcome.ok, message:outcome.ok ? (outcome.duplicate ? 'Valid report. An incident for it is already open.' : body.createIncident ? 'Valid report. Incident created.' : 'Valid report. No incident created (check only).') : reasonText[outcome.reason],
        person:person ? {name:person.name, email:person.email} : null,
        report:report ? {level:report.level, status:levelLabels[report.level], category:report.category, country:report.country ?? null, description:report.description ?? null,
          createdAt:report.createdAt, revoked:!!report.revokedAt, uses:report.triggerCount} : null,
        incident:outcome.ok && (body.createIncident || outcome.duplicate) ? {reference:outcome.reference, duplicate:outcome.duplicate} : null,
      });
    }, {middleware:[imageBody], validate:{body:z.strictObject({image:z.string().min(32), createIncident:z.boolean().default(false)})}});
  });
});
