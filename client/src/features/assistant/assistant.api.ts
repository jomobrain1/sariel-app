import { tilcayoApi } from '../../app/api';

export type Language = 'en' | 'sw';
export type ChatSummary = { id: string; title: string; language: Language; updatedAt: string };
export type ChatMessage = {
  id: string; role: 'user' | 'assistant'; text: string; steps: string[]; createdAt: string;
  action: { id: string; tool: string; summary: string; status: 'pending' | 'done' | 'cancelled' | 'failed' } | null;
};
export type ChatDetail = ChatSummary & { messages: ChatMessage[] };

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Chats', 'Chat'] });
export const assistantApi = api.injectEndpoints({ endpoints: b => ({
  chats: b.query<{ data: ChatSummary[] }, void>({ query: () => '/individual/assistant/conversations', providesTags: ['Chats'] }),
  chat: b.query<{ data: ChatDetail }, string>({ query: id => '/individual/assistant/conversations/' + id, providesTags: (_r, _e, id) => [{ type: 'Chat', id }] }),
  newChat: b.mutation<{ data: ChatSummary }, Language>({ query: language => ({ url: '/individual/assistant/conversations', method: 'POST', body: { language } }), invalidatesTags: ['Chats'] }),
  deleteChat: b.mutation<unknown, string>({ query: id => ({ url: '/individual/assistant/conversations/' + id, method: 'DELETE' }), invalidatesTags: ['Chats'] }),
  send: b.mutation<{ data: ChatDetail }, { id: string; text: string }>({
    query: ({ id, text }) => ({ url: `/individual/assistant/conversations/${id}/messages`, method: 'POST', body: { text } }),
    invalidatesTags: (_r, _e, { id }) => ['Chats', { type: 'Chat', id }],
  }),
  decide: b.mutation<{ data: ChatDetail }, { chat: string; action: string; decision: 'confirm' | 'cancel' }>({
    query: ({ action, decision }) => ({ url: '/individual/assistant/actions/' + action, method: 'POST', body: { decision } }),
    invalidatesTags: (_r, _e, { chat }) => ['Chats', { type: 'Chat', id: chat }],
  }),
}) });
