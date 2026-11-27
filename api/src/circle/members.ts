import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError, defineRoutes, rateLimit } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { individual } from '../individual/account.js';
import { currentStatus, recordStatus } from '../individual/status.js';

export const relationships = ['family', 'partner', 'friend', 'colleague', 'other'] as const;
export const permissionSchema = z.strictObject({status:z.boolean(), location:z.boolean(), updates:z.boolean()});
export type Permissions = z.output<typeof permissionSchema>;
export interface Member {
  _id:string; owner:string; email:string; member:string|null; name:string|null;
  relationship:typeof relationships[number]; permissions:Permissions; state:'pending'|'active';
  createdAt:Date; acceptedAt?:Date;
}
interface CheckInRequest { _id:string; owner:string; requester:string; createdAt:Date; answeredAt:Date|null }

export const members = () => mongoose.connection.collection<Member>('sariel_circle_members');
const checkIns = () => mongoose.connection.collection<CheckInRequest>('sariel_circle_check_ins');
const users = () => mongoose.connection.collection<{_id:mongoose.Types.ObjectId;name:string;email:string;deletedAt:Date|null;suspendedAt:Date|null}>('users');
const MAX_MEMBERS = 50;
const notFound = () => createHttpError(404, 'NOT_FOUND', 'Circle entry unavailable.');
export const objectId = z.string().regex(/^[a-f0-9]{24}$/);

let indexed: Promise<unknown> | undefined;
function ensureIndexes() {
  indexed ??= Promise.all([
    members().createIndex({owner:1, email:1}, {unique:true}),
    members().createIndex({member:1, state:1}),
    members().createIndex({email:1, state:1}),
    checkIns().createIndex({owner:1, answeredAt:1}),
  ]).catch(error => { indexed = undefined; throw error; });
  return indexed;
}

/** The permissions `viewer` holds in `owner`'s circle, or null when they are not an active member. */
export async function access(owner:string, viewer:string): Promise<Permissions | null> {
  if (owner === viewer) return {status:true, location:true, updates:true};
  const entry = await members().findOne({owner, member:viewer, state:'active'}, {projection:{permissions:1}});
  return entry?.permissions ?? null;
}

/** Active members of `owner`'s circle holding the given permission. */
export async function recipients(owner:string, permission:keyof Permissions) {
  const rows = await members().find({owner, state:'active', ['permissions.'+permission]:true}, {projection:{member:1}}).toArray();
  return rows.map(r => r.member!).filter(Boolean);
}

export async function closeCheckInRequests(owner:string) {
  await checkIns().updateMany({owner, answeredAt:null}, {$set:{answeredAt:new Date()}});
}

export async function names(ids:string[]) {
  const valid = [...new Set(ids)].filter(id => /^[a-f0-9]{24}$/.test(id)).map(id => new mongoose.Types.ObjectId(id));
  const rows = valid.length ? await users().find({_id:{$in:valid}}, {projection:{name:1}}).toArray() : [];
  return new Map(rows.map(r => [String(r._id), r.name]));
}

// Hooks let later features (notifications) react to circle events without this module depending on them.
type CircleEvent =
  | {kind:'invited'; entry:Member; ownerName:string}
  | {kind:'accepted'; entry:Member; memberName:string}
  | {kind:'check-in-requested'; owner:string; requester:string; requesterName:string}
  | {kind:'update-posted'; owner:string; ownerName:string; update:string; text:string}
  | {kind:'checked-in'; owner:string};
const listeners: ((event:CircleEvent) => Promise<void>)[] = [];
export function onCircleEvent(listener:(event:CircleEvent) => Promise<void>) { listeners.push(listener); }
export async function emit(event:CircleEvent) {
  await Promise.all(listeners.map(listener => listener(event).catch(() => undefined)));
}

const ownerView = (m:Member) => ({id:m._id, email:m.email, name:m.state === 'active' ? m.name : null,
  relationship:m.relationship, permissions:m.permissions, state:m.state, createdAt:m.createdAt, acceptedAt:m.acceptedAt ?? null});

const invite = z.strictObject({
  email:z.string().trim().toLowerCase().email().max(254),
  relationship:z.enum(relationships).default('family'),
  permissions:permissionSchema,
});
const edit = z.strictObject({relationship:z.enum(relationships).optional(), permissions:permissionSchema.optional()})
  .refine(body => body.relationship || body.permissions, 'Nothing to update.');
const entryParams = z.object({id:z.uuid()});
const personParams = z.object({owner:objectId});
const inviteLimiter = rateLimit({windowMs:60 * 60_000, max:30});

