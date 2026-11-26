import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { Modal } from '@tilcayo/ui';
import { useAuth } from '../../app/auth';
import { AccountIcon } from '../../components/account-icon';
import { labels } from '../safety/safety.api';
import { circleApi, permissionLabels, relationships, type CircleMember, type Permissions, type Relationship } from './circle.api';
import './circle.css';

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const initials = (name: string) => name.trim().split(/[\s@.]+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
const capital = (value: string) => value[0].toUpperCase() + value.slice(1);
const permissionKeys = Object.keys(permissionLabels) as (keyof Permissions)[];

function PermissionPicker({ value, onChange, disabled }: { value: Permissions; onChange: (next: Permissions) => void; disabled?: boolean }) {
  return <div className="circle-permissions" role="group" aria-label="What they can see">
    {permissionKeys.map(key => <label key={key} className="circle-toggle">
      <input type="checkbox" checked={value[key]} disabled={disabled} onChange={e => onChange({ ...value, [key]: e.target.checked })} />
      <span>{permissionLabels[key]}</span>
    </label>)}
  </div>;
}

function Chips({ permissions }: { permissions: Permissions }) {
  const granted = permissionKeys.filter(key => permissions[key]);
  return <span className="circle-chips">{granted.length ? granted.map(key => <span key={key}>{permissionLabels[key]}</span>) : <span className="is-muted">Nothing shared</span>}</span>;
}

function InviteForm({ done }: { done: () => void }) {
  const [invite, state] = circleApi.useInviteMutation();
  const [permissions, setPermissions] = useState<Permissions>({ status: true, location: false, updates: true });
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await invite({ email: String(form.get('email')).trim(), relationship: form.get('relationship') as Relationship, permissions }).unwrap();
      done();
    } catch (failure) {
      const status = typeof failure === 'object' && failure && 'status' in failure ? failure.status : 0;
      setError(status === 409 ? 'This address is already in your circle.' : status === 422 ? 'Check the address. You can’t invite yourself.' : 'Couldn’t send the invite. Try again.');
    }
  }
  return <form className="circle-form" onSubmit={submit}>
    <label>Email address<input name="email" type="email" required maxLength={254} autoComplete="off" placeholder="name@example.com" /></label>
    <label>Relationship<select name="relationship" defaultValue="family">{relationships.map(r => <option key={r} value={r}>{capital(r)}</option>)}</select></label>
    <fieldset><legend>What they can see</legend><PermissionPicker value={permissions} onChange={setPermissions} /></fieldset>
    <p className="circle-hint">They’ll see your invite when they sign in with this address. You can change or remove access at any time.</p>
    {error && <p role="alert" className="circle-error">{error}</p>}
    <button className="circle-primary" disabled={state.isLoading}>{state.isLoading ? 'Sending…' : 'Send invite'}</button>
  </form>;
}

function MemberRow({ member }: { member: CircleMember }) {
  const [edit, editing] = circleApi.useEditMemberMutation();
  const [remove, removing] = circleApi.useRemoveMemberMutation();
  const [open, setOpen] = useState(false);
  const title = member.name ?? member.email;
  return <li className="circle-row">
    <span className="circle-avatar" aria-hidden="true">{initials(title)}</span>
    <div className="circle-row-main">
      <strong>{title}</strong>
      <small>{capital(member.relationship)}{member.state === 'pending' && <> · <span className="circle-pending">Invite pending</span></>}</small>
      {open ? <PermissionPicker value={member.permissions} disabled={editing.isLoading} onChange={permissions => void edit({ id: member.id, permissions })} /> : <Chips permissions={member.permissions} />}
    </div>
    <div className="circle-row-actions">
      <button type="button" className="circle-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Done' : 'Edit'}</button>
      <button type="button" className="circle-ghost is-danger" disabled={removing.isLoading}
        onClick={() => { if (confirm(`Remove ${title} from your circle? They won’t be notified.`)) void remove(member.id); }}>Remove</button>
    </div>
  </li>;
}

const ago = (value: string) => {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return date(value);
};
const mapLink = (p: { latitude: number; longitude: number }) => `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=16/${p.latitude}/${p.longitude}`;
const coordinates = (p: { latitude: number; longitude: number }) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;

