import { tilcayoApi } from '../../app/api';

export const relationships = ['family', 'partner', 'friend', 'colleague', 'other'] as const;
export type Relationship = typeof relationships[number];
export type Permissions = { status: boolean; location: boolean; updates: boolean };
export const permissionLabels: Record<keyof Permissions, string> = { status: 'Safety status', location: 'Location', updates: 'Updates' };

export type CircleMember = {
  id: string; email: string; name: string | null; relationship: Relationship; permissions: Permissions;
  state: 'pending' | 'active'; createdAt: string; acceptedAt: string | null;
};
export type CircleOverview = {
  members: CircleMember[];
  circles: { id: string; owner: string; name: string; relationship: Relationship; permissions: Permissions }[];
  invitations: { id: string; name: string; permissions: Permissions; createdAt: string }[];
  checkInRequests: { id: string; name: string; createdAt: string }[];
};
export type PersonView = {
  owner: string; name: string; permissions: Permissions;
  status: { level: number; reportedAt: string | null } | null;
  lastCheckInRequest: { createdAt: string; answeredAt: string | null } | null;
};

export type CircleUpdate = { id: string; text: string; createdAt: string };
export type FeedItem = CircleUpdate & { owner: string; name: string };
export type LocationPoint = { latitude: number; longitude: number; accuracy: number; recordedAt: string };
export type LocationSettings = { sharing: boolean; intervalMinutes: number; retentionDays: number };
export type PersonLocation = { sharing: boolean; latest: LocationPoint | null; history: LocationPoint[] };

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Circle', 'Person', 'Updates', 'Location'] });
export const circleApi = api.injectEndpoints({ endpoints: b => ({
  circle: b.query<{ data: CircleOverview }, void>({ query: () => '/individual/circle', providesTags: ['Circle'] }),
  person: b.query<{ data: PersonView }, string>({ query: owner => '/individual/circle/people/' + owner, providesTags: (_r, _e, owner) => [{ type: 'Person', id: owner }] }),
  invite: b.mutation<{ data: CircleMember }, { email: string; relationship: Relationship; permissions: Permissions }>({
    query: body => ({ url: '/individual/circle', method: 'POST', body }), invalidatesTags: ['Circle'],
  }),
  editMember: b.mutation<{ data: CircleMember }, { id: string; relationship?: Relationship; permissions?: Permissions }>({
    query: ({ id, ...body }) => ({ url: '/individual/circle/' + id, method: 'PATCH', body }), invalidatesTags: ['Circle'],
  }),
  removeMember: b.mutation<unknown, string>({ query: id => ({ url: '/individual/circle/' + id, method: 'DELETE' }), invalidatesTags: ['Circle', 'Person'] }),
  respond: b.mutation<unknown, { id: string; answer: 'accept' | 'reject' }>({
    query: ({ id, answer }) => ({ url: `/individual/circle/${id}/${answer}`, method: 'POST' }), invalidatesTags: ['Circle'],
  }),
  requestCheckIn: b.mutation<unknown, string>({
    query: owner => ({ url: `/individual/circle/people/${owner}/check-in`, method: 'POST' }),
    invalidatesTags: (_r, _e, owner) => [{ type: 'Person', id: owner }],
  }),
  answerCheckIns: b.mutation<unknown, void>({ query: () => ({ url: '/individual/circle/check-in-requests/answer', method: 'POST' }), invalidatesTags: ['Circle'] }),
  myUpdates: b.query<{ data: CircleUpdate[] }, void>({ query: () => '/individual/updates', providesTags: ['Updates'] }),
  feed: b.query<{ data: FeedItem[] }, void>({ query: () => '/individual/circle/feed', providesTags: ['Updates'] }),
  personUpdates: b.query<{ data: CircleUpdate[] }, string>({ query: owner => `/individual/circle/people/${owner}/updates`, providesTags: ['Updates'] }),
  postUpdate: b.mutation<{ data: CircleUpdate }, string>({ query: text => ({ url: '/individual/updates', method: 'POST', body: { text } }), invalidatesTags: ['Updates'] }),
  deleteUpdate: b.mutation<unknown, string>({ query: id => ({ url: '/individual/updates/' + id, method: 'DELETE' }), invalidatesTags: ['Updates'] }),
  locationSettings: b.query<{ data: LocationSettings }, void>({ query: () => '/individual/location/settings', providesTags: ['Location'] }),
  setLocationSharing: b.mutation<{ data: LocationSettings }, boolean>({
    query: sharing => ({ url: '/individual/location/settings', method: 'PUT', body: { sharing } }), invalidatesTags: ['Location'],
  }),
  myLocations: b.query<{ data: LocationPoint[] }, void>({ query: () => '/individual/location', providesTags: ['Location'] }),
  sendLocations: b.mutation<{ data: { accepted: number } }, (Omit<LocationPoint, 'recordedAt'> & { clientId: string; recordedAt: string })[]>({
    query: points => ({ url: '/individual/location', method: 'POST', body: { points } }), invalidatesTags: ['Location'],
  }),
  clearLocations: b.mutation<unknown, void>({ query: () => ({ url: '/individual/location', method: 'DELETE' }), invalidatesTags: ['Location'] }),
  personLocation: b.query<{ data: PersonLocation }, string>({ query: owner => `/individual/circle/people/${owner}/location`, providesTags: ['Location'] }),
}) });
