import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { Config, id, platformOnly, profile, requireTenant } from '../administration/config.js';

// An organisation sees incidents only after the platform administrator has verified it AND turned on
// incident access. Until then it is not routed incidents and its staff cannot open any.
interface AccessValue { incidentAccess:boolean; changedBy:string; changedAt:Date }

export async function incidentAccess(tenant:string) {
  const [scope, access] = await Promise.all([Config.findById('organization/' + tenant), Config.findById('access/' + tenant)]);
  const parsed = profile.safeParse(scope?.value);
  const verified = parsed.success && parsed.data.verification === 'verified';
  const enabled = (access?.value as AccessValue | undefined)?.incidentAccess === true;
  return {verified, enabled, allowed:verified && enabled, changedAt:(access?.value as AccessValue | undefined)?.changedAt ?? null};
}

export const notApproved = () => createHttpError(403, 'NOT_APPROVED', 'Your organisation has not been approved to view incidents yet.');

export default defineRoutes(router => {
  router.group({prefix:'/api/sariel/admin/organization/:id/access', middleware:[...auth.requestMiddleware, auth.middleware, platformOnly]}, () => {
    const params = z.object({id});
    router.get('/', async ctx => {
      const tenant = id.parse(ctx.params.id);
      await requireTenant(tenant);
      return ctx.response.success(await incidentAccess(tenant));
    }, {validate:{params}});
    router.put('/', async ctx => {
      const tenant = id.parse(ctx.params.id);
      await requireTenant(tenant);
      const {incidentAccess:enabled} = ctx.body as {incidentAccess:boolean};
      const value:AccessValue = {incidentAccess:enabled, changedBy:auth.user(ctx).id, changedAt:new Date()};
      await Config.findOneAndUpdate({_id:'access/' + tenant}, {$set:{value}, $inc:{revision:1},
        $push:{history:{actor:auth.user(ctx).id, at:value.changedAt, revision:0}}}, {upsert:true, setDefaultsOnInsert:true});
      return ctx.response.success(await incidentAccess(tenant));
    }, {validate:{params, body:z.strictObject({incidentAccess:z.boolean()})}});
  });
});
