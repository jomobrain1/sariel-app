import { randomUUID } from 'node:crypto';
import { createHttpError, defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { platformOnly } from '../administration/config.js';
import { seal } from './secrets.js';
import { aiChat, aiEmbed, aiImage, catalog, credentials, loadSettings, MAX_FALLBACKS, MAX_KEYS, settingsCollection, storedKeys, supports, usage, type Capability, type ProviderId, type StoredKey } from './service.js';
import { open } from './secrets.js';

const providerId = z.enum(Object.keys(catalog) as [ProviderId, ...ProviderId[]]);
const model = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:\/-]+$/, 'Use the model name exactly as the provider lists it.');
const choice = z.strictObject({provider:providerId, model});
const settingsBody = z.strictObject({chat:choice, embeddings:choice, images:choice, dailyLimit:z.number().int().min(1).max(10_000),
  fallbacks:z.strictObject({chat:z.array(choice).max(MAX_FALLBACKS)}).default({chat:[]})})
  .superRefine((body, ctx) => {
    for (const capability of ['chat', 'embeddings', 'images'] as const)
      if (!supports(body[capability].provider, capability))
        ctx.addIssue({code:'custom', path:[capability, 'provider'], message:`${catalog[body[capability].provider].label} does not offer ${capability}.`});
    body.fallbacks.chat.forEach((fallback, index) => {
      if (!supports(fallback.provider, 'chat')) ctx.addIssue({code:'custom', path:['fallbacks', 'chat', index], message:`${catalog[fallback.provider].label} does not offer chat.`});
    });
  });

function hint(sealed:string, provider:ProviderId) {
  try { return '••••' + open(sealed, 'ai-key:' + provider).toString().slice(-4); } catch { return 'unreadable'; }
}
async function view() {
  const settings = await loadSettings();
  const keys = Object.fromEntries((Object.keys(catalog) as ProviderId[]).map(provider => {
    const list = storedKeys(settings, provider).map((k, index) => ({id:k.id, label:k.label, hint:hint(k.sealed, provider), addedAt:k.addedAt, default:index === 0}));
    const usable = credentials(settings, provider);
    const env = usable.find(c => c.source === 'env');
    return [provider, {configured:usable.length > 0, source:usable[0]?.source ?? null, hint:usable[0] ? '••••' + usable[0].key.slice(-4) : null,
      list, env:env ? '••••' + env.key.slice(-4) : null}];
  }));
  return {chat:settings.chat, embeddings:settings.embeddings, images:settings.images, fallbacks:settings.fallbacks, dailyLimit:settings.dailyLimit,
    keys, updatedAt:settings.updatedAt ?? null, limits:{keys:MAX_KEYS, fallbacks:MAX_FALLBACKS},
    providers:Object.entries(catalog).map(([id, p]) => ({id, label:p.label, env:p.env, models:p.models,
      capabilities:(['chat', 'embeddings', 'images'] as Capability[]).filter(c => supports(id as ProviderId, c))}))};
}

/** Saves a provider's key list, converting a legacy single key on first change. */
async function saveKeys(provider:ProviderId, list:StoredKey[], by:string) {
  await settingsCollection().updateOne({_id:'ai'}, {$set:{['keys.' + provider]:list, updatedAt:new Date(), updatedBy:by}}, {upsert:true});
}

const answeredBy = (r:{provider:ProviderId; model:string; keyLabel:string; fallback:boolean}) =>
  ` · answered by ${catalog[r.provider].label} ${r.model} (${r.keyLabel})${r.fallback ? ' — backup' : ''}`;

