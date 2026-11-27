import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createHttpError } from '@tilcayo/core';
import { open } from './secrets.js';
import { anthropic } from './providers/anthropic.js';
import { gemini } from './providers/gemini.js';
import { ProviderError, type ChatProvider, type ChatRequest, type EmbeddingProvider, type ImageProvider } from './types.js';

export type Capability = 'chat' | 'embeddings' | 'images';
export type ProviderId = 'gemini' | 'anthropic';

/** What each provider can do, with suggested models. Superadmins may type any model the provider offers. */
export const catalog: Record<ProviderId, {label:string; env:string; models:Partial<Record<Capability, string[]>>}> = {
  gemini:{label:'Google Gemini', env:'GEMINI_API_KEY', models:{
    chat:['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    embeddings:['gemini-embedding-001'],
    images:['gemini-2.5-flash-image'],
  }},
  anthropic:{label:'Anthropic Claude', env:'ANTHROPIC_API_KEY', models:{
    chat:['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  }},
};
const adapters = {
  chat:{gemini, anthropic} as Partial<Record<ProviderId, ChatProvider>>,
  embeddings:{gemini} as Partial<Record<ProviderId, EmbeddingProvider>>,
  images:{gemini} as Partial<Record<ProviderId, ImageProvider>>,
};
export const supports = (provider:ProviderId, capability:Capability) => !!adapters[capability][provider];

export type Choice = {provider:ProviderId; model:string};
/** A saved API key. The first key in a provider's list is its default; the rest are spares. */
export interface StoredKey { id:string; label:string; sealed:string; addedAt:Date }
export interface AiSettings {
  _id:'ai';
  chat:Choice; embeddings:Choice; images:Choice;
  /** Backup providers tried in order when the main one fails. */
  fallbacks:{chat:Choice[]};
  keys:Partial<Record<ProviderId, StoredKey[] | string>>; // a bare string is a key saved before multiple keys were supported
  dailyLimit:number; // AI requests per person per day
  updatedAt?:Date; updatedBy?:string;
}
export const defaultSettings: Omit<AiSettings, 'keys'> = {
  _id:'ai',
  chat:{provider:'gemini', model:'gemini-3.8-flash'},
  embeddings:{provider:'gemini', model:'gemini-embedding-001'},
  images:{provider:'gemini', model:'gemini-2.5-flash-image'},
  fallbacks:{chat:[]},
  dailyLimit:100,
};
export const MAX_KEYS = 5;
export const MAX_FALLBACKS = 3;
const MAX_ATTEMPTS = 6;

interface UsageRecord {
  _id:string; at:Date; user:string|null; capability:Capability; purpose:string; provider:ProviderId; model:string;
  keyLabel?:string; fallback?:boolean; input:number; output:number; ok:boolean; error?:string;
}
export const settingsCollection = () => mongoose.connection.collection<AiSettings>('sariel_ai_settings');
export const usage = () => mongoose.connection.collection<UsageRecord>('sariel_ai_usage');
let indexed: Promise<unknown> | undefined;
const ensureIndexes = () => indexed ??= Promise.all([
  usage().createIndex({user:1, at:-1}),
  usage().createIndex({at:1}, {expireAfterSeconds:180 * 24 * 60 * 60}),
]).catch(error => { indexed = undefined; throw error; });

export async function loadSettings(): Promise<AiSettings> {
  const stored = await settingsCollection().findOne({_id:'ai'});
  const settings = {...defaultSettings, keys:{}, ...stored} as AiSettings;
  settings.fallbacks = {chat:stored?.fallbacks?.chat ?? []};
  return settings;
}

/** Saved keys for a provider, in order (default first). Upgrades a legacy single key. */
export function storedKeys(settings:AiSettings, provider:ProviderId): StoredKey[] {
  const value = settings.keys[provider];
  if (!value) return [];
  if (typeof value === 'string') return [{id:'legacy', label:'Key 1', sealed:value, addedAt:new Date(0)}];
  return value;
}

/** Every usable credential for a provider: saved keys in order, then the environment variable. */
export function credentials(settings:AiSettings, provider:ProviderId): {key:string; label:string; source:'stored'|'env'}[] {
  const out: {key:string; label:string; source:'stored'|'env'}[] = [];
  for (const stored of storedKeys(settings, provider)) {
    try { out.push({key:open(stored.sealed, 'ai-key:' + provider).toString(), label:stored.label, source:'stored'}); }
    catch { /* Unreadable after a secret rotation; skip it. */ }
  }
  const env = process.env[catalog[provider].env]?.trim();
  if (env && !out.some(c => c.key === env)) out.push({key:env, label:catalog[provider].env, source:'env'});
  return out;
}
export const keyFor = (settings:AiSettings, provider:ProviderId) => credentials(settings, provider)[0] ?? null;

const unavailable = () => createHttpError(503, 'AI_UNAVAILABLE', 'AI features are not set up yet. Ask an administrator to add a provider key.');

interface Attempt { provider:ProviderId; model:string; apiKey:string; keyLabel:string; fallback:boolean }

/** The order Sariel tries: main provider (each key), then each backup provider (each key). */
function plan(settings:AiSettings, capability:Capability): Attempt[] {
  const choices = [settings[capability], ...(capability === 'chat' ? settings.fallbacks.chat : [])];
  const attempts: Attempt[] = [];
  choices.forEach((choice, index) => {
    if (!supports(choice.provider, capability)) return;
    for (const credential of credentials(settings, choice.provider))
      attempts.push({provider:choice.provider, model:choice.model, apiKey:credential.key, keyLabel:credential.label, fallback:index > 0});
  });
  return attempts.slice(0, MAX_ATTEMPTS);
}

async function enforceLimit(user:string|null, limit:number) {
  if (!user) return;
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  if (await usage().countDocuments({user, at:{$gte:since}, ok:true}) >= limit)
    throw createHttpError(429, 'AI_LIMIT', 'You have reached today’s AI limit. Try again tomorrow.');
}

/**
 * Runs a request through the failover plan. Any provider error (busy, quota, bad key, missing model)
 * moves on to the next key or backup provider. With a single option, a busy provider is retried once.
 */
async function track<T extends {usage:{input:number; output:number}}>(
  capability:Capability, purpose:string, user:string|null, run:(a:Attempt) => Promise<T>,
): Promise<T & {provider:ProviderId; model:string; keyLabel:string; fallback:boolean}> {
  await ensureIndexes();
  const settings = await loadSettings();
  const attempts = plan(settings, capability);
  if (!attempts.length) throw unavailable();
  await enforceLimit(user, settings.dailyLimit);
  if (attempts.length === 1) attempts.push(attempts[0]);
  let last: unknown;
  for (const [index, attempt] of attempts.entries()) {
    if (index > 0 && attempts[index - 1] === attempt) await new Promise(resolve => setTimeout(resolve, 1500));
    const base = {at:new Date(), user, capability, purpose, provider:attempt.provider, model:attempt.model, keyLabel:attempt.keyLabel, fallback:attempt.fallback};
    try {
      const result = await run(attempt);
      await usage().insertOne({_id:randomUUID(), ...base, input:result.usage.input, output:result.usage.output, ok:true});
      return {...result, provider:attempt.provider, model:attempt.model, keyLabel:attempt.keyLabel, fallback:attempt.fallback};
    } catch (error) {
      await usage().insertOne({_id:randomUUID(), ...base, input:0, output:0, ok:false, error:error instanceof Error ? error.message.slice(0, 300) : 'failed'});
      last = error;
      if (!(error instanceof ProviderError)) throw error;
      // A single option that failed for a non-temporary reason won't succeed on retry.
      if (attempts.length === 2 && attempts[0] === attempts[1] && !error.retryable) break;
    }
  }
  if (last instanceof ProviderError) {
    if (last.status === 429) throw createHttpError(429, 'AI_QUOTA', 'The AI service is over its quota or rate limit. Try again later.');
    if (last.retryable) throw createHttpError(503, 'AI_BUSY', 'The AI service is busy right now. Please try again in a minute.');
    throw createHttpError(502, 'AI_PROVIDER_ERROR', 'The AI service rejected the request. An administrator may need to check the model in AI providers.');
  }
  throw last;
}

/** One model call. Usage is recorded per person and counted against the daily limit. */
export const aiChat = (purpose:string, user:string|null, request:ChatRequest) =>
  track('chat', purpose, user, a => adapters.chat[a.provider]!.chat({apiKey:a.apiKey, model:a.model}, request));

export const aiEmbed = (purpose:string, user:string|null, texts:string[], mode:'document'|'query') =>
  track('embeddings', purpose, user, a => adapters.embeddings[a.provider]!.embed({apiKey:a.apiKey, model:a.model}, texts, mode));

export const aiImage = (purpose:string, user:string|null, prompt:string) =>
  track('images', purpose, user, a => adapters.images[a.provider]!.image({apiKey:a.apiKey, model:a.model}, prompt));

/** The embedding model currently in use, so stored vectors can be matched to the model that made them. */
export async function embeddingModelId() {
  const settings = await loadSettings();
  return keyFor(settings, settings.embeddings.provider) ? `${settings.embeddings.provider}:${settings.embeddings.model}` : null;
}
