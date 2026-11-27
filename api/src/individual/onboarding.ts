import mongoose from 'mongoose';
import { defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { country } from '../administration/config.js';
import { individual } from './account.js';
import { profiles } from './profile.js';

// The welcome steps shown after registering: a few details, then circle and emergency contacts.
const accounts = () => mongoose.connection.collection<{_id:string; onboardedAt?:Date}>('sariel_individuals');
const details = z.strictObject({
  residence:country.optional(), nationality:country.optional(),
  preferredLanguage:z.enum(['English', 'Kiswahili']).optional(),
});

export default defineRoutes(router => {
  router.group({prefix:'/api/individual/onboarding', middleware:individual}, () => {
    router.get('/', async ctx => {
      const id = auth.user(ctx).id;
      const [account, profile, circle, contacts] = await Promise.all([
        accounts().findOne({_id:id}),
        profiles().findOne({_id:id}),
        mongoose.connection.collection('sariel_circle_members').countDocuments({owner:id}),
        mongoose.connection.collection('sariel_emergency_contacts').countDocuments({owner:id}),
      ]);
      const info = profile?.information ?? {};
      return ctx.response.success({onboarded:!!account?.onboardedAt, details:{residence:info.residence ?? null, nationality:info.nationality ?? null,
        preferredLanguage:info.preferredLanguage ?? null}, circle, contacts});
    });
    // Merges into the safety profile, keeping anything else already saved there.
    router.put('/details', async ctx => {
      const id = auth.user(ctx).id;
      const input = ctx.body as z.output<typeof details>;
      const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => ['information.' + k, v]));
      await profiles().updateOne({_id:id}, {$set:set, $setOnInsert:{disclosure:[]}}, {upsert:true});
      return ctx.response.noContent();
    }, {validate:{body:details}});
    router.post('/complete', async ctx => {
      await accounts().updateOne({_id:auth.user(ctx).id}, {$set:{onboardedAt:new Date()}}, {upsert:true});
      return ctx.response.noContent();
    });
  });
});
