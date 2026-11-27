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

export interface AiSettings {
  _id:'ai';
  chat:{provider:ProviderId; model:string};
  embeddings:{provider:ProviderId; model:string};
  images:{provider:ProviderId; model:string};
  keys:Partial<Record<ProviderId, string>>; // sealed
  dailyLimit:number; // AI requests per person per day
  updatedAt?:Date; updatedBy?:string;
}
export const defaultSettings: Omit<AiSettings, 'keys'> = {
  _id:'ai',
  chat:{provider:'gemini', model:'gemini-3.8-flash'},
  embeddings:{provider:'gemini', model:'gemini-embedding-001'},
  images:{provider:'gemini', model:'gemini-2.5-flash-image'},
  dailyLimit:100,
};

interface UsageRecord {
  _id:string; at:Date; user:string|null; capability:Capability; purpose:string; provider:ProviderId; model:string;
  input:number; output:number; ok:boolean; error?:string;
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
  return {...defaultSettings, keys:{}, ...stored} as AiSettings;
}

export function keyFor(settings:AiSettings, provider:ProviderId): {key:string; source:'stored'|'env'} | null {
  const sealed = settings.keys[provider];
  if (sealed) {
    try { return {key:open(sealed, 'ai-key:' + provider).toString(), source:'stored'}; }
    catch { /* Unreadable after a secret rotation; fall back to the environment. */ }
  }
  const env = process.env[catalog[provider].env]?.trim();
  return env ? {key:env, source:'env'} : null;
}

const unavailable = () => createHttpError(503, 'AI_UNAVAILABLE', 'AI features are not set up yet. Ask an administrator to add a provider key.');

async function resolve(capability:Capability) {
  const settings = await loadSettings();
  const choice = settings[capability];
  const credential = keyFor(settings, choice.provider);
  if (!credential || !supports(choice.provider, capability)) throw unavailable();
  return {settings, provider:choice.provider, model:choice.model, apiKey:credential.key};
}

async function enforceLimit(user:string|null, limit:number) {
  if (!user) return;
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  if (await usage().countDocuments({user, at:{$gte:since}}) >= limit)
    throw createHttpError(429, 'AI_LIMIT', 'You have reached today’s AI limit. Try again tomorrow.');
}

async function track<T extends {usage:{input:number; output:number}}>(
  capability:Capability, purpose:string, user:string|null, run:(r:Awaited<ReturnType<typeof resolve>>) => Promise<T>,
): Promise<T & {provider:ProviderId; model:string}> {
  await ensureIndexes();
  const resolved = await resolve(capability);
  await enforceLimit(user, resolved.settings.dailyLimit);
  const base = {_id:randomUUID(), at:new Date(), user, capability, purpose, provider:resolved.provider, model:resolved.model};
  try {
    const result = await run(resolved);
    await usage().insertOne({...base, input:result.usage.input, output:result.usage.output, ok:true});
    return {...result, provider:resolved.provider, model:resolved.model};
  } catch (error) {
    await usage().insertOne({...base, input:0, output:0, ok:false, error:error instanceof Error ? error.message.slice(0, 300) : 'failed'});
    if (error instanceof ProviderError) throw createHttpError(error.status === 429 ? 429 : 502, 'AI_PROVIDER_ERROR',
      error.status === 429 ? 'The AI service is busy or over its quota. Try again later.' : 'The AI service rejected the request. An administrator may need to check the model in AI providers.');
    throw error;
  }
}

/** One model call. Usage is recorded per person and counted against the daily limit. */
export const aiChat = (purpose:string, user:string|null, request:ChatRequest) =>
  track('chat', purpose, user, r => adapters.chat[r.provider]!.chat({apiKey:r.apiKey, model:r.model}, request));

export const aiEmbed = (purpose:string, user:string|null, texts:string[], mode:'document'|'query') =>
  track('embeddings', purpose, user, r => adapters.embeddings[r.provider]!.embed({apiKey:r.apiKey, model:r.model}, texts, mode));

export const aiImage = (purpose:string, user:string|null, prompt:string) =>
  track('images', purpose, user, r => adapters.images[r.provider]!.image({apiKey:r.apiKey, model:r.model}, prompt));

/** The embedding model currently in use, so stored vectors can be matched to the model that made them. */
export async function embeddingModelId() {
  const settings = await loadSettings();
  return keyFor(settings, settings.embeddings.provider) ? `${settings.embeddings.provider}:${settings.embeddings.model}` : null;
}