export default defineRoutes(router => {
  router.group({prefix:'/api/individual/circle', middleware:individual}, () => {
    router.get('/', async ctx => {
      await ensureIndexes();
      const user = auth.user(ctx);
      const [mine, joined, invites, requests] = await Promise.all([
        members().find({owner:user.id}).sort({createdAt:-1}).toArray(),
        members().find({member:user.id, state:'active'}).sort({acceptedAt:-1}).toArray(),
        members().find({state:'pending', owner:{$ne:user.id}, $or:[{member:user.id}, {member:null, email:user.email.toLowerCase()}]}).sort({createdAt:-1}).toArray(),
        checkIns().find({owner:user.id, answeredAt:null}).sort({createdAt:-1}).toArray(),
      ]);
      const owners = await names([...joined, ...invites].map(m => m.owner).concat(requests.map(r => r.requester)));
      return ctx.response.success({
        members:mine.map(ownerView),
        circles:joined.map(m => ({id:m._id, owner:m.owner, name:owners.get(m.owner) ?? 'Sariel user', relationship:m.relationship, permissions:m.permissions})),
        invitations:invites.map(m => ({id:m._id, name:owners.get(m.owner) ?? 'Sariel user', permissions:m.permissions, createdAt:m.createdAt})),
        checkInRequests:requests.map(r => ({id:r._id, name:owners.get(r.requester) ?? 'Sariel user', createdAt:r.createdAt})),
      });
    });

    router.post('/', async ctx => {
      await ensureIndexes();
      const user = auth.user(ctx);
      const body = ctx.body as z.output<typeof invite>;
      if (body.email === user.email.toLowerCase()) throw createHttpError(422, 'INVALID_INVITE', 'You cannot invite yourself.');
      if (await members().countDocuments({owner:user.id}) >= MAX_MEMBERS)
        throw createHttpError(422, 'CIRCLE_FULL', `A circle can have up to ${MAX_MEMBERS} people.`);
      // The response is identical whether or not the address has an account, so invites cannot be used to discover users.
      const account = await users().findOne({email:body.email, deletedAt:null, suspendedAt:null}, {projection:{_id:1}});
      const entry:Member = {_id:randomUUID(), owner:user.id, email:body.email, member:account ? String(account._id) : null, name:null,
        relationship:body.relationship, permissions:body.permissions, state:'pending', createdAt:new Date()};
      try { await members().insertOne(entry); }
      catch (error) {
        if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000)
          throw createHttpError(409, 'ALREADY_INVITED', 'This address is already in your circle.');
        throw error;
      }
      await emit({kind:'invited', entry, ownerName:user.name});
      return ctx.response.created(ownerView(entry));
    }, {middleware:[inviteLimiter], validate:{body:invite}});

    router.patch('/:id', async ctx => {
      const body = ctx.body as z.output<typeof edit>;
      const set = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      const result = await members().findOneAndUpdate({_id:String(ctx.params.id), owner:auth.user(ctx).id}, {$set:set}, {returnDocument:'after'});
      if (!result) throw notFound();
      return ctx.response.success(ownerView(result));
    }, {validate:{params:entryParams, body:edit}});

    // Owners remove members and members leave a circle; neither side is notified.
    router.delete('/:id', async ctx => {
      const me = auth.user(ctx).id;
      const result = await members().deleteOne({_id:String(ctx.params.id), $or:[{owner:me}, {member:me, state:'active'}]});
      if (!result.deletedCount) throw notFound();
      return ctx.response.noContent();
    }, {validate:{params:entryParams}});

    const invitedMe = (ctx:Parameters<typeof auth.user>[0]) => {
      const user = auth.user(ctx);
      return {_id:String(ctx.params.id), state:'pending' as const, owner:{$ne:user.id},
        $or:[{member:user.id}, {member:null, email:user.email.toLowerCase()}]};
    };
    router.post('/:id/accept', async ctx => {
      const user = auth.user(ctx);
      const entry = await members().findOneAndUpdate(invitedMe(ctx),
        {$set:{member:user.id, name:user.name, state:'active', acceptedAt:new Date()}}, {returnDocument:'after'});
      if (!entry) throw notFound();
      await emit({kind:'accepted', entry, memberName:user.name});
      return ctx.response.noContent();
    }, {validate:{params:entryParams}});
    router.post('/:id/reject', async ctx => {
      if (!(await members().deleteOne(invitedMe(ctx))).deletedCount) throw notFound();
      return ctx.response.noContent();
    }, {validate:{params:entryParams}});

    // What a member may see about someone whose circle they belong to.
    router.get('/people/:owner', async ctx => {
      const owner = String(ctx.params.owner);
      const viewer = auth.user(ctx).id;
      const permissions = owner === viewer ? null : await access(owner, viewer);
      if (!permissions) throw notFound();
      const [name, request] = await Promise.all([
        names([owner]).then(map => map.get(owner) ?? 'Sariel user'),
        checkIns().find({owner, requester:viewer}).sort({createdAt:-1}).limit(1).next(),
      ]);
      return ctx.response.success({
        owner, name, permissions,
        // Discreet link and gallery reports never reach circle members.
        status:permissions.status ? await currentStatus(owner, ['account', 'welfare', 'image']) : null,
        lastCheckInRequest:request ? {createdAt:request.createdAt, answeredAt:request.answeredAt} : null,
      });
    }, {validate:{params:personParams}});

    router.post('/people/:owner/check-in', async ctx => {
      const owner = String(ctx.params.owner);
      const user = auth.user(ctx);
      if (owner === user.id || !await access(owner, user.id)) throw notFound();
      // One open request per person keeps repeated taps from flooding the owner.
      const open = await checkIns().findOneAndUpdate({owner, requester:user.id, answeredAt:null},
        {$setOnInsert:{_id:randomUUID(), owner, requester:user.id, createdAt:new Date(), answeredAt:null}},
        {upsert:true, returnDocument:'before'});
      if (!open) await emit({kind:'check-in-requested', owner, requester:user.id, requesterName:user.name});
      return ctx.response.noContent();
    }, {middleware:[rateLimit({windowMs:60_000, max:10})], validate:{params:personParams}});

    // Answering records a safe check-in and closes every open request.
    router.post('/check-in-requests/answer', async ctx => {
      const owner = auth.user(ctx).id;
      await recordStatus(owner, {level:1, category:'welfare', requestId:randomUUID()}, 'account');
      await closeCheckInRequests(owner);
      await emit({kind:'checked-in', owner});
      return ctx.response.noContent();
    });
  });
});
