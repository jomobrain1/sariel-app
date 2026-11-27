import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { AccountIcon } from '../../components/account-icon';
import { inviteError } from '../../lib/api-status';
import { circleApi } from '../circle/circle.api';
import { EmergencyContacts } from './contacts-card';
import { onboardingApi } from './onboarding.api';
import './onboarding.css';

const countries: [string, string][] = [['KE', 'Kenya'], ['UG', 'Uganda'], ['TZ', 'Tanzania'], ['ET', 'Ethiopia'], ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'],
  ['QA', 'Qatar'], ['KW', 'Kuwait'], ['OM', 'Oman'], ['BH', 'Bahrain'], ['LB', 'Lebanon'], ['JO', 'Jordan'], ['GB', 'United Kingdom'], ['US', 'United States']];

function Details({ next }: { next: () => void }) {
  const state = onboardingApi.useOnboardingQuery();
  const [save, saving] = onboardingApi.useSaveDetailsMutation();
  const current = state.currentData?.data.details;
  const [form, setForm] = useState<{ residence?: string; nationality?: string; preferredLanguage?: string }>({});
  const value = { residence: form.residence ?? current?.residence ?? '', nationality: form.nationality ?? current?.nationality ?? '', preferredLanguage: form.preferredLanguage ?? current?.preferredLanguage ?? 'English' };
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await save({ preferredLanguage: value.preferredLanguage, ...(value.residence ? { residence: value.residence } : {}), ...(value.nationality ? { nationality: value.nationality } : {}) }).unwrap();
      next();
    } catch { /* Shown below. */ }
  }
  return <form className="welcome-step" onSubmit={submit}>
    <p className="welcome-kicker">Step 1 of 3</p>
    <h1>A few details</h1>
    <p>These help Sariel route a report to the right organisations. Only verified responders you allow can see them.</p>
    <div className="welcome-fields">
      <label>Where you live now<select value={value.residence} onChange={e => setForm({ ...form, residence: e.target.value })}><option value="">Choose a country</option>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
      <label>Nationality<select value={value.nationality} onChange={e => setForm({ ...form, nationality: e.target.value })}><option value="">Choose a country</option>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
      <label>Language<select value={value.preferredLanguage} onChange={e => setForm({ ...form, preferredLanguage: e.target.value })}><option>English</option><option>Kiswahili</option></select></label>
    </div>
    {saving.isError && <p role="alert" className="welcome-error">Couldn’t save. Try again.</p>}
    <div className="welcome-actions"><button type="button" className="welcome-skip" onClick={next}>Skip for now</button>
      <button className="welcome-primary" disabled={saving.isLoading}>{saving.isLoading ? 'Saving…' : 'Continue'}</button></div>
  </form>;
}

function Circle({ next, back }: { next: () => void; back: () => void }) {
  const [invite, inviting] = circleApi.useInviteMutation();
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<'family' | 'partner' | 'friend' | 'colleague' | 'other'>('family');
  const [sent, setSent] = useState<{ email: string; relationship: string }[]>([]);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await invite({ email: email.trim(), relationship, permissions: { status: true, location: false, updates: true } }).unwrap();
      setSent([...sent, { email: email.trim(), relationship }]); setEmail('');
    } catch (failure) { setError(inviteError(failure)); }
  }
  return <div className="welcome-step">
    <p className="welcome-kicker">Step 2 of 3</p>
    <h1>Who looks out for you?</h1>
    <p>Invite people you trust to your circle. They see your safety status and updates once they accept, and you can change what each person sees later. People without Sariel see the invite when they sign up with that email.</p>
    <form className="welcome-invite" onSubmit={submit}>
      <label>Email address<input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
      <label>Relationship<select value={relationship} onChange={e => setRelationship(e.target.value as typeof relationship)}>{['family', 'partner', 'friend', 'colleague', 'other'].map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></label>
      <button className="welcome-primary" disabled={inviting.isLoading}>Invite</button>
    </form>
    {error && <p role="alert" className="welcome-error">{error}</p>}
    {!!sent.length && <ul className="welcome-invited">{sent.map(s => <li key={s.email}><AccountIcon name="mail" /><span>{s.email} <small>· {s.relationship} · invite sent</small></span></li>)}</ul>}
    <div className="welcome-actions"><button type="button" className="welcome-ghost" onClick={back}>Back</button>
      <div><button type="button" className="welcome-skip" onClick={next}>Skip</button><button type="button" className="welcome-primary" onClick={next}>Continue</button></div></div>
  </div>;
}

function Contacts({ next, back }: { next: () => void; back: () => void }) {
  return <div className="welcome-step">
    <p className="welcome-kicker">Step 3 of 3</p>
    <h1>Emergency contacts</h1>
    <p>Add people to tell if something happens, even if they don’t use Sariel.</p>
    <EmergencyContacts />
    <div className="welcome-actions"><button type="button" className="welcome-ghost" onClick={back}>Back</button>
      <button type="button" className="welcome-primary" onClick={next}>Finish</button></div>
  </div>;
}

function Done() {
  const links = [
    { to: '/dashboard', icon: 'shield', title: 'Go to your dashboard', text: 'Report, check in and see your status' },
    { to: '/dashboard', icon: 'calendar', title: 'Set up scheduled check-ins', text: 'Your circle is told if you go quiet' },
    { to: '/photos', icon: 'image', title: 'Prepare a report photo', text: 'Hide a report inside an ordinary picture' },
  ] as const;
  return <div className="welcome-step">
    <p className="welcome-kicker">All set</p>
    <h1>You’re ready</h1>
    <p>You can change your details, circle and emergency contacts at any time from the Circle page and your profile.</p>
    <div className="welcome-done">{links.map(l => <Link key={l.title} to={l.to}><span className="welcome-icon"><AccountIcon name={l.icon} /></span><span><strong>{l.title}</strong><small>{l.text}</small></span><AccountIcon name="arrow" /></Link>)}</div>
  </div>;
}

export function WelcomePage() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [complete] = onboardingApi.useCompleteOnboardingMutation();
  const navigate = useNavigate();
  if (user?.tenant || user?.platformRole === 'superadmin') return <Navigate to="/dashboard" replace />;
  const finish = () => { void complete(); setStep(3); };
  return <section className="welcome" aria-label="Welcome to Sariel">
    <div className="welcome-progress" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className={i <= step ? 'is-done' : undefined} />)}</div>
    {step === 0 && <Details next={() => setStep(1)} />}
    {step === 1 && <Circle next={() => setStep(2)} back={() => setStep(0)} />}
    {step === 2 && <Contacts next={finish} back={() => setStep(1)} />}
    {step === 3 && <Done />}
    {step < 3 && <p style={{ textAlign: 'center', marginTop: 16 }}><button type="button" className="welcome-skip" onClick={() => { void complete(); navigate('/dashboard'); }}>Skip setup, go to the dashboard</button></p>}
  </section>;
}
