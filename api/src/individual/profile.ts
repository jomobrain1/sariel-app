import mongoose from 'mongoose';
import { defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { country, id } from '../administration/config.js';
import { individual } from './account.js';

const detail=z.string().trim().min(1).max(500);
const fields=z.strictObject({
  nationality:country, residence:country, employment:detail, recruitmentAgency:detail,
  workplaceAddress:detail, accommodation:detail, emergencyPreferences:detail,
  preferredLanguage:detail, medicalInformation:detail,
});
export const profileInput=z.strictObject({
  information:fields.partial(),
  disclosure:z.array(z.strictObject({tenantId:id, fields:z.array(fields.keyof()).max(9)})).max(30).default([]),
});
type Profile=z.output<typeof profileInput>;
export const profiles=()=>mongoose.connection.collection<Profile & {_id:string}>('sariel_safety_profiles');

export default defineRoutes(router=>{
  router.group({prefix:'/api/individual',middleware:individual},()=>{
    router.get('/safety-profile',async ctx=>{
      return ctx.response.success(await profiles().findOne({_id:auth.user(ctx).id},{projection:{_id:0}}) ?? {information:{},disclosure:[]});
    });
    router.put('/safety-profile',async ctx=>{
      const record=ctx.body as Profile;
      await profiles().replaceOne({_id:auth.user(ctx).id},{_id:auth.user(ctx).id,...record},{upsert:true});
      return ctx.response.noContent();
    },{validate:{body:profileInput}});
    router.delete('/safety-profile',async ctx=>{
      await profiles().deleteOne({_id:auth.user(ctx).id});
      return ctx.response.noContent();
    });
  });
});
