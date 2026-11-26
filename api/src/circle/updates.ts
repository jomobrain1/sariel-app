import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes, rateLimit } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from '../individual/account.js';
import { access, emit, members, names, objectId } from './members.js';

interface Update { _id:string; owner:string; text:string; createdAt:Date }
export const updates = () => mongoose.connection.collection<Update>('sariel_circle_updates');
const view = (u:Update) => ({id:u._id, text:u.text, createdAt:u.createdAt});

let indexed: Promise<unknown> | undefined;
const ensureIndexes = () => indexed ??= updates().createIndex({owner:1, createdAt:-1}).catch(error => { indexed = undefined; throw error; });

export default defineRoutes(router => {
  router.group({prefix:'/api/individual', middleware:individual}, () => {
    router.get('/updates', async ctx => {
      await ensureIndexes();
      const rows = await updates().find({owner:auth.user(ctx).id}).sort({createdAt:-1}).limit(50).toArray();
      return ctx.response.success(rows.map(view));
    });

    router.post('/updates', async ctx => {
      await ensureIndexes();
      const user = auth.user(ctx);
      const update:Update = {_id:randomUUID(), owner:user.id, text:(ctx.body as {text:string}).text, createdAt:new Date()};
      await updates().insertOne(update);
      await emit({kind:'update-posted', owner:user.id, ownerName:user.name, update:update._id, text:update.text});
      return ctx.response.created(view(update));
    }, {middleware:[rateLimit({windowMs:60_000, max:20})], validate:{body:z.strictObject({text:z.string().trim().min(1).max(280)})}});

    router.delete('/updates/:id', async ctx => {
      const result = await updates().deleteOne({_id:String(ctx.params.id), owner:auth.user(ctx).id});
      if (!result.deletedCount) throw createHttpError(404, 'NOT_FOUND', 'Update unavailable.');
      return ctx.response.noContent();
    }, {validate:{params:z.object({id:z.uuid()})}});

    // Latest updates from everyone who shares updates with the viewer.
    router.get('/circle/feed', async ctx => {
      await ensureIndexes();
      const viewer = auth.user(ctx).id;
      const sharing = await members().find({member:viewer, state:'active', 'permissions.updates':true}, {projection:{owner:1}}).toArray();
      const owners = sharing.map(m => m.owner);
      const rows = owners.length ? await updates().find({owner:{$in:owners}}).sort({createdAt:-1}).limit(50).toArray() : [];
      const people = await names(owners);
      return ctx.response.success(rows.map(u => ({...view(u), owner:u.owner, name:people.get(u.owner) ?? 'Sariel user'})));
    });

    router.get('/circle/people/:owner/updates', async ctx => {
      const owner = String(ctx.params.owner);
      const permissions = await access(owner, auth.user(ctx).id);
      if (!permissions?.updates) throw createHttpError(404, 'NOT_FOUND', 'Updates unavailable.');
      const rows = await updates().find({owner}).sort({createdAt:-1}).limit(20).toArray();
      return ctx.response.success(rows.map(view));
    }, {validate:{params:z.object({owner:objectId})}});
  });
});