function UpdateComposer() {
  const [text, setText] = useState('');
  const [post, posting] = circleApi.usePostUpdateMutation();
  const [remove] = circleApi.useDeleteUpdateMutation();
  const mine = circleApi.useMyUpdatesQuery();
  const recent = mine.currentData?.data.slice(0, 3) ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    try { await post(text.trim()).unwrap(); setText(''); } catch { /* The error message below stays visible. */ }
  }
  return <section className="circle-card circle-composer">
    <h2>Share an update</h2>
    <p className="circle-sub">Let your circle know what you’re up to.</p>
    <form onSubmit={submit}>
      <textarea aria-label="Update" maxLength={280} rows={3} placeholder="e.g. Travelling to Nairobi today, back on Friday" value={text} onChange={e => setText(e.target.value)} />
      <div className="circle-composer-bar"><small>{280 - text.length} characters left</small>
        <button className="circle-primary" disabled={posting.isLoading || !text.trim()}>{posting.isLoading ? 'Posting…' : 'Post update'}</button></div>
      {posting.isError && <p role="alert" className="circle-error">Couldn’t post your update. Try again.</p>}
    </form>
    {!!recent.length && <ul className="circle-updates">{recent.map(u => <li key={u.id}>
      <p>{u.text}</p><small>{ago(u.createdAt)} · <button type="button" className="circle-link" onClick={() => void remove(u.id)}>Delete</button></small>
    </li>)}</ul>}
  </section>;
}

function LocationCard() {
  const settings = circleApi.useLocationSettingsQuery();
  const history = circleApi.useMyLocationsQuery(undefined, { pollingInterval: 60_000 });
  const [toggle, toggling] = circleApi.useSetLocationSharingMutation();
  const [clear, clearing] = circleApi.useClearLocationsMutation();
  const [problem, setProblem] = useState('');
  const config = settings.currentData?.data;
  const latest = history.currentData?.data[0];
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  function change(next: boolean) {
    setProblem('');
    if (!next) { void toggle(false); return; }
    if (!supported) { setProblem('This browser can’t share location.'); return; }
    // Ask for permission first so the switch only turns on when the browser allows it.
    navigator.geolocation.getCurrentPosition(() => void toggle(true), () => setProblem('Location permission was blocked. Allow it in your browser settings.'), { timeout: 30_000 });
  }
  return <section className="circle-card circle-location">
    <div className="circle-location-head">
      <span className="circle-icon"><AccountIcon name="globe" /></span>
      <div><h2>Location sharing</h2><p className="circle-sub">Sent every {config?.intervalMinutes ?? 5} minutes while Sariel is open.</p></div>
      <label className="circle-switch"><input type="checkbox" role="switch" checked={config?.sharing ?? false} disabled={!config || toggling.isLoading} onChange={e => change(e.target.checked)} /><span aria-hidden="true" /><span className="circle-sr-only">Share my location</span></label>
    </div>
    {problem && <p role="alert" className="circle-error">{problem}</p>}
    <dl className="circle-facts">
      <div><dt>Last sent</dt><dd>{latest ? ago(latest.recordedAt) : 'Not yet'}</dd></div>
      <div><dt>Accuracy</dt><dd>{latest ? `±${Math.round(latest.accuracy)} m` : '—'}</dd></div>
      <div><dt>Kept for</dt><dd>{config?.retentionDays ?? 30} days</dd></div>
    </dl>
    <p className="circle-hint">Only people you allow can see your location.{' '}
      {!!history.currentData?.data.length && <button type="button" className="circle-link" disabled={clearing.isLoading} onClick={() => { if (confirm('Delete your whole location history?')) void clear(); }}>Delete my history</button>}</p>
  </section>;
}

