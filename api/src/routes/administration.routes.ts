import mongoose from 'mongoose';
import { defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { Config, id, platform, platformOnly, profile, requireTenant, save } from '../administration/config.js';

export default defineRoutes(router => {
  router.group({prefix:'/api/sariel/admin', middleware:[...auth.requestMiddleware, auth.middleware, platformOnly]}, () => {
    router.get('/audit', async ctx => {
      const entries = await mongoose.connection.collection('tilcayo_tenant_audit').find({}).sort({createdAt:-1}).limit(100).toArray();
      const changes = await Config.aggregate([{$unwind:'$history'}, {$sort:{'history.at':-1}}, {$limit:100},
        {$project:{action:'$_id', actorId:'$history.actor', createdAt:'$history.at'}}]);
      return ctx.response.success([...entries,...changes].sort((a,b) => Number(b.createdAt)-Number(a.createdAt)).slice(0,100));
    });
    for (const [path, schema] of [['platform', platform], ['organization/:id', profile]] as const) {
      const params = path === 'platform' ? z.object({}) : z.object({id});
      async function key(tenantId?: string) {
        if (!tenantId) return 'platform';
        await requireTenant(tenantId);
        return 'organization/'+tenantId;
      }
      router.get('/'+path, async ctx => ctx.response.success(await Config.findById(await key(ctx.params.id)).select('value revision')), {validate:{params}});
      router.put('/'+path, async ctx => {
        const {revision,value} = ctx.body as {revision:number;value:unknown};
        const record = await save(await key(ctx.params.id), revision,value,auth.user(ctx).id);
        return ctx.response.success({revision:record.revision,value:record.value});
      }, {validate:{params, body:z.strictObject({revision:z.number().int().nonnegative(),value:schema})}});
    }
  });
});
