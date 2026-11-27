import { tilcayoApi } from '../../app/api';

export const labels = ['Unknown', 'Confirmed safe', 'Assistance needed', 'Safety concern', 'Serious danger', 'Critical danger'];
export type Update = { level: number; category: string; country?: string; note?: string; requestId: string };
type Event = { _id: string; level: number; active: boolean; channel: 'account' | 'gateway' | 'welfare' | 'image'; category?: string; createdAt: string };

export const safetyApi = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Safety'] }).injectEndpoints({ endpoints: b => ({
  safetyStatus: b.query<{data: {level: number; reportedAt: string | null}}, string>({query: () => '/individual/status', providesTags: ['Safety']}),
  safetyHistory: b.query<{data: Event[]}, string>({query: () => '/individual/status/history', providesTags: ['Safety']}),
  submitSafetyUpdate: b.mutation<{data: {reference: string}}, Update>({query: body => ({url:'/individual/status', method:'POST', body}), invalidatesTags: ['Safety']}),
  issueIncidentLink: b.mutation<{data:{url:string}}, Omit<Update,'requestId'> & {alias?:string}>({
    query: body => ({url:'/individual/incident-link',method:'POST',body}),
  }),
  revokeIncidentLink: b.mutation<unknown,void>({query:()=>({url:'/individual/incident-link',method:'DELETE'})}),
})});
