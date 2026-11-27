import { tilcayoApi } from '../../app/api';

export type ReportPhoto = { id: string; level: number; status: string; category: string; country: string | null; description: string | null; link: string; createdAt: string; revoked: boolean; lastUsedAt: string | null; uses: number };
export type CreatedReportPhoto = ReportPhoto & { dataUrl: string; filename: string };
export type CoverPhoto = { id: string; kind: 'generated' | 'upload' | 'library'; theme: string | null; width: number; height: number; bytes: number; createdAt: string; expiresAt: string };

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Photos', 'ReportPhotos'] });
export const photosApi = api.injectEndpoints({ endpoints: b => ({
  photoThemes: b.query<{ data: { id: string; label: string }[] }, void>({ query: () => '/individual/images/themes' }),
  photos: b.query<{ data: CoverPhoto[] }, void>({ query: () => '/individual/images', providesTags: ['Photos'] }),
  photo: b.query<{ data: { dataUrl: string } }, string>({ query: id => '/individual/images/' + id, keepUnusedDataFor: 300 }),
  generatePhoto: b.mutation<{ data: CoverPhoto }, string>({ query: theme => ({ url: '/individual/images/generate', method: 'POST', body: { theme } }), invalidatesTags: ['Photos'] }),
  uploadPhoto: b.mutation<{ data: CoverPhoto }, { image: string; kind: 'upload' | 'library' }>({
    query: body => ({ url: '/individual/images/upload', method: 'POST', body }), invalidatesTags: ['Photos'],
  }),
  deletePhoto: b.mutation<unknown, string>({ query: id => ({ url: '/individual/images/' + id, method: 'DELETE' }), invalidatesTags: ['Photos'] }),
  reportPhotos: b.query<{ data: ReportPhoto[] }, void>({ query: () => '/individual/report-photos', providesTags: ['ReportPhotos'] }),
  createReportPhoto: b.mutation<{ data: CreatedReportPhoto }, { coverId: string; level: number; category: string; country?: string; description?: string }>({
    query: body => ({ url: '/individual/report-photos', method: 'POST', body }), invalidatesTags: ['ReportPhotos'],
  }),
  revokeReportPhoto: b.mutation<unknown, string>({ query: id => ({ url: '/individual/report-photos/' + id, method: 'DELETE' }), invalidatesTags: ['ReportPhotos'] }),
  revokeAllReportPhotos: b.mutation<unknown, void>({ query: () => ({ url: '/individual/report-photos/revoke-all', method: 'POST' }), invalidatesTags: ['ReportPhotos'] }),
}) });
