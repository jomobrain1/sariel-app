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

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Circle', 'Person'] });
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
}) });
