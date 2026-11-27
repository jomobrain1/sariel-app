import { createHash, randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes, rateLimit } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { Config, country, platformOnly, profile } from '../administration/config.js';
import { publicReporting } from '../individual/identity.js';
import { incidentAccess } from '../incidents/access.js';
import { notify } from '../notifications/engine.js';
import { storage, storageConfigured } from '../storage.js';

// Reports from anyone (no account) about someone else in danger, optionally with photos or videos.
// Files go straight from the browser to Cloudinary with a one-time signature and are stored with
// authenticated delivery, so they can only be viewed through short-lived signed links.
export const MAX_FILES = 3;
type Status = 'draft' | 'submitted' | 'reviewing' | 'closed';
// Reviewer actions: each records a timeline entry and moves the report along.
const reportActions = {
  'contacted-reporter':{label:'Reporter contacted', status:'reviewing'},
  referred:{label:'Referred for help', status:'reviewing'},
  resolved:{label:'Resolved', status:'closed'},
} as const;
type ReportAction = keyof typeof reportActions;
interface Media { publicId:string; resourceType:string; deliveryType:string; bytes:number; format?:string; kind:'image'|'video'; uploadedAt:Date }
interface PublicReport {
  _id:string; tokenHash:string; status:Status; description:string; country:string; place?:string; urgency:'urgent'|'soon'|'information';
  contact?:string; media:Media[]; pendingUploads:string[]; createdAt:Date; submittedAt:Date|null;
  notes:{at:Date; by:string; byName:string; text:string; tenant?:string; action?:ReportAction}[];
}
const reports = () => mongoose.connection.collection<PublicReport>('sariel_public_reports');
let indexed: Promise<unknown> | undefined;
const ensureIndexes = () => indexed ??= Promise.all([
  reports().createIndex({status:1, submittedAt:-1}),
  reports().createIndex({country:1, status:1, submittedAt:-1}),
  // Abandoned drafts disappear after a day.
  reports().createIndex({createdAt:1}, {expireAfterSeconds:24 * 60 * 60, partialFilterExpression:{status:'draft'}}),
]).catch(error => { indexed = undefined; throw error; });

const hash = (value:string) => createHash('sha256').update(value).digest('hex');
const notFound = () => createHttpError(404, 'NOT_FOUND', 'Report unavailable.');
const videoExtensions = ['mp4', 'mov', 'webm', '3gp'];
const extension = (filename:string) => filename.split('.').pop()?.toLowerCase() ?? '';

async function draft(id:string, token:string) {
  const report = await reports().findOne({_id:id, tokenHash:hash(token), status:'draft'});
  if (!report) throw notFound();
  return report;
}

function view(r:PublicReport, withMedia:boolean) {
  return {id:r._id, status:r.status, description:r.description, country:r.country, place:r.place ?? null, urgency:r.urgency,
    contact:r.contact ?? null, submittedAt:r.submittedAt, notes:r.notes.map(n => ({at:n.at, byName:n.byName, text:n.text, action:n.action ?? null})),
    media:withMedia ? r.media.map(m => ({kind:m.kind, format:m.format ?? null, bytes:m.bytes,
      ...(storageConfigured() ? storage.getDownloadUrl(m, {expiresInSeconds:600}) : {url:null, expiresAt:null})})) : r.media.map(m => ({kind:m.kind}))};
}

const draftBody = z.strictObject({
  description:z.string().trim().min(10, 'Please describe what is happening.').max(2000),
  country, place:z.string().trim().max(200).optional(),
  urgency:z.enum(['urgent', 'soon', 'information']).default('urgent'),
  contact:z.string().trim().max(200).optional(),
  website:z.string().max(0).optional(), // Spam trap: hidden from people, filled in by bots.
});
const tokenBody = z.strictObject({token:z.string().regex(/^[A-Za-z0-9_-]{32}$/)});
const params = z.object({id:z.uuid()});
const listQuery = z.object({status:z.enum(['submitted', 'reviewing', 'closed', 'open', 'all']).default('open'), page:z.coerce.number().int().min(1).max(1000).default(1)});
const statusFilter = (status:string) => status === 'all' ? {status:{$ne:'draft' as const}} : status === 'open' ? {status:{$in:['submitted', 'reviewing'] as Status[]}} : {status:status as Status};

