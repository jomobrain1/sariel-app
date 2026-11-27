import { tilcayoApi } from '../../app/api';

export type Onboarding = { onboarded: boolean; details: { residence: string | null; nationality: string | null; preferredLanguage: string | null }; circle: number; contacts: number };
export type EmergencyContact = { id: string; name: string; email: string | null; phone: string | null; relationship: string; createdAt: string };

const api = tilcayoApi.enhanceEndpoints({ addTagTypes: ['Onboarding', 'EmergencyContacts'] });
export const onboardingApi = api.injectEndpoints({ endpoints: b => ({
  onboarding: b.query<{ data: Onboarding }, void>({ query: () => '/individual/onboarding', providesTags: ['Onboarding'] }),
  saveDetails: b.mutation<unknown, { residence?: string; nationality?: string; preferredLanguage?: string }>({
    query: body => ({ url: '/individual/onboarding/details', method: 'PUT', body }), invalidatesTags: ['Onboarding'],
  }),
  completeOnboarding: b.mutation<unknown, void>({ query: () => ({ url: '/individual/onboarding/complete', method: 'POST' }), invalidatesTags: ['Onboarding'] }),
  emergencyContacts: b.query<{ data: EmergencyContact[] }, void>({ query: () => '/individual/emergency-contacts', providesTags: ['EmergencyContacts'] }),
  addContact: b.mutation<{ data: EmergencyContact }, { name: string; email?: string; phone?: string; relationship: string }>({
    query: body => ({ url: '/individual/emergency-contacts', method: 'POST', body }), invalidatesTags: ['EmergencyContacts', 'Onboarding'],
  }),
  removeContact: b.mutation<unknown, string>({ query: id => ({ url: '/individual/emergency-contacts/' + id, method: 'DELETE' }), invalidatesTags: ['EmergencyContacts', 'Onboarding'] }),
}) });
