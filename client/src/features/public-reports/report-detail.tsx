import { useState } from 'react';
import type { PublicReport } from './public-reports.api';
import { statusLabel, urgencyLabel } from './labels';
import './public-reports.css';

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Shared detail view for administrators and approved organisations. Media links expire after 10 minutes. */
export function PublicReportDetail({ report, onNote, actions }: { report: PublicReport; onNote: (note: string) => Promise<unknown>; actions?: React.ReactNode }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="pr-detail">
    <div className="pr-tags"><span className={'pr-pill urgency-' + report.urgency}>{urgencyLabel[report.urgency]}</span><span className={'pr-pill status-' + report.status}>{statusLabel[report.status]}</span></div>
    <p className="pr-text">{report.description}</p>
    <dl className="pr-facts">
      <div><dt>Country</dt><dd>{report.country}</dd></div>
      {report.place && <div><dt>Place</dt><dd>{report.place}</dd></div>}
      <div><dt>Reporter contact</dt><dd>{report.contact ?? 'Not given'}</dd></div>
      <div><dt>Received</dt><dd>{when(report.submittedAt)}</dd></div>
    </dl>
    {!!report.media.length && <div className="pr-media">{report.media.map((m, i) => m.url
      ? m.kind === 'video' ? <video key={i} src={m.url} controls preload="metadata" /> : <a key={i} href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={`Attached photo ${i + 1}`} /></a>
      : <div key={i} className="pr-media-off">{m.kind === 'video' ? 'Video' : 'Photo'} unavailable</div>)}</div>}
    {actions}
    <div className="pr-notes">
      <h3>Timeline &amp; notes</h3>
      {report.notes.length ? <ol>{report.notes.map((n, i) => <li key={i} className={n.action ? 'is-action' : undefined}><p>{n.text}</p><small>{n.byName} · {when(n.at)}</small></li>)}</ol> : <p className="pr-muted">No notes yet.</p>}
      <textarea rows={2} maxLength={1500} value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note: who was contacted, what was done…" aria-label="Note" />
      <button className="pr-ghost" disabled={busy || !note.trim()} onClick={async () => { setBusy(true); try { await onNote(note.trim()); setNote(''); } finally { setBusy(false); } }}>Add note</button>
    </div>
  </div>;
}
