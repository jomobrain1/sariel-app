import { createHash, randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from './account.js';
import { publicReporting } from './identity.js';
import { events, recordStatus, reportInput, type Report } from './status.js';

const alias = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9]{1,12}[0-9]$/);
const preset = reportInput.omit({requestId:true}).extend({level:z.number().int().min(2).max(5),alias:alias.optional()});
const activation = z.strictObject({token:z.union([alias,z.string().regex(/^(?:[A-Za-z0-9_-]{16}|[A-Za-z0-9_-]{43})$/)])});
interface IncidentLink { _id:string; digest:string; report:Report }
const links = () => mongoose.connection.collection<IncidentLink>('sariel_incident_links');
const digest = (value:string) => createHash('sha256').update(value).digest('hex');

async function activeLink(token:string) {
  const link = await links().findOne({digest:digest(token)});
  if (!link || !await mongoose.connection.collection('users').findOne({
    _id:new mongoose.Types.ObjectId(link._id),deletedAt:null,suspendedAt:null
  },{projection:{_id:1}})) throw createHttpError(403,'UNAVAILABLE','This link is unavailable.');
  return link;
}

export default defineRoutes(router => {
  router.group({prefix:'/api/individual',middleware:individual}, () => {
    router.post('/incident-link',async ctx => {
      const owner = auth.user(ctx).id;
      const {alias: chosen, ...settings} = ctx.body as z.output<typeof preset>;
      const token = chosen ?? randomBytes(12).toString('base64url');
      const key = digest(token);
      if (chosen) {
        // Keep ownership through revocation so old bookmarks can never report for someone else.
        const aliases = mongoose.connection.collection<{_id:string;owner:string}>('sariel_incident_aliases');
        try {
          await aliases.updateOne({_id:key,owner},{$setOnInsert:{owner}},{upsert:true});
        } catch (error) {
          if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000)
            throw createHttpError(409,'ALIAS_TAKEN','That link name is already taken.');
          throw error;
        }
      }
      // Links stay valid until the owner revokes or replaces them.
      const report = {...settings,requestId:randomUUID()};
      await links().createIndex({digest:1},{unique:true});
      await links().replaceOne({_id:owner},{digest:key,report},{upsert:true});
      return ctx.response.created({url:'/'+token});
    },{validate:{body:preset}});
    router.delete('/incident-link',async ctx => {
      await links().deleteOne({_id:auth.user(ctx).id});
      return ctx.response.noContent();
    });
  });
  router.group({prefix:'/api/auth/safety',middleware:publicReporting}, () => {
    const opening=activation.extend({gallery:z.literal(true).optional()});
    router.post('/activate',async ctx => {
      const {token} = ctx.body as z.output<typeof activation>;
      let link = await activeLink(token);
      // Once the previous incident is resolved, reopening the link starts a new one.
      const previous = await events().findOne({_id:digest(link._id+'/'+link.report.requestId)},{projection:{active:1}});
      if (previous && !previous.active) {
        await links().updateOne({_id:link._id,'report.requestId':link.report.requestId},{$set:{'report.requestId':randomUUID()}});
        link = await activeLink(token);
      }
      // The preset UUID makes reopens and concurrent requests the same report.
      await recordStatus(link._id,link.report,'gateway');
      return (ctx.body as z.output<typeof opening>).gallery ? ctx.response.success({edition:link.report.requestId}) : ctx.response.noContent();
    },{validate:{body:opening}});
    router.post('/gallery',async ctx => {
      const {token} = ctx.body as z.output<typeof activation>;
      const link = await activeLink(token);
      const event = await events().findOne({_id:digest(link._id+'/'+link.report.requestId),active:true});
      const audit = event?.incident?.audit ?? [];
      const cover = audit.some(e=>e.action==='dispatch') ? 'harbor' :
        audit.some(e=>e.action==='acknowledge') ? 'sunrise' : 'valley';
      return ctx.response.success({cover,edition:link.report.requestId});
    },{validate:{body:activation}});
    const signal = activation.extend({edition:z.uuid(),requestId:z.uuid(),image:z.enum(['road','bridge','mountain'])});
    router.post('/gallery/select',async ctx => {
      const body = ctx.body as z.output<typeof signal>;
      const link = await activeLink(body.token);
      if (link.report.requestId !== body.edition) throw createHttpError(409,'EXPIRED','Edition changed.');
      const at = new Date();
      const action = 'gallery-'+body.image;
      await events().updateOne({_id:digest(link._id+'/'+body.edition),active:true,
        'incident.audit':{$not:{$elemMatch:{$or:[{requestId:body.requestId},{action,at:{$gt:new Date(at.getTime()-5000)}}]}}}},
        {$push:{'incident.audit':{at,action,requestId:body.requestId}},$inc:{'incident.version':1},
          ...(body.image==='mountain'?{$max:{level:5}}:body.image==='bridge'?{$max:{level:4}}:{})});
      return ctx.response.noContent();
    },{validate:{body:signal}});
  });
});
