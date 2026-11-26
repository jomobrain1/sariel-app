import { tilcayoApi } from '../../app/api';

export const labels = ['Unknown', 'Confirmed safe', 'Assistance needed', 'Safety concern', 'Serious danger', 'Critical danger'];
export type Update = { level: number; category: string; country?: string; requestId: string };
type Event = { _id: string; level: number; active: boolean; createdAt: string };
type Identity = { reportUrl: string; codes: {level: number; secret: string}[] };

export const safetyApi = tilcayoApi.injectEndpoints({ endpoints: b => ({
  safetyStatus: b.query<{data: {level: number; reportedAt: string | null}}, string>({query: () => '/individual/status'}),
  safetyHistory: b.query<{data: Event[]}, string>({query: () => '/individual/status/history'}),
  submitSafetyUpdate: b.mutation<{data: {reference: string}}, Update>({query: body => ({url:'/individual/status', method:'POST', body})}),
  issueIncidentLink: b.mutation<{data:{url:string;expires:string}}, Omit<Update,'requestId'> & {alias?:string}>({
    query: body => ({url:'/individual/incident-link',method:'POST',body}),
  }),
  revokeIncidentLink: b.mutation<unknown,void>({query:()=>({url:'/individual/incident-link',method:'DELETE'})}),
  issueReportLink: b.mutation<{data: Identity}, void>({query: () => ({url:'/individual/safety-identity', method:'POST', body:{}})}),
})});
