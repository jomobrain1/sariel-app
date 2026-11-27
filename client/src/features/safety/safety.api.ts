import { tilcayoApi } from '../../app/api';

export const labels = ['Unknown', 'Confirmed safe', 'Assistance needed', 'Safety concern', 'Serious danger', 'Critical danger'];
// Travelling is a level-1 (not danger) update with this category; the API reports it as status TRAVELLING.
export const TRAVELLING = 'travelling';
export type Status = { level: number; status?: string; reportedAt: string | null };
export const travelling = (s: Pick<Status, 'status'>) => s.status === 'TRAVELLING';
export const statusLabel = (s: Status) => travelling(s) ? 'Travelling' : labels[s.level];
/** CSS modifier: level-0…level-5, or level-travelling. */
export const statusClass = (s: Status) => 'level-' + (travelling(s) ? 'travelling' : s.level);
export type Coordinates = { latitude: number; longitude: number; accuracy: number; recordedAt?: string; source?: 'report' | 'last-known' };
/** Asks the browser for the current position, for danger reports. Resolves undefined if refused, unavailable or slow. */
export function currentPosition(timeout = 8000): Promise<Coordinates | undefined> {
  if (!('geolocation' in navigator)) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), timeout + 500);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(timer); resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.min(p.coords.accuracy, 100_000), recordedAt: new Date(p.timestamp).toISOString(), source: 'report' }); },
      () => { clearTimeout(timer); resolve(undefined); },
      { enableHighAccuracy: true, timeout, maximumAge: 60_000 });
  });
}
export type Update = { level: number; category: string; country?: string; note?: string; requestId: string; location?: Coordinates };
type Event = { _id: string; level: number; active: boolean; channel: 'account' | 'gateway' | 'welfare' | 'image'; category?: string; createdAt: string };

export const safetyApi = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Safety'] }).injectEndpoints({ endpoints: b => ({
  safetyStatus: b.query<{data: Status}, string>({query: () => '/individual/status', providesTags: ['Safety']}),
  safetyHistory: b.query<{data: Event[]}, string>({query: () => '/individual/status/history', providesTags: ['Safety']}),
  submitSafetyUpdate: b.mutation<{data: {reference: string; notificationsPending?:boolean}}, Update>({query: body => ({url:'/individual/status', method:'POST', body}), invalidatesTags: ['Safety']}),
  issueIncidentLink: b.mutation<{data:{url:string}}, Omit<Update,'requestId'> & {alias?:string}>({
    query: body => ({url:'/individual/incident-link',method:'POST',body}),
  }),
  revokeIncidentLink: b.mutation<unknown,void>({query:()=>({url:'/individual/incident-link',method:'DELETE'})}),
})});