function CircleFeed() {
  const feed = circleApi.useFeedQuery(undefined, { pollingInterval: 60_000 });
  const items = feed.currentData?.data ?? [];
  return <section className="circle-card">
    <h2>Latest from your circle</h2>
    {feed.isError ? <p role="alert">Couldn’t load updates.</p> : !feed.currentData ? <p role="status">Loading…</p> : items.length ? <ul className="circle-list">{items.map(item => <li key={item.id} className="circle-row circle-feed-row">
      <span className="circle-avatar" aria-hidden="true">{initials(item.name)}</span>
      <div className="circle-row-main"><strong>{item.name} <small>· {ago(item.createdAt)}</small></strong><p>{item.text}</p></div>
    </li>)}</ul> : <div className="circle-empty"><AccountIcon name="activity" /><p>Updates from people who share with you will appear here.</p></div>}
  </section>;
}

function PersonLocation({ owner }: { owner: string }) {
  const location = circleApi.usePersonLocationQuery(owner, { pollingInterval: 60_000 });
  const data = location.currentData?.data;
  if (!data) return null;
  return <section className="circle-person-block">
    <h3>Location</h3>
    {data.latest ? <div className="circle-place">
      <div><strong>{coordinates(data.latest)}</strong><small>±{Math.round(data.latest.accuracy)} m · {ago(data.latest.recordedAt)}{!data.sharing && ' · sharing paused'}</small></div>
      <a className="circle-ghost" href={mapLink(data.latest)} target="_blank" rel="noreferrer">Open map</a>
    </div> : <p>No location shared yet.</p>}
    {data.history.length > 1 && <details className="circle-trail"><summary>Past 24 hours ({data.history.length} points)</summary>
      <ol>{data.history.slice(0, 12).map(p => <li key={p.recordedAt}><a href={mapLink(p)} target="_blank" rel="noreferrer">{coordinates(p)}</a><time dateTime={p.recordedAt}>{date(p.recordedAt)}</time></li>)}</ol>
    </details>}
  </section>;
}

function PersonUpdates({ owner }: { owner: string }) {
  const list = circleApi.usePersonUpdatesQuery(owner, { pollingInterval: 60_000 });
  const items = list.currentData?.data ?? [];
  return <section className="circle-person-block">
    <h3>Updates</h3>
    {items.length ? <ul className="circle-updates">{items.slice(0, 5).map(u => <li key={u.id}><p>{u.text}</p><small>{ago(u.createdAt)}</small></li>)}</ul> : <p>No updates yet.</p>}
  </section>;
}

function PersonDetail({ owner, entry, close }: { owner: string; entry: string; close: () => void }) {
  const person = circleApi.usePersonQuery(owner, { pollingInterval: 60_000 });
  const [ask, asking] = circleApi.useRequestCheckInMutation();
  const [leave, leaving] = circleApi.useRemoveMemberMutation();
  const data = person.currentData?.data;
  if (person.isError) return <p role="alert">This person is no longer sharing with you.</p>;
  if (!data) return <p role="status">Loading…</p>;
  const request = data.lastCheckInRequest;
  return <div className="circle-person">
    {data.status && <section className={'circle-status level-' + data.status.level}>
      <span>Safety status</span><strong>{labels[data.status.level]}</strong>
      {data.status.reportedAt && <small>Updated {date(data.status.reportedAt)}</small>}
    </section>}
    {data.permissions.location && <PersonLocation owner={owner} />}
    {data.permissions.updates && <PersonUpdates owner={owner} />}
    <section className="circle-person-block">
      <h3>Check in</h3>
      <p>{request ? request.answeredAt ? `${data.name} checked in ${date(request.answeredAt)}.` : `You asked ${date(request.createdAt)}. Waiting for a reply.` : `Ask ${data.name} to confirm they’re OK.`}</p>
      <button type="button" className="circle-primary" disabled={asking.isLoading || (!!request && !request.answeredAt)} onClick={() => void ask(owner)}>Ask to check in</button>
    </section>
    <footer><button type="button" className="circle-ghost is-danger" disabled={leaving.isLoading}
      onClick={() => { if (confirm(`Leave ${data.name}’s circle?`)) void leave(entry).unwrap().then(close); }}>Leave circle</button></footer>
  </div>;
}

