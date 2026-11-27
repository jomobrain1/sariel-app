import { useState } from 'react';
import { PublicReportDetail } from './report-detail';
import { statusLabel, urgencyLabel } from './labels';
import { publicReportsApi } from './public-reports.api';
import './public-reports.css';

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function List({ scope }: { scope: 'admin' | 'org' }) {
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState<string | null>(null);
  const adminList = publicReportsApi.useAdminPublicReportsQuery(status, { skip: scope !== 'admin', pollingInterval: 30_000 });
  const orgList = publicReportsApi.useOrgPublicReportsQuery(status, { skip: scope !== 'org', pollingInterval: 30_000 });
  const list = scope === 'admin' ? adminList : orgList;
  const rows = list.currentData?.data ?? [];
  return <div className="pr-admin-grid">
    <section className="pr-list">
      <div className="pr-filter" role="group" aria-label="Filter">{[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([value, label]) =>
        <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setSelected(null); }}>{label}</button>)}</div>
      {list.isError ? <p role="alert" className="pr-muted">Couldn’t load reports.</p> : !list.currentData ? <p role="status" className="pr-muted">Loading…</p>
        : rows.length ? <ul>{rows.map(r => <li key={r.id}><button aria-pressed={selected === r.id} onClick={() => setSelected(r.id)}>
          <span className={'pr-dot urgency-' + r.urgency} aria-hidden="true" />
          <span><strong>{r.country} · {urgencyLabel[r.urgency]}</strong><small>{r.description.slice(0, 80)}{r.description.length > 80 ? '…' : ''}</small>
            <small>{statusLabel[r.status]} · {when(r.submittedAt)}{r.media.length ? ` · ${r.media.length} file(s)` : ''}</small></span></button></li>)}</ul>
        : <p className="pr-muted">No reports here.</p>}
    </section>
    <section className="pr-pane">{selected ? scope === 'admin' ? <AdminDetail id={selected} /> : <OrgDetail id={selected} /> : <p className="pr-muted">Choose a report.</p>}</section>
  </div>;
}

function AdminDetail({ id }: { id: string }) {
  const report = publicReportsApi.useAdminPublicReportQuery(id);
  const [update, updating] = publicReportsApi.useUpdatePublicReportMutation();
  const data = report.currentData?.data;
  if (!data) return <p role="status" className="pr-muted">Loading…</p>;
  return <PublicReportDetail report={data} onNote={note => update({ id, note }).unwrap()} actions={<div className="pr-actions">
    {data.status !== 'reviewing' && <button className="pr-primary" disabled={updating.isLoading} onClick={() => void update({ id, status: 'reviewing' })}>Mark reviewing</button>}
    {data.status !== 'closed' && <button className="pr-ghost" disabled={updating.isLoading} onClick={() => void update({ id, status: 'closed' })}>Close</button>}
    {data.status === 'closed' && <button className="pr-ghost" disabled={updating.isLoading} onClick={() => void update({ id, status: 'submitted' })}>Reopen</button>}
  </div>} />;
}

function OrgDetail({ id }: { id: string }) {
  const report = publicReportsApi.useOrgPublicReportQuery(id);
  const [addNote] = publicReportsApi.useOrgPublicReportNoteMutation();
  const data = report.currentData?.data;
  if (!data) return <p role="status" className="pr-muted">Loading…</p>;
  return <PublicReportDetail report={data} onNote={note => addNote({ id, note }).unwrap()} />;
}

export function AdminPublicReportsPage() {
  return <section className="pr-admin" aria-labelledby="pra-title">
    <header><h1 id="pra-title">Public reports</h1><p>Reports from people without an account about someone in danger.</p></header>
    <List scope="admin" />
  </section>;
}
export function OrgPublicReports() { return <List scope="org" />; }
