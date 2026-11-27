import { tilcayoApi } from '../../app/api';

export type DeliveryState = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
export type NotificationItem = {
  id: string; kind: string; title: string; body: string; link: string; priority: 'normal' | 'emergency';
  createdAt: string; readAt: string | null; acknowledgedAt: string | null;
  deliveries: { channel: 'email' | 'sms'; state: DeliveryState; attempts: number; sentAt: string | null; lastError: string | null }[];
};
export type NotificationPage = { items: NotificationItem[]; unread: number; total: number; hasNext: boolean; page?:number; pageSize?:number; totalPages?:number };
export type NotificationPreferences = { email: boolean; sms: boolean };

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Notifications', 'NotificationPreferences'] });
export const notificationsApi = api.injectEndpoints({ endpoints: b => ({
  notifications: b.query<{ data: NotificationPage }, number>({ query: page => '/individual/notifications?page=' + page, providesTags: ['Notifications'] }),
  unread: b.query<{ data: { unread: number; urgent: number } }, void>({ query: () => '/individual/notifications/unread', providesTags: ['Notifications'] }),
  markRead: b.mutation<unknown, string>({ query: id => ({ url: `/individual/notifications/${id}/read`, method: 'POST' }), invalidatesTags: ['Notifications'] }),
  markAllRead: b.mutation<unknown, void>({ query: () => ({ url: '/individual/notifications/read', method: 'POST' }), invalidatesTags: ['Notifications'] }),
  acknowledge: b.mutation<unknown, string>({ query: id => ({ url: `/individual/notifications/${id}/acknowledge`, method: 'POST' }), invalidatesTags: ['Notifications'] }),
  preferences: b.query<{ data: NotificationPreferences }, void>({ query: () => '/individual/notification-preferences', providesTags: ['NotificationPreferences'] }),
  savePreferences: b.mutation<{ data: NotificationPreferences }, NotificationPreferences>({
    query: body => ({ url: '/individual/notification-preferences', method: 'PUT', body }), invalidatesTags: ['NotificationPreferences'],
  }),
}) });
