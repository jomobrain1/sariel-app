import { defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { platformOnly } from '../administration/config.js';
import { seal } from './secrets.js';
import { aiChat, aiEmbed, aiImage, catalog, keyFor, loadSettings, settingsCollection, supports, usage, type Capability, type ProviderId } from './service.js';

const providerId = z.enum(Object.keys(catalog) as [ProviderId, ...ProviderId[]]);
const model = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:\/-]+$/, 'Use the model name exactly as the provider lists it.');
const choice = z.strictObject({provider:providerId, model});
const settingsBody = z.strictObject({chat:choice, embeddings:choice, images:choice, dailyLimit:z.number().int().min(1).max(10_000)})
  .superRefine((body, ctx) => {
    for (const capability of ['chat', 'embeddings', 'images'] as const)
      if (!supports(body[capability].provider, capability))
        ctx.addIssue({code:'custom', path:[capability, 'provider'], message:`${catalog[body[capability].provider].label} does not offer ${capability}.`});
  });

async function view() {
  const settings = await loadSettings();
  const keys = Object.fromEntries((Object.keys(catalog) as ProviderId[]).map(provider => {
    const credential = keyFor(settings, provider);
    return [provider, credential ? {configured:true, source:credential.source, hint:'••••' + credential.key.slice(-4)} : {configured:false, source:null, hint:null}];
  }));
  return {chat:settings.chat, embeddings:settings.embeddings, images:settings.images, dailyLimit:settings.dailyLimit,
    keys, updatedAt:settings.updatedAt ?? null,
    providers:Object.entries(catalog).map(([id, p]) => ({id, label:p.label, env:p.env, models:p.models,
      capabilities:(['chat', 'embeddings', 'images'] as Capability[]).filter(c => supports(id as ProviderId, c))}))};
}

export default defineRoutes(router => {
  router.group({prefix:'/api/platform/ai', middleware:[...auth.requestMiddleware, auth.middleware, platformOnly]}, () => {
    router.get('/', async ctx => ctx.response.success(await view()));

    router.put('/', async ctx => {
      await settingsCollection().updateOne({_id:'ai'}, {$set:{...(ctx.body as z.output<typeof settingsBody>), updatedAt:new Date(), updatedBy:auth.user(ctx).id}}, {upsert:true});
      return ctx.response.success(await view());
    }, {validate:{body:settingsBody}});

    // Keys are encrypted at rest and never returned; only the last four characters are shown.
    router.put('/keys/:provider', async ctx => {
      const provider = String(ctx.params.provider) as ProviderId;
      const {apiKey} = ctx.body as {apiKey:string};
      await settingsCollection().updateOne({_id:'ai'}, {$set:{['keys.' + provider]:seal(apiKey, 'ai-key:' + provider), updatedAt:new Date(), updatedBy:auth.user(ctx).id}}, {upsert:true});
      return ctx.response.success(await view());
    }, {validate:{params:z.object({provider:providerId}), body:z.strictObject({apiKey:z.string().trim().min(8).max(500)})}});
    router.delete('/keys/:provider', async ctx => {
      await settingsCollection().updateOne({_id:'ai'}, {$unset:{['keys.' + String(ctx.params.provider)]:''}});
      return ctx.response.success(await view());
    }, {validate:{params:z.object({provider:providerId})}});

    // Runs a tiny real request so the admin knows the key and model work.
    router.post('/test', async ctx => {
      const {capability} = ctx.body as {capability:Capability};
      const started = Date.now();
      try {
        let detail = '';
        if (capability === 'chat') {
          const result = await aiChat('admin-test', null, {system:'You are a connectivity check.', maxTokens:256,
            messages:[{role:'user', parts:[{type:'text', text:'Reply with the single word OK.'}]}]});
          detail = result.message.parts.filter(p => p.type === 'text').map(p => p.text).join(' ').slice(0, 80) || '(empty reply)';
        } else if (capability === 'embeddings') {
          const result = await aiEmbed('admin-test', null, ['Sariel connectivity check'], 'query');
          detail = `${result.vectors[0].length} dimensions`;
        } else {
          const result = await aiImage('admin-test', null, 'A simple watercolor painting of a green hill under a blue sky.');
          detail = `${result.mime}, ${Math.round(result.data.length / 1024)} KB`;
        }
        return ctx.response.success({ok:true, latencyMs:Date.now() - started, detail});
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed';
        return ctx.response.success({ok:false, latencyMs:Date.now() - started, detail:message});
      }
    }, {validate:{body:z.strictObject({capability:z.enum(['chat', 'embeddings', 'images'])})}});

    router.get('/usage', async ctx => {
      const days = Number(ctx.query.days);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const [byCapability, byDay, people] = await Promise.all([
        usage().aggregate([{$match:{at:{$gte:since}}}, {$group:{_id:{capability:'$capability', provider:'$provider', model:'$model'},
          requests:{$sum:1}, failures:{$sum:{$cond:['$ok', 0, 1]}}, input:{$sum:'$input'}, output:{$sum:'$output'}}}, {$sort:{requests:-1}}]).toArray(),
        usage().aggregate([{$match:{at:{$gte:since}}}, {$group:{_id:{$dateToString:{format:'%Y-%m-%d', date:'$at'}}, requests:{$sum:1}}}, {$sort:{_id:1}}]).toArray(),
        usage().distinct('user', {at:{$gte:since}, user:{$ne:null}}),
      ]);
      return ctx.response.success({days, people:people.length,
        byCapability:byCapability.map(r => ({...r._id, requests:r.requests, failures:r.failures, input:r.input, output:r.output})),
        byDay:byDay.map(r => ({day:r._id, requests:r.requests}))});
    }, {validate:{query:z.object({days:z.coerce.number().int().min(1).max(180).default(30)})}});
  });
});