export function CirclePage() {
  const { user } = useAuth();
  const overview = circleApi.useCircleQuery(undefined, { pollingInterval: 60_000, skip: !user || !!user.tenant });
  const [respond, responding] = circleApi.useRespondMutation();
  const [answer, answering] = circleApi.useAnswerCheckInsMutation();
  const [inviting, setInviting] = useState(false);
  const [viewing, setViewing] = useState<{ owner: string; entry: string; name: string } | null>(null);
  const [notice, setNotice] = useState('');
  if (user?.tenant) return <Navigate to="/dashboard" replace />;
  const data = overview.currentData?.data;

  return <section className="circle-page" aria-labelledby="circle-title">
    <header className="circle-head">
      <div><h1 id="circle-title">Your circle</h1><p>People you trust to look out for you.</p></div>
      <button className="circle-primary" onClick={() => { setNotice(''); setInviting(true); }}><span aria-hidden="true">＋</span> Invite someone</button>
    </header>
    {notice && <p className="circle-notice" role="status">{notice}</p>}
    {overview.isError && <p className="circle-notice" role="alert">Couldn’t load your circle. <button className="circle-link" onClick={() => void overview.refetch()}>Retry</button></p>}

    {!!data?.checkInRequests.length && <div className="circle-banner">
      <AccountIcon name="shield" />
      <p><strong>{data.checkInRequests.map(r => r.name).join(', ')}</strong> asked you to check in.</p>
      <button className="circle-primary" disabled={answering.isLoading} onClick={() => void answer().unwrap().then(() => setNotice('Check-in sent. Your circle can see you’re OK.'))}>I’m OK</button>
    </div>}

    {!!data?.invitations.length && <section className="circle-card">
      <h2>Invitations</h2>
      <ul className="circle-list">{data.invitations.map(invite => <li key={invite.id} className="circle-row">
        <span className="circle-avatar" aria-hidden="true">{initials(invite.name)}</span>
        <div className="circle-row-main"><strong>{invite.name} invited you to their circle</strong><small>You’ll be able to see:</small><Chips permissions={invite.permissions} /></div>
        <div className="circle-row-actions">
          <button className="circle-primary" disabled={responding.isLoading} onClick={() => void respond({ id: invite.id, answer: 'accept' })}>Accept</button>
          <button className="circle-ghost" disabled={responding.isLoading} onClick={() => void respond({ id: invite.id, answer: 'reject' })}>Decline</button>
        </div>
      </li>)}</ul>
    </section>}

    <div className="circle-grid">
      <UpdateComposer />
      <LocationCard />
    </div>

    <div className="circle-grid">
      <section className="circle-card">
        <h2>People in my circle</h2>
        <p className="circle-sub">They can see only what you allow.</p>
        {!data ? <p role="status">Loading…</p> : data.members.length ? <ul className="circle-list">{data.members.map(m => <MemberRow key={m.id} member={m} />)}</ul>
          : <div className="circle-empty"><AccountIcon name="user" /><p>No one yet. Invite family or friends to look out for you.</p></div>}
      </section>
      <section className="circle-card">
        <h2>Circles I’m in</h2>
        <p className="circle-sub">People who share with you.</p>
        {!data ? <p role="status">Loading…</p> : data.circles.length ? <ul className="circle-list">{data.circles.map(c => <li key={c.id}>
          <button className="circle-row circle-row-button" onClick={() => setViewing({ owner: c.owner, entry: c.id, name: c.name })}>
            <span className="circle-avatar" aria-hidden="true">{initials(c.name)}</span>
            <span className="circle-row-main"><strong>{c.name}</strong><Chips permissions={c.permissions} /></span>
            <AccountIcon name="arrow" />
          </button></li>)}</ul>
          : <div className="circle-empty"><AccountIcon name="shield" /><p>When someone adds you to their circle, they’ll appear here.</p></div>}
      </section>
    </div>

    <CircleFeed />

    <Modal open={inviting} title="Invite to your circle" onClose={() => setInviting(false)}>
      {inviting && <InviteForm done={() => { setInviting(false); setNotice('Invite sent.'); }} />}
    </Modal>
    <Modal open={!!viewing} title={viewing?.name ?? 'Circle'} onClose={() => setViewing(null)}>
      {viewing && <PersonDetail owner={viewing.owner} entry={viewing.entry} close={() => setViewing(null)} />}
    </Modal>
  </section>;
}
