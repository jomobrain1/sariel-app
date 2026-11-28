import { useState } from 'react';
import { PublicReportDetail, PublicReportLoading } from './report-detail';
import { statusLabel, urgencyLabel } from './labels';
import { publicReportsApi, type ReportAction } from './public-reports.api';
import './public-reports.css';
import { visibleProgress } from '../../lib/visible-progress';
import { toast } from '../../lib/toast';

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
    <section className="pr-pane">{selected ? scope === 'admin' ? <AdminDetail key={selected} id={selected} /> : <OrgDetail key={selected} id={selected} /> : <p className="pr-muted">Choose a report.</p>}</section>
  </div>;
}

function AdminDetail({ id }: { id: string }) {
  const report = publicReportsApi.useAdminPublicReportQuery(id);
  const [update, updating] = publicReportsApi.useUpdatePublicReportMutation();
  const [detail, setDetail] = useState('');
  const [failed, setFailed] = useState(false);
  // Which button is saving: it shows a spinner, every action stays locked, then a confirmation appears.
  const [working, setWorking] = useState<string>();
  const [saved, setSaved] = useState('');
  const data = report.currentData?.data;
  if (report.isError && !data) return <p role="alert" className="pr-muted">Could not load the report. <button className="pr-ghost" onClick={() => void report.refetch()}>Retry</button></p>;
  if (!data) return <PublicReportLoading />;
  const busy = !!working || updating.isLoading;
  const text = detail.trim();
  async function act(key: string, body: { action?: ReportAction; status?: string }, done: string) {
    if (busy) return;
    setFailed(false); setSaved(''); setWorking(key);
    try { await visibleProgress(update({ id, ...body, ...(text && body.action ? { note: text } : {}) }).unwrap()); setDetail(''); setSaved(done); toast.success(done); }
    catch { setFailed(true); toast.error('Couldn’t save that. Try again.'); }
    finally { setWorking(undefined); }
  }
  const label = (key: string, text: string) => working === key ? <><span className="pr-spinner" aria-hidden="true" />Saving…</> : text;
  const closed = data.status === 'closed';
  return <PublicReportDetail report={data} onNote={note => update({ id, note }).unwrap()} actions={<section className="pr-act">
    <h3>Actions</h3>
    {closed ? <div className="pr-actions"><button className="pr-ghost" disabled={busy} aria-busy={working === 'reopen'} onClick={() => void act('reopen', { status: 'submitted' }, 'Report reopened.')}>{label('reopen', 'Reopen')}</button></div> : <>
      <input className="pr-act-detail" maxLength={1500} value={detail} onChange={e => setDetail(e.target.value)} placeholder="Action note (optional)" aria-label="Action details" />
      <div className="pr-actions">
        {data.status === 'submitted' && <button className="pr-ghost" disabled={busy} aria-busy={working === 'review'} onClick={() => void act('review', { status: 'reviewing' }, 'Review started.')}>{label('review', 'Start review')}</button>}
        <button className="pr-ghost" disabled={busy || !data.contact} title={data.contact ? undefined : 'The reporter left no contact'} aria-busy={working === 'contacted'} onClick={() => void act('contacted', { action: 'contacted-reporter' }, 'Saved: reporter contacted.')}>{label('contacted', 'Contacted reporter')}</button>
        <button className="pr-ghost" disabled={busy} aria-busy={working === 'referred'} onClick={() => void act('referred', { action: 'referred' }, 'Saved: referred for help.')}>{label('referred', 'Referred for help')}</button>
        <button className="pr-resolve" disabled={busy} aria-busy={working === 'resolve'} onClick={() => { if (confirm('Resolve and close this report?')) void act('resolve', { action: 'resolved' }, 'Report resolved and closed.'); }}>{label('resolve', 'Resolve')}</button>
      </div></>}
    {saved && !busy && !failed && <p role="status" className="pr-saved">✓ {saved}</p>}
    {failed && <p role="alert" className="pr-error">Couldn’t save that. Try again.</p>}
  </section>} />;
}

function OrgDetail({ id }: { id: string }) {
  const report = publicReportsApi.useOrgPublicReportQuery(id);
  const [addNote] = publicReportsApi.useOrgPublicReportNoteMutation();
  const data = report.currentData?.data;
  if (report.isError && !data) return <p role="alert" className="pr-muted">Could not load the report. <button className="pr-ghost" onClick={() => void report.refetch()}>Retry</button></p>;
  if (!data) return <PublicReportLoading />;
  return <PublicReportDetail report={data} onNote={note => addNote({ id, note }).unwrap()} />;
}

export function AdminPublicReportsPage() {
  return <section className="pr-admin" aria-labelledby="pra-title">
    <header><h1 id="pra-title">Public reports</h1><p>Reports from people without an account about someone in danger.</p></header>
    <List scope="admin" />
  </section>;
}
export function OrgPublicReports() { return <List scope="org" />; }
