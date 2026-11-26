import { useState, type FormEvent } from 'react';
import { AccountIcon } from '../../components/account-icon';
import { welfareApi, type WelfareOverview, type WelfareSettings } from './welfare.api';
import './welfare.css';

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function until(value: string) {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return 'Overdue';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`;
}
const stateText = {
  ok: { label: 'On track', tone: 'ok' },
  reminded: { label: 'Check-in due', tone: 'due' },
  concern: { label: 'Missed check-in', tone: 'alert' },
  escalated: { label: 'Missed check-in · responders told', tone: 'alert' },
} as const;
const eventText: Record<string, string> = {
  enabled: 'Check-ins turned on', disabled: 'Check-ins turned off', 'check-in': 'Checked in', reminder: 'Reminder sent',
  concern: 'Circle alerted', escalated: 'Responders notified', resolved: 'Concern cleared',
};

function Settings({ data, done }: { data: WelfareOverview; done: () => void }) {
  const [save, saving] = welfareApi.useSaveWelfareMutation();
  const [form, setForm] = useState<WelfareSettings>({ enabled: true, intervalHours: data.intervalHours, graceHours: data.graceHours,
    shareLocation: data.shareLocation, escalateAfterHours: data.escalateAfterHours });
  async function submit(event: FormEvent) {
    event.preventDefault();
    try { await save(form).unwrap(); done(); } catch { /* Error shown below. */ }
  }
  return <form className="welfare-form" onSubmit={submit}>
    <label>Check in every<select value={form.intervalHours} onChange={e => setForm({ ...form, intervalHours: Number(e.target.value) })}>
      {data.options.intervals.map(h => <option key={h} value={h}>{h} hours</option>)}</select></label>
    <label>Wait before alerting my circle<select value={form.graceHours} onChange={e => setForm({ ...form, graceHours: Number(e.target.value) })}>
      {data.options.grace.map(h => <option key={h} value={h}>{h} {h === 1 ? 'hour' : 'hours'}</option>)}</select></label>
    <label className="welfare-check"><input type="checkbox" checked={form.shareLocation} onChange={e => setForm({ ...form, shareLocation: e.target.checked })} />
      <span>Include my last location in the alert<small>Only for people who already have location access.</small></span></label>
    <label>If I still don’t respond<select value={form.escalateAfterHours ?? ''} onChange={e => setForm({ ...form, escalateAfterHours: e.target.value ? Number(e.target.value) : null })}>
      <option value="">Only alert my circle</option>
      {data.options.escalation.map(h => <option key={h} value={h}>Also tell responders after {h} hours</option>)}</select></label>
    {saving.isError && <p role="alert" className="welfare-error">Couldn’t save. Try again.</p>}
    <div className="welfare-actions">
      <button className="welfare-primary" disabled={saving.isLoading}>{data.enabled ? 'Save changes' : 'Turn on check-ins'}</button>
      <button type="button" className="welfare-ghost" onClick={done}>Cancel</button>
    </div>
  </form>;
}

/** Scheduled check-ins: a missed one raises a concern for the circle, never an automatic emergency. */
export function WelfareCard() {
  const welfare = welfareApi.useWelfareQuery(undefined, { pollingInterval: 60_000, refetchOnFocus: true });
  const [checkIn, checking] = welfareApi.useCheckInMutation();
  const [save, saving] = welfareApi.useSaveWelfareMutation();
  const [editing, setEditing] = useState(false);
  const data = welfare.currentData?.data;
  if (!data) return <section className="safety-panel welfare-card"><p role="status">{welfare.isError ? 'Couldn’t load check-ins.' : 'Loading check-ins…'}</p></section>;
  const state = data.state ? stateText[data.state] : null;
  return <section className={'safety-panel welfare-card' + (state ? ' tone-' + state.tone : '')} aria-labelledby="welfare-title">
    <div className="welfare-head">
      <span className="welfare-icon"><AccountIcon name="calendar" /></span>
      <div><h2 id="welfare-title">Scheduled check-ins</h2>
        <p>{data.enabled ? `Every ${data.intervalHours} hours` : 'Let your circle know if you go quiet.'}</p></div>
      {state && <span className="welfare-pill">{state.label}</span>}
    </div>
    {editing ? <Settings data={data} done={() => setEditing(false)} /> : data.enabled ? <>
      <dl className="welfare-facts">
        <div><dt>Next check-in</dt><dd>{data.dueAt ? until(data.dueAt) : '—'}</dd></div>
        <div><dt>Last check-in</dt><dd>{data.lastCheckInAt ? date(data.lastCheckInAt) : '—'}</dd></div>
      </dl>
      {(data.state === 'concern' || data.state === 'escalated') && <p className="welfare-alert" role="status">Your circle was asked to reach out. Check in to let them know you’re OK.</p>}
      <div className="welfare-actions">
        <button className="welfare-primary" disabled={checking.isLoading} onClick={() => void checkIn()}>{checking.isLoading ? 'Checking in…' : 'I’m OK, check in'}</button>
        <button className="welfare-ghost" onClick={() => setEditing(true)}>Settings</button>
        <button className="welfare-link" disabled={saving.isLoading} onClick={() => {
          if (!confirm('Turn off check-ins? Your circle won’t be alerted if you go quiet.')) return;
          // Send only the settings fields; the API rejects anything else.
          void save({ enabled: false, intervalHours: data.intervalHours, graceHours: data.graceHours,
            shareLocation: data.shareLocation, escalateAfterHours: data.escalateAfterHours });
        }}>Turn off</button>
      </div>
      {saving.isError && <p role="alert" className="welfare-error">Couldn’t turn off check-ins. Try again.</p>}
      {!!data.events.length && <details className="welfare-history"><summary>History</summary>
        <ol>{data.events.slice(0, 10).map(e => <li key={e.id}><span>{eventText[e.kind] ?? e.kind}{e.detail && <small>{e.detail}</small>}</span><time dateTime={e.at}>{date(e.at)}</time></li>)}</ol>
      </details>}
    </> : <>
      <p className="welfare-explain">If you miss a check-in, we remind you first. If you still don’t respond, your status shows as Unknown and your circle is asked to reach out. Missing a check-in is never treated as an emergency unless you choose that.</p>
      <button className="welfare-primary" onClick={() => setEditing(true)}>Set up check-ins</button>
    </>}
  </section>;
}
