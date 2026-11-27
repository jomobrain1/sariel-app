import { tilcayoApi } from '../../app/api';

export type AccountInfo = { name: string; email: string; username: string | null; verifiedEmail: boolean; verifiedPhone: string | null };

export const phoneApi = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Account'] }).injectEndpoints({ endpoints: b => ({
  account: b.query<{ data: AccountInfo }, void>({ query: () => '/individual/account', providesTags: ['Account'] }),
  requestPhoneCode: b.mutation<unknown, string>({ query: phone => ({ url: '/individual/verification/request', method: 'POST', body: { channel: 'phone', phone } }) }),
  confirmPhone: b.mutation<unknown, string>({ query: code => ({ url: '/individual/verification/confirm', method: 'POST', body: { channel: 'phone', code } }), invalidatesTags: ['Account'] }),
  removePhone: b.mutation<unknown, void>({ query: () => ({ url: '/individual/phone', method: 'DELETE' }), invalidatesTags: ['Account'] }),
}) });