export default defineRoutes(router => {
  router.group({prefix:'/api/platform/ai', middleware:[...auth.requestMiddleware, auth.middleware, platformOnly]}, () => {
    router.get('/', async ctx => ctx.response.success(await view()));

    router.put('/', async ctx => {
      await settingsCollection().updateOne({_id:'ai'}, {$set:{...(ctx.body as z.output<typeof settingsBody>), updatedAt:new Date(), updatedBy:auth.user(ctx).id}}, {upsert:true});
      return ctx.response.success(await view());
    }, {validate:{body:settingsBody}});

    // Keys are encrypted at rest and never returned; only the last four characters are shown.
    // Several keys per provider are allowed: the first is the default and the rest are tried if it fails.
    const providerParams = z.object({provider:providerId});
    const keyParams = z.object({provider:providerId, id:z.string().min(1).max(64)});
    router.put('/keys/:provider', async ctx => {
      const provider = String(ctx.params.provider) as ProviderId;
      const {apiKey, label} = ctx.body as {apiKey:string; label?:string};
      const list = storedKeys(await loadSettings(), provider);
      if (list.length >= MAX_KEYS) throw createHttpError(422, 'TOO_MANY_KEYS', `Each provider can have up to ${MAX_KEYS} keys.`);
      list.push({id:randomUUID(), label:label?.trim() || `Key ${list.length + 1}`, sealed:seal(apiKey, 'ai-key:' + provider), addedAt:new Date()});
      await saveKeys(provider, list, auth.user(ctx).id);
      return ctx.response.success(await view());
    }, {validate:{params:providerParams, body:z.strictObject({apiKey:z.string().trim().min(8).max(500), label:z.string().trim().max(40).optional()})}});
    router.post('/keys/:provider/:id/default', async ctx => {
      const provider = String(ctx.params.provider) as ProviderId;
      const list = storedKeys(await loadSettings(), provider);
      const index = list.findIndex(k => k.id === String(ctx.params.id));
      if (index < 0) throw createHttpError(404, 'NOT_FOUND', 'Key not found.');
      list.unshift(...list.splice(index, 1));
      await saveKeys(provider, list, auth.user(ctx).id);
      return ctx.response.success(await view());
    }, {validate:{params:keyParams}});
    router.delete('/keys/:provider/:id', async ctx => {
      const provider = String(ctx.params.provider) as ProviderId;
      const list = storedKeys(await loadSettings(), provider);
      const next = list.filter(k => k.id !== String(ctx.params.id));
      if (next.length === list.length) throw createHttpError(404, 'NOT_FOUND', 'Key not found.');
      await saveKeys(provider, next, auth.user(ctx).id);
      return ctx.response.success(await view());
    }, {validate:{params:keyParams}});
    router.delete('/keys/:provider', async ctx => {
      await settingsCollection().updateOne({_id:'ai'}, {$unset:{['keys.' + String(ctx.params.provider)]:''}});
      return ctx.response.success(await view());
    }, {validate:{params:providerParams}});

    // Runs a tiny real request so the admin knows the key and model work.
    router.post('/test', async ctx => {
      const {capability} = ctx.body as {capability:Capability};
      const started = Date.now();
      try {
        let detail = '';
        if (capability === 'chat') {
          const result = await aiChat('admin-test', null, {system:'You are a connectivity check.', maxTokens:256,
            messages:[{role:'user', parts:[{type:'text', text:'Reply with the single word OK.'}]}]});
          detail = (result.message.parts.filter(p => p.type === 'text').map(p => p.text).join(' ').slice(0, 80) || '(empty reply)') + answeredBy(result);
        } else if (capability === 'embeddings') {
          const result = await aiEmbed('admin-test', null, ['Sariel connectivity check'], 'query');
          detail = `${result.vectors[0].length} dimensions` + answeredBy(result);
        } else {
          const result = await aiImage('admin-test', null, 'A simple watercolor painting of a green hill under a blue sky.');
          detail = `${result.mime}, ${Math.round(result.data.length / 1024)} KB` + answeredBy(result);
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
          requests:{$sum:1}, failures:{$sum:{$cond:['$ok', 0, 1]}}, backups:{$sum:{$cond:[{$and:['$ok', '$fallback']}, 1, 0]}}, input:{$sum:'$input'}, output:{$sum:'$output'}}}, {$sort:{requests:-1}}]).toArray(),
        usage().aggregate([{$match:{at:{$gte:since}}}, {$group:{_id:{$dateToString:{format:'%Y-%m-%d', date:'$at'}}, requests:{$sum:1}}}, {$sort:{_id:1}}]).toArray(),
        usage().distinct('user', {at:{$gte:since}, user:{$ne:null}}),
      ]);
      return ctx.response.success({days, people:people.length,
        byCapability:byCapability.map(r => ({...r._id, requests:r.requests, failures:r.failures, backups:r.backups, input:r.input, output:r.output})),
        byDay:byDay.map(r => ({day:r._id, requests:r.requests}))});
    }, {validate:{query:z.object({days:z.coerce.number().int().min(1).max(180).default(30)})}});
  });
});

