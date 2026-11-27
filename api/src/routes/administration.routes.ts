import mongoose from 'mongoose';
import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { Config, id, platform, platformOnly, profile, requireTenant, save } from '../administration/config.js';

async function actorNames(records: {actorId?: unknown}[]) {
  const ids = [...new Set(records.map(row=>String(row.actorId)))].filter(value=>mongoose.isObjectIdOrHexString(value));
  const accounts = await mongoose.connection.collection('users').find(
    {_id:{$in:ids.map(value=>new mongoose.Types.ObjectId(value))}}, {projection:{name:1}}
  ).toArray();
  return new Map(accounts.map(account=>[String(account._id),String(account.name)]));
}

export default defineRoutes(router => {
  router.group({prefix:'/api/sariel/admin', middleware:[...auth.requestMiddleware, auth.middleware, platformOnly]}, () => {
    // Grant or revoke platform superadmin. Tilcayo only grants it through the setup script.
    router.put('/users/:id/superadmin', async ctx => {
      const target = String(ctx.params.id);
      if (target === auth.user(ctx).id) throw createHttpError(400, 'SELF_CHANGE', 'You can’t change your own superadmin access.');
      const users = mongoose.connection.collection('users');
      const _id = new mongoose.Types.ObjectId(target);
      const account = await users.findOne({_id, deletedAt: null}, {projection: {roles: 1}});
      if (!account) throw createHttpError(404, 'NOT_FOUND', 'User not found');
      const { superadmin } = ctx.body as { superadmin: boolean };
      if (superadmin) await users.updateOne({_id}, {$addToSet: {roles: 'superadmin'}});
      else {
        if (account.roles?.includes('superadmin') && await users.countDocuments({roles: 'superadmin', deletedAt: null}) <= 1)
          throw createHttpError(409, 'LAST_SUPERADMIN', 'Keep at least one superadmin.');
        // Signing them out ends any platform session that was opened with the old access.
        await users.updateOne({_id}, {$pull: {roles: 'superadmin'}, $inc: {sessionVersion: 1}} as never);
      }
      return ctx.response.success({id: target, superadmin});
    }, {validate: {params: z.strictObject({id}), body: z.strictObject({superadmin: z.boolean()})}});
    router.get('/audit', async ctx => {
      const entries = await mongoose.connection.collection('tilcayo_tenant_audit').find({}).sort({createdAt:-1}).limit(100).toArray();
      const changes = await Config.aggregate([{$unwind:'$history'}, {$sort:{'history.at':-1}}, {$limit:100},
        {$project:{action:'$_id', actorId:'$history.actor', createdAt:'$history.at'}}]);
      const recent=[...entries,...changes].sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)).slice(0,100);
      const names=await actorNames(recent);
      return ctx.response.success(recent.map(entry=>({...entry,actorName:names.get(String(entry.actorId))??'Name unavailable'})));
    });
    router.get('/trash/actors', async ctx=>{
      const ids=String(ctx.query.ids).split(',').map(value=>new mongoose.Types.ObjectId(value));
      if(ctx.query.kind==='users'){
        const records=await mongoose.connection.collection('users').find({_id:{$in:ids},deletedAt:{$ne:null},
          $expr:{$eq:['$deletedAt','$sarielDeletion.at']}},{projection:{'sarielDeletion.name':1}}).toArray();
        return ctx.response.success(Object.fromEntries(records.map(row=>[String(row._id),row.sarielDeletion.name])));
      }
      const deleted=await mongoose.connection.collection('tilcayo_tenant_audit').aggregate<{_id:mongoose.Types.ObjectId;actorId:mongoose.Types.ObjectId}>([
        {$match:{tenantId:{$in:ids},action:'tenant.deleted'}},{$sort:{createdAt:-1,_id:-1}},
        {$group:{_id:'$tenantId',actorId:{$first:'$actorId'}}}
      ]).toArray();
      const names=await actorNames(deleted);
      return ctx.response.success(Object.fromEntries(deleted.map(row=>[String(row._id),names.get(String(row.actorId))??'Name unavailable'])));
    },{validate:{query:z.strictObject({kind:z.enum(['tenants','users']).default('tenants'),ids:z.string().regex(/^[a-f0-9]{24}(,[a-f0-9]{24}){0,49}$/i)})}});
    for (const [path, schema] of [['platform', platform], ['organization/:id', profile]] as const) {
      const params = path === 'platform' ? z.object({}) : z.object({id});
      async function key(tenantId?: string) {
        if (!tenantId) return 'platform';
        await requireTenant(tenantId);
        return 'organization/'+tenantId;
      }
      router.get('/'+path, async ctx => ctx.response.success(await Config.findById(await key(path === 'platform' ? undefined : id.parse(ctx.params.id))).select('value revision')), {validate:{params}});
      router.put('/'+path, async ctx => {
        const {revision,value} = ctx.body as {revision:number;value:unknown};
        const record = await save(await key(path === 'platform' ? undefined : id.parse(ctx.params.id)), revision,value,auth.user(ctx).id);
        return ctx.response.success({revision:record.revision,value:record.value});
      }, {validate:{params, body:z.strictObject({revision:z.number().int().nonnegative(),value:schema})}});
    }
  });
});
