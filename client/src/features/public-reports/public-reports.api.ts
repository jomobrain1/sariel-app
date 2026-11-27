import { tilcayoApi } from '../../app/api';

export type PublicReportConfig = { uploads: boolean; maxFiles: number; image: { extensions: string[]; maxBytes: number }; video: { extensions: string[]; maxBytes: number } };
export type UploadAuthorization = { publicId: string; uploadUrl: string; fields: Record<string, string | number | boolean>; kind: 'image' | 'video' };
export type PublicReport = {
  id: string; status: 'submitted' | 'reviewing' | 'closed'; description: string; country: string; place: string | null; urgency: 'urgent' | 'soon' | 'information';
  contact: string | null; submittedAt: string; notes: { at: string; byName: string; text: string }[];
  media: { kind: 'image' | 'video'; format?: string | null; bytes?: number; url?: string | null; expiresAt?: string | null }[];
};

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['PublicReports', 'PublicReport'] });
export const publicReportsApi = api.injectEndpoints({ endpoints: b => ({
  publicReportConfig: b.query<{ data: PublicReportConfig }, void>({ query: () => '/auth/public-reports/config' }),
  createPublicReport: b.mutation<{ data: { id: string; token: string } }, Record<string, string>>({ query: body => ({ url: '/auth/public-reports', method: 'POST', body }) }),
  authorizePublicUpload: b.mutation<{ data: UploadAuthorization }, { id: string; token: string; filename: string; bytes: number }>({
    query: ({ id, ...body }) => ({ url: `/auth/public-reports/${id}/uploads`, method: 'POST', body }),
  }),
  completePublicUpload: b.mutation<unknown, { id: string; token: string; publicId: string; filename: string; bytes: number }>({
    query: ({ id, ...body }) => ({ url: `/auth/public-reports/${id}/uploads/complete`, method: 'POST', body }),
  }),
  submitPublicReport: b.mutation<unknown, { id: string; token: string }>({ query: ({ id, token }) => ({ url: `/auth/public-reports/${id}/submit`, method: 'POST', body: { token } }) }),
  // Platform administrators
  adminPublicReports: b.query<{ data: PublicReport[] }, string>({ query: status => '/platform/public-reports?status=' + status, providesTags: ['PublicReports'] }),
  adminPublicReport: b.query<{ data: PublicReport }, string>({ query: id => '/platform/public-reports/' + id, providesTags: (_r, _e, id) => [{ type: 'PublicReport', id }] }),
  updatePublicReport: b.mutation<unknown, { id: string; status?: string; note?: string }>({
    query: ({ id, ...body }) => ({ url: `/platform/public-reports/${id}/update`, method: 'POST', body }), invalidatesTags: (_r, _e, { id }) => ['PublicReports', { type: 'PublicReport', id }],
  }),
  // Approved organisations
  orgPublicReports: b.query<{ data: PublicReport[] }, string>({ query: status => '/organization/public-reports?status=' + status, providesTags: ['PublicReports'] }),
  orgPublicReport: b.query<{ data: PublicReport }, string>({ query: id => '/organization/public-reports/' + id, providesTags: (_r, _e, id) => [{ type: 'PublicReport', id }] }),
  orgPublicReportNote: b.mutation<unknown, { id: string; note: string }>({
    query: ({ id, note }) => ({ url: `/organization/public-reports/${id}/note`, method: 'POST', body: { note } }), invalidatesTags: (_r, _e, { id }) => [{ type: 'PublicReport', id }],
  }),
}) });
