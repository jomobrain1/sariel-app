import { useState, type FormEvent } from 'react';
import { useAuth } from '../../app/auth';
import { AccountIcon } from '../../components/account-icon';
import { apiMessage, apiStatus } from '../../lib/api-status';
import { toast } from '../../lib/toast';
import { phoneApi } from './phone.api';
import './phone-settings.css';

// "+254 712 345 678" → "+254712345678". Numbers must include the country code.
const normalize = (value: string) => value.replace(/[\s()-]/g, '');
const valid = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);
const pretty = (value: string) => value.replace(/^(\+\d{3})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4');

/** Add, confirm (SMS code) or remove the phone number used for SMS alerts. */
export function PhoneSettings() {
  const { user } = useAuth();
  const account = phoneApi.useAccountQuery(undefined, { skip: !user || !!user.tenant });
  const [requestCode, requesting] = phoneApi.useRequestPhoneCodeMutation();
  const [confirm, confirming] = phoneApi.useConfirmPhoneMutation();
  const [remove, removing] = phoneApi.useRemovePhoneMutation();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  if (!user || user.tenant) return null;
  const current = account.currentData?.data.verifiedPhone ?? null;
  const superadmin = user.platformRole === 'superadmin';

  async function send(event: FormEvent) {
    event.preventDefault();
    const number = normalize(phone);
    setError('');
    if (!valid(number)) { setError(number.startsWith('0') ? 'Start with your country code, e.g. +254 712 345 678.' : 'Enter the number with its country code, e.g. +254 712 345 678.'); return; }
    try {
      await requestCode(number).unwrap();
      setSentTo(number); setCode('');
      toast.success(`We sent a 6-digit code to ${pretty(number)}.`, 'Code sent');
    } catch (failure) {
      const message = apiStatus(failure) === 429 ? 'Too many codes requested. Wait a few minutes and try again.'
        : apiMessage(failure, 'Couldn’t send the code. Try again.');
      setError(message); toast.error(message, 'Code not sent');
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await confirm(code).unwrap();
      toast.success(`${pretty(sentTo)} will now receive Sariel SMS alerts.`, 'Phone number confirmed');
      setEditing(false); setSentTo(''); setPhone(''); setCode('');
    } catch {
      // A wrong code uses up that code, so a new one is needed.
      const message = 'That code didn’t match or has expired. Send a new code.';
      setError(message); setSentTo(''); toast.error(message, 'Not confirmed');
    }
  }
  async function drop() {
    if (!window.confirm('Remove this phone number? You’ll stop getting SMS alerts until you add one again.')) return;
    try { await remove().unwrap(); toast.success('You won’t get SMS alerts until you add a number again.', 'Phone number removed'); }
    catch (failure) { toast.error(apiMessage(failure, 'Couldn’t remove the number. Try again.')); }
  }
  const cancel = () => { setEditing(false); setSentTo(''); setPhone(''); setCode(''); setError(''); };

  return <section className="account-card phone-settings" id="account-phone" aria-labelledby="phone-title">
    <h2 id="phone-title"><AccountIcon name="phone" /> Phone number</h2>
    <p className="phone-intro">{superadmin
      ? 'Used to text you about every new incident, so you can act even when you’re away from the console.'
      : 'Used to text you when someone in your circle reports danger, and for check-in reminders.'}</p>
    {account.isLoading ? <p className="phone-muted">Loading…</p> : !editing ? <div className="phone-current">
      {current ? <><span className="phone-number"><span className="phone-badge">✓ Confirmed</span>{pretty(current)}</span>
        <span className="phone-actions"><button type="button" className="tl-btn tl-btn-outline" onClick={() => { setEditing(true); setPhone(current); }}>Change</button>
          <button type="button" className="tl-btn tl-btn-outline phone-remove" disabled={removing.isLoading} onClick={() => void drop()}>{removing.isLoading ? 'Removing…' : 'Remove'}</button></span></>
        : <><span className="phone-muted">No phone number yet. You won’t get SMS alerts.</span>
          <button type="button" className="tl-btn tl-btn-primary" onClick={() => setEditing(true)}>Add phone number</button></>}
    </div> : !sentTo ? <form className="phone-form" onSubmit={send}>
      <label className="tl-label" htmlFor="phone-input">Phone number with country code</label>
      <input className="tl-input" id="phone-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+254 712 345 678" value={phone} onChange={e => setPhone(e.target.value)} required autoFocus />
      <small className="phone-muted">We’ll text a 6-digit code to confirm it’s yours.</small>
      {error && <p className="tl-alert tl-alert-danger" role="alert">{error}</p>}
      <div className="phone-actions"><button type="button" className="tl-btn tl-btn-outline" onClick={cancel}>Cancel</button>
        <button className="tl-btn tl-btn-primary" disabled={requesting.isLoading}>{requesting.isLoading ? 'Sending…' : 'Send code'}</button></div>
    </form> : <form className="phone-form" onSubmit={verify}>
      <label className="tl-label" htmlFor="phone-code">Enter the code sent to {pretty(sentTo)}</label>
      <input className="tl-input phone-code" id="phone-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="123456" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
      <small className="phone-muted">The code expires in 10 minutes.</small>
      {error && <p className="tl-alert tl-alert-danger" role="alert">{error}</p>}
      <div className="phone-actions"><button type="button" className="tl-btn tl-btn-outline" onClick={() => { setSentTo(''); setError(''); }}>Use a different number</button>
        <button className="tl-btn tl-btn-primary" disabled={confirming.isLoading || code.length !== 6}>{confirming.isLoading ? 'Confirming…' : 'Confirm'}</button></div>
    </form>}
  </section>;
}
