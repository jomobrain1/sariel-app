import { tilcayoApi } from '../../app/api';

export type CoverPhoto = { id: string; kind: 'generated' | 'upload' | 'library'; theme: string | null; width: number; height: number; bytes: number; createdAt: string; expiresAt: string };

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Photos'] });
export const photosApi = api.injectEndpoints({ endpoints: b => ({
  photoThemes: b.query<{ data: { id: string; label: string }[] }, void>({ query: () => '/individual/images/themes' }),
  photos: b.query<{ data: CoverPhoto[] }, void>({ query: () => '/individual/images', providesTags: ['Photos'] }),
  photo: b.query<{ data: { dataUrl: string } }, string>({ query: id => '/individual/images/' + id, keepUnusedDataFor: 300 }),
  generatePhoto: b.mutation<{ data: CoverPhoto }, string>({ query: theme => ({ url: '/individual/images/generate', method: 'POST', body: { theme } }), invalidatesTags: ['Photos'] }),
  uploadPhoto: b.mutation<{ data: CoverPhoto }, { image: string; kind: 'upload' | 'library' }>({
    query: body => ({ url: '/individual/images/upload', method: 'POST', body }), invalidatesTags: ['Photos'],
  }),
  deletePhoto: b.mutation<unknown, string>({ query: id => ({ url: '/individual/images/' + id, method: 'DELETE' }), invalidatesTags: ['Photos'] }),
}) });
