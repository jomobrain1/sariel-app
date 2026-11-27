import { tilcayoApi } from '../../app/api';

export type WelfareSettings = { enabled: boolean; intervalHours: number; graceHours: number; shareLocation: boolean; escalateAfterHours: number | null };
export type WelfareOverview = WelfareSettings & {
  state: 'ok' | 'reminded' | 'concern' | 'escalated' | null;
  lastCheckInAt: string | null; dueAt: string | null;
  options: { intervals: number[]; grace: number[]; escalation: number[] };
  events: { id: string; kind: string; at: string; detail: string | null }[];
};

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Welfare', 'Notifications', 'Safety'] });
export const welfareApi = api.injectEndpoints({ endpoints: b => ({
  welfare: b.query<{ data: WelfareOverview }, void>({ query: () => '/individual/welfare', providesTags: ['Welfare'] }),
  saveWelfare: b.mutation<{ data: WelfareOverview }, WelfareSettings>({
    query: body => ({ url: '/individual/welfare', method: 'PUT', body }), invalidatesTags: ['Welfare'],
  }),
  checkIn: b.mutation<{ data: WelfareOverview }, void>({
    query: () => ({ url: '/individual/welfare/check-in', method: 'POST' }), invalidatesTags: ['Welfare', 'Notifications', 'Safety'],
  }),
}) });