export default defineRoutes(router => {
  router.group({prefix:'/api/auth/public-reports', middleware:publicReporting}, () => {
    router.get('/config', ctx => ctx.response.success({uploads:storageConfigured(), maxFiles:MAX_FILES,
      image:{extensions:['jpg', 'jpeg', 'png', 'webp', 'heic'], maxBytes:10 * 1024 * 1024}, video:{extensions:videoExtensions, maxBytes:50 * 1024 * 1024}}));

    // Step 1: the text of the report. Returns a private token for the upload and submit steps.
    router.post('/', async ctx => {
      await ensureIndexes();
      const body = ctx.body as z.output<typeof draftBody>;
      if (body.website) throw createHttpError(422, 'INVALID', 'Report could not be saved.');
      const token = randomBytes(24).toString('base64url');
      const report:PublicReport = {_id:randomUUID(), tokenHash:hash(token), status:'draft', description:body.description, country:body.country,
        ...(body.place ? {place:body.place} : {}), urgency:body.urgency, ...(body.contact ? {contact:body.contact} : {}),
        media:[], pendingUploads:[], createdAt:new Date(), submittedAt:null, notes:[]};
      await reports().insertOne(report);
      return ctx.response.created({id:report._id, token});
    }, {middleware:[rateLimit({windowMs:10 * 60_000, max:5})], validate:{body:draftBody}});

    // Step 2 (optional, per file): a one-time signature to upload directly to Cloudinary.
    router.post('/:id/uploads', async ctx => {
      if (!storageConfigured()) throw createHttpError(503, 'UPLOADS_UNAVAILABLE', 'Photo and video uploads are not available right now.');
      const {token, filename, bytes} = ctx.body as {token:string; filename:string; bytes:number};
      const report = await draft(String(ctx.params.id), token);
      if (report.media.length + report.pendingUploads.length >= MAX_FILES) throw createHttpError(422, 'TOO_MANY_FILES', `Up to ${MAX_FILES} files per report.`);
      const kind = videoExtensions.includes(extension(filename)) ? 'video' : 'image';
      const profileName = kind === 'video' ? 'publicReportVideo' : 'publicReportImage';
      try { storage.validateFile({profile:profileName, filename, bytes}); }
      catch (error) { throw createHttpError(422, 'INVALID_FILE', error instanceof Error ? error.message : 'That file can’t be used.'); }
      const authorization = storage.authorizeUpload({profile:profileName, filename, bytes, publicId:`${report._id}-${randomUUID()}`});
      await reports().updateOne({_id:report._id}, {$push:{pendingUploads:authorization.publicId}});
      return ctx.response.success({...authorization, kind, resourceType:kind});
    }, {middleware:[rateLimit({windowMs:10 * 60_000, max:20})], validate:{params,
      body:tokenBody.extend({filename:z.string().trim().min(3).max(200), bytes:z.number().int().min(1).max(50 * 1024 * 1024)})}});

    // Step 3 (per file): confirm the upload; the server checks Cloudinary has the file and its size.
    router.post('/:id/uploads/complete', async ctx => {
      if (!storageConfigured()) throw createHttpError(503, 'UPLOADS_UNAVAILABLE', 'Uploads are not available right now.');
      const {token, publicId, filename, bytes} = ctx.body as {token:string; publicId:string; filename:string; bytes:number};
      const report = await draft(String(ctx.params.id), token);
      if (!report.pendingUploads.includes(publicId)) throw notFound();
      const kind = videoExtensions.includes(extension(filename)) ? 'video' : 'image';
      let asset;
      try { asset = await storage.completeUpload({profile:kind === 'video' ? 'publicReportVideo' : 'publicReportImage', publicId, bytes, filename}); }
      catch { throw createHttpError(422, 'UPLOAD_NOT_FOUND', 'The file didn’t finish uploading. Try again.'); }
      await reports().updateOne({_id:report._id}, {$pull:{pendingUploads:publicId},
        $push:{media:{publicId:asset.publicId, resourceType:asset.resourceType, deliveryType:asset.deliveryType, bytes:asset.bytes, ...(asset.format ? {format:asset.format} : {}), kind, uploadedAt:new Date()}}});
      return ctx.response.noContent();
    }, {validate:{params, body:tokenBody.extend({publicId:z.string().min(5).max(300), filename:z.string().min(3).max(200), bytes:z.number().int().min(1)})}});

    // Step 4: send it. The platform team is alerted; approved organisations for that country can see it.
    router.post('/:id/submit', async ctx => {
      const {token} = ctx.body as {token:string};
      const report = await draft(String(ctx.params.id), token);
      const now = new Date();
      await reports().updateOne({_id:report._id, status:'draft'}, {$set:{status:'submitted', submittedAt:now, pendingUploads:[]}, $unset:{tokenHash:''}});
      const admins = await mongoose.connection.collection('users').find({roles:'superadmin', deletedAt:null}, {projection:{_id:1}}).toArray();
      await Promise.all(admins.map(admin => notify(String(admin._id), 'public-report', {country:report.country, urgency:report.urgency,
        media:String(report.media.length), summary:report.description.slice(0, 140)}, 'public-report:' + report._id)));
      return ctx.response.success({received:true});
    }, {validate:{params, body:tokenBody}});
  });

  // Platform administrators: every public report.
  router.group({prefix:'/api/platform/public-reports', middleware:[...auth.requestMiddleware, auth.middleware, platformOnly]}, () => {
    router.get('/', async ctx => {
      await ensureIndexes();
      const {status, page} = ctx.query as unknown as z.output<typeof listQuery>;
      const rows = await reports().find(statusFilter(status)).sort({submittedAt:-1}).skip((page - 1) * 30).limit(30).toArray();
      return ctx.response.success(rows.map(r => view(r, false)));
    }, {validate:{query:listQuery}});
    router.get('/:id', async ctx => {
      const report = await reports().findOne({_id:String(ctx.params.id), status:{$ne:'draft'}});
      if (!report) throw notFound();
      return ctx.response.success(view(report, true));
    }, {validate:{params}});
    router.post('/:id/update', async ctx => {
      const user = auth.user(ctx);
      const {status, note, action} = ctx.body as {status?:Status; note?:string; action?:ReportAction};
      const step = action ? reportActions[action] : null;
      const text = step ? (note ? `${step.label}: ${note}` : step.label) : note;
      const result = await reports().updateOne({_id:String(ctx.params.id), status:{$ne:'draft'}}, {
        ...(step || status ? {$set:{status:step?.status ?? status!}} : {}),
        ...(text ? {$push:{notes:{at:new Date(), by:user.id, byName:user.name, text, ...(action ? {action} : {})}}} : {})});
      if (!result.matchedCount) throw notFound();
      return ctx.response.noContent();
    }, {validate:{params, body:z.strictObject({status:z.enum(['reviewing', 'closed', 'submitted']).optional(), note:z.string().trim().min(1).max(1500).optional(),
      action:z.enum(Object.keys(reportActions) as [ReportAction, ...ReportAction[]]).optional()})
      .refine(b => b.status || b.note || b.action, 'Nothing to update.')}});
  });

  // Approved organisations: public reports from the countries they cover.
  router.group({prefix:'/api/organization/public-reports', middleware:[...auth.requestMiddleware, auth.middleware]}, () => {
    async function scope(ctx:Parameters<typeof auth.user>[0]) {
      const user = auth.user(ctx);
      if (!user.tenant) throw createHttpError(403, 'FORBIDDEN', 'Organisation access required.');
      if (!(await incidentAccess(user.tenant.id)).allowed) throw createHttpError(403, 'NOT_APPROVED', 'Your organisation has not been approved to view incidents yet.');
      const parsed = profile.safeParse((await Config.findById('organization/' + user.tenant.id))?.value);
      return {user, countries:parsed.success ? parsed.data.countries : []};
    }
    router.get('/', async ctx => {
      const {countries} = await scope(ctx);
      const {status, page} = ctx.query as unknown as z.output<typeof listQuery>;
      const rows = await reports().find({...statusFilter(status), country:{$in:countries}}).sort({submittedAt:-1}).skip((page - 1) * 30).limit(30).toArray();
      return ctx.response.success(rows.map(r => view(r, false)));
    }, {validate:{query:listQuery}});
    router.get('/:id', async ctx => {
      const {countries} = await scope(ctx);
      const report = await reports().findOne({_id:String(ctx.params.id), status:{$ne:'draft'}, country:{$in:countries}});
      if (!report) throw notFound();
      return ctx.response.success(view(report, true));
    }, {validate:{params}});
    router.post('/:id/note', async ctx => {
      const {user, countries} = await scope(ctx);
      const result = await reports().updateOne({_id:String(ctx.params.id), status:{$ne:'draft'}, country:{$in:countries}},
        {$push:{notes:{at:new Date(), by:user.id, byName:`${user.name} (${user.tenant!.name})`, text:(ctx.body as {note:string}).note, tenant:user.tenant!.id}}});
      if (!result.matchedCount) throw notFound();
      return ctx.response.noContent();
    }, {validate:{params, body:z.strictObject({note:z.string().trim().min(1).max(1500)})}});
  });
});
