import { useState } from 'react';
import { orgIncidentsApi, type OrgCommand } from './org-incidents.api';
import './org-incidents.css';

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const stateLabel: Record<string, string> = { pending: 'Pending', assigned: 'New', acknowledged: 'Acknowledged', resolved: 'Resolved' };
const actionLabel: Record<string, string> = {
  created: 'Report received', routed: 'Routed to your organisation', 'received-referral': 'Referred to your organisation', assign: 'Officer assigned',
  acknowledge: 'Acknowledged', dispatch: 'Help dispatched', note: 'Note added', refer: 'Referred', resolve: 'Resolved',
  'gallery-road': 'Person signalled: help still needed', 'gallery-bridge': 'Person signalled: situation worsening', 'gallery-mountain': 'Person signalled: immediate danger',
  'photo-link-spread': 'Report link opened by 3+ people',
};

function Detail({ handle }: { handle: string }) {
  const incident = orgIncidentsApi.useOrgIncidentQuery(handle, { pollingInterval: 30_000 });
  const [act, acting] = orgIncidentsApi.useOrgActionMutation();
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const data = incident.currentData?.data;
  if (incident.isError) return <p role="alert" className="org-empty">This incident is no longer available to your organisation.</p>;
  if (!data) return <p role="status" className="org-empty">Loading…</p>;
  const dispatched = data.timeline.some(t => t.action === 'dispatch');
  async function run(command: OrgCommand) {
    setError('');
    try { await act({ handle, version: data!.version, command }).unwrap(); setNote(''); setConfirmed(false); }
    catch { setError('The incident changed or the action isn’t allowed. Refresh and try again.'); void incident.refetch(); }
  }
  return <div className="org-detail">
    <header><h2>{data.severity ? data.severity[0].toUpperCase() + data.severity.slice(1) + ' severity' : 'Incident'}</h2>
      <span className={'org-pill state-' + data.state}>{stateLabel[data.state] ?? data.state}</span></header>
    <dl className="org-facts">
      {data.category && <div><dt>Category</dt><dd>{data.category}</dd></div>}
      {data.country && <div><dt>Country</dt><dd>{data.country}</dd></div>}
      {data.reference && <div><dt>Reference</dt><dd><code>{data.reference.slice(0, 16)}…</code></dd></div>}
    </dl>
    <p className="org-privacy">Only the details your routing rule allows are shown. Personal information is shared only with the person’s consent.</p>
    {data.state !== 'resolved' && <section className="org-respond">
      <h3>Respond</h3>
      <div className="org-actions">
        {data.state === 'assigned' && <button className="org-primary" disabled={acting.isLoading} onClick={() => void run({ action: 'acknowledge' })}>Acknowledge</button>}
        {data.state === 'acknowledged' && !dispatched && <>
          <label className="org-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> A responder is on the way</label>
          <button className="org-primary" disabled={acting.isLoading || !confirmed} onClick={() => void run({ action: 'dispatch', confirmed: true })}>Confirm dispatch</button></>}
      </div>
      <label className="org-note">Note<textarea rows={3} maxLength={1500} value={note} onChange={e => setNote(e.target.value)} placeholder="What was done, who was contacted…" /></label>
      <div className="org-actions">
        <button className="org-ghost" disabled={acting.isLoading || !note.trim()} onClick={() => void run({ action: 'note', note: note.trim() })}>Add note</button>
        {data.state === 'acknowledged' && <button className="org-ghost" disabled={acting.isLoading || !note.trim()} onClick={() => void run({ action: 'resolve', note: note.trim() })}>Resolve with note</button>}
      </div>
      {error && <p role="alert" className="org-error">{error}</p>}
    </section>}
    <section><h3>Timeline</h3>
      <ol className="org-timeline">{[...data.timeline].reverse().map((t, i) => <li key={i}><strong>{actionLabel[t.action] ?? t.action}</strong>
        <small>{t.actorName ? t.actorName + ' · ' : ''}{when(t.at)}</small>{t.note && <p>{t.note}</p>}</li>)}</ol>
    </section>
  </div>;
}

export function OrgIncidentsPage() {
  const access = orgIncidentsApi.useIncidentAccessQuery();
  const allowed = access.currentData?.data.allowed;
  const [page, setPage] = useState(1);
  const list = orgIncidentsApi.useOrgIncidentsQuery(page, { skip: !allowed, pollingInterval: 30_000 });
  const [selected, setSelected] = useState<string | null>(null);
  if (access.isLoading) return <section className="org-page"><p role="status">Loading…</p></section>;
  const state = access.currentData?.data;
  if (!state?.allowed) return <section className="org-page"><div className="org-wait">
    <h1>Incidents</h1>
    <p>{!state?.responder ? 'Your role doesn’t include responding to incidents. Ask your organisation administrator.'
      : !state.verified ? 'Your organisation is waiting for verification by the Sariel platform team.'
      : 'Your organisation is verified and waiting for incident access to be approved by the Sariel platform team.'}</p>
  </div></section>;
  const rows = list.currentData?.data ?? [];
  return <section className="org-page" aria-labelledby="org-title">
    <header className="org-head"><h1 id="org-title">Incidents</h1><p>Incidents routed to your organisation.</p></header>
    <div className="org-grid">
      <section className="org-list" aria-label="Incident list">
        {list.isError ? <p role="alert" className="org-empty">Couldn’t load incidents.</p> : !list.currentData ? <p role="status" className="org-empty">Loading…</p>
          : rows.length ? <ul>{rows.map(r => <li key={r.handle}><button aria-pressed={selected === r.handle} onClick={() => setSelected(r.handle)}>
            <span className={'org-dot state-' + r.state} aria-hidden="true" /><span><strong>{stateLabel[r.state] ?? r.state}</strong><small>{when(r.createdAt)}</small></span></button></li>)}</ul>
          : <p className="org-empty">No incidents have been routed to your organisation.</p>}
        <nav className="org-pages"><button className="org-ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button><button className="org-ghost" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Older</button></nav>
      </section>
      <section className="org-pane">{selected ? <Detail key={selected} handle={selected} /> : <p className="org-empty">Choose an incident to see details and respond.</p>}</section>
    </div>
  </section>;
}
