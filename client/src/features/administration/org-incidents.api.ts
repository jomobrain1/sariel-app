import { tilcayoApi } from '../../app/api';

export type IncidentAccess = { allowed: boolean; verified: boolean; enabled: boolean; responder: boolean; manager?: boolean; changedAt: string | null };
export type OrgIncidentRow = { handle: string; state: string; officer: string | null; createdAt: string };
export type OrgIncident = {
  handle: string; state: string; version: number; officer: string | null; category?: string; severity?: string; country?: string; reference?: string;
  timeline: { at: string; action: string; actorName?: string; note?: string }[];
};
export type OrgCommand = { action: 'acknowledge' } | { action: 'dispatch'; confirmed: true } | { action: 'note'; note: string } | { action: 'resolve'; note: string };

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['OrgIncidents', 'OrgIncident', 'OrgAccess'] });
export const orgIncidentsApi = api.injectEndpoints({ endpoints: b => ({
  incidentAccess: b.query<{ data: IncidentAccess }, void>({ query: () => '/incidents/access', providesTags: ['OrgAccess'] }),
  orgIncidents: b.query<{ data: OrgIncidentRow[] }, number>({ query: page => '/incidents/?page=' + page, providesTags: ['OrgIncidents'] }),
  orgIncident: b.query<{ data: OrgIncident }, string>({ query: handle => '/incidents/' + handle, providesTags: (_r, _e, h) => [{ type: 'OrgIncident', id: h }] }),
  orgAction: b.mutation<unknown, { handle: string; version: number; command: OrgCommand }>({
    query: ({ handle, ...body }) => ({ url: `/incidents/${handle}/actions`, method: 'POST', body }),
    invalidatesTags: (_r, _e, { handle }) => ['OrgIncidents', { type: 'OrgIncident', id: handle }],
  }),
  organizationAccess: b.query<{ data: IncidentAccess }, string>({ query: id => `/sariel/admin/organization/${id}/access`, providesTags: ['OrgAccess'] }),
  setOrganizationAccess: b.mutation<{ data: IncidentAccess }, { id: string; incidentAccess: boolean }>({
    query: ({ id, incidentAccess }) => ({ url: `/sariel/admin/organization/${id}/access`, method: 'PUT', body: { incidentAccess } }), invalidatesTags: ['OrgAccess'],
  }),
}) });
