import { useState, type FormEvent } from 'react';
import { AccountIcon } from '../../components/account-icon';
import { apiStatus } from '../../lib/api-status';
import { onboardingApi } from './onboarding.api';
import './onboarding.css';

const relationships = ['family', 'partner', 'friend', 'colleague', 'other'];

/** Add and remove emergency contacts: people who get a discreet email or text if you report danger. */
export function EmergencyContacts({ compact = false }: { compact?: boolean }) {
  const list = onboardingApi.useEmergencyContactsQuery();
  const [add, adding] = onboardingApi.useAddContactMutation();
  const [remove] = onboardingApi.useRemoveContactMutation();
  const [form, setForm] = useState({ name: '', email: '', phone: '', relationship: 'family' });
  const [error, setError] = useState('');
  const contacts = list.currentData?.data ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!form.email.trim() && !form.phone.trim()) { setError('Add an email address or phone number.'); return; }
    try {
      await add({ name: form.name.trim(), relationship: form.relationship, ...(form.email.trim() ? { email: form.email.trim() } : {}), ...(form.phone.trim() ? { phone: form.phone.replace(/\s+/g, '') } : {}) }).unwrap();
      setForm({ name: '', email: '', phone: '', relationship: form.relationship });
    } catch (failure) {
      setError(apiStatus(failure) === 422 ? 'Check the details. Phone numbers need the country code, e.g. +254712345678.' : 'Couldn’t add the contact. Try again.');
    }
  }
  return <div className={'contacts' + (compact ? ' is-compact' : '')}>
    {!!contacts.length && <ul className="contacts-list">{contacts.map(c => <li key={c.id}>
      <span className="contacts-avatar" aria-hidden="true">{c.name[0]?.toUpperCase()}</span>
      <div><strong>{c.name}</strong><small>{[c.relationship[0].toUpperCase() + c.relationship.slice(1), c.email, c.phone].filter(Boolean).join(' · ')}</small></div>
      <button type="button" className="contacts-remove" aria-label={`Remove ${c.name}`} onClick={() => void remove(c.id)}>Remove</button>
    </li>)}</ul>}
    {contacts.length < 10 && <form className="contacts-form" onSubmit={submit}>
      <label>Name<input required maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mum" /></label>
      <label>Relationship<select value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })}>
        {relationships.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></label>
      <label>Email<input type="email" maxLength={254} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" /></label>
      <label>Phone (optional)<input type="tel" maxLength={20} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+254712345678" /></label>
      {error && <p role="alert" className="contacts-error">{error}</p>}
      <button className="contacts-add" disabled={adding.isLoading || !form.name.trim()}><AccountIcon name="user" /> {adding.isLoading ? 'Adding…' : 'Add contact'}</button>
    </form>}
    <p className="contacts-note">They don’t need Sariel. If you report danger, send a report photo or miss a check-in, they get a discreet email or text. If they join Sariel with the same email, they can see what happened.</p>
  </div>;
}
