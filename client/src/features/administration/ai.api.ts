import { tilcayoApi } from '../../app/api';

export type Capability = 'chat' | 'embeddings' | 'images';
export type Choice = { provider: string; model: string };
export type AiSettings = {
  chat: Choice; embeddings: Choice; images: Choice; dailyLimit: number; updatedAt: string | null;
  keys: Record<string, { configured: boolean; source: 'stored' | 'env' | null; hint: string | null }>;
  providers: { id: string; label: string; env: string; models: Partial<Record<Capability, string[]>>; capabilities: Capability[] }[];
};
export type AiUsage = {
  days: number; people: number;
  byCapability: { capability: Capability; provider: string; model: string; requests: number; failures: number; input: number; output: number }[];
  byDay: { day: string; requests: number }[];
};

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['AiSettings', 'AiUsage'] });
export const aiApi = api.injectEndpoints({ endpoints: b => ({
  aiSettings: b.query<{ data: AiSettings }, void>({ query: () => '/platform/ai', providesTags: ['AiSettings'] }),
  saveAiSettings: b.mutation<{ data: AiSettings }, Pick<AiSettings, Capability | 'dailyLimit'>>({
    query: body => ({ url: '/platform/ai', method: 'PUT', body }), invalidatesTags: ['AiSettings'],
  }),
  saveAiKey: b.mutation<{ data: AiSettings }, { provider: string; apiKey: string }>({
    query: ({ provider, apiKey }) => ({ url: '/platform/ai/keys/' + provider, method: 'PUT', body: { apiKey } }), invalidatesTags: ['AiSettings'],
  }),
  removeAiKey: b.mutation<{ data: AiSettings }, string>({ query: provider => ({ url: '/platform/ai/keys/' + provider, method: 'DELETE' }), invalidatesTags: ['AiSettings'] }),
  testAi: b.mutation<{ data: { ok: boolean; latencyMs: number; detail: string } }, Capability>({
    query: capability => ({ url: '/platform/ai/test', method: 'POST', body: { capability } }), invalidatesTags: ['AiUsage'],
  }),
  aiUsage: b.query<{ data: AiUsage }, number>({ query: days => '/platform/ai/usage?days=' + days, providesTags: ['AiUsage'] }),
}) });
