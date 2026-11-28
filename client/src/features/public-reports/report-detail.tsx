import { useId, useState } from 'react';
import { Modal } from '@tilcayo/ui';
import type { PublicReport } from './public-reports.api';
import { statusLabel, urgencyLabel } from './labels';
import './public-reports.css';

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
type Media = PublicReport['media'][number];

async function download(url: string, filename: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const href = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement('a'), { href, download: filename });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch { window.open(url, '_blank', 'noopener'); }
}

/** Reserves the same space during loading, success and failure. */
function MediaPreview({ media, label, expanded = false, onOpen }: { media: Media & { url: string }; label: string; expanded?: boolean; onOpen?: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  return <div className={'pr-preview' + (expanded ? ' is-expanded' : '')} aria-busy={state === 'loading'}>
    {state === 'loading' && <div className="pr-preview-loading" role="status"><span className="pr-spinner" aria-hidden="true" /><span>Loading {media.kind === 'video' ? 'video' : 'image'}…</span></div>}
    {state === 'error' ? <div className="pr-preview-error" role="status"><span>Preview unavailable</span><button type="button" className="pr-ghost" onClick={() => { setState('loading'); setAttempt(attempt + 1); }}>Retry</button></div>
      : media.kind === 'video'
        ? <video key={attempt} src={media.url} controls preload="metadata" aria-label={label} onLoadedMetadata={() => setState('ready')} onError={() => setState('error')} style={{ visibility: state === 'ready' ? 'visible' : 'hidden' }} />
        : <img key={attempt} src={media.url} alt={label} onClick={onOpen} onLoad={() => setState('ready')} onError={() => setState('error')} style={{ visibility: state === 'ready' ? 'visible' : 'hidden', cursor: onOpen ? 'zoom-in' : undefined }} />}
  </div>;
}
function MediaItem({ media, index, reference }: { media: Media & { url: string }; index: number; reference: string }) {
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);
  const label = (media.kind === 'video' ? 'Video ' : 'Photo ') + (index + 1);
  const filename = `sariel-report-${reference.slice(0, 8)}-${index + 1}.${media.format ?? (media.kind === 'video' ? 'mp4' : 'jpg')}`;
  return <figure className="pr-media-item">
    <MediaPreview key={media.url} media={media} label={label} onOpen={media.kind === 'image' ? () => setZoomed(true) : undefined} />
    <figcaption><span>{label}</span><div>
      {media.kind === 'image' && <button type="button" className="pr-ghost" onClick={() => setZoomed(true)} aria-label={'View ' + label.toLowerCase() + ' full size'}>View</button>}
      <button type="button" className="pr-ghost pr-download" disabled={saving} onClick={async () => { setSaving(true); try { await download(media.url, filename); } finally { setSaving(false); } }}>{saving ? 'Saving…' : 'Download'}</button>
    </div></figcaption>
    {media.kind === 'image' && <Modal open={zoomed} title={label} onClose={() => setZoomed(false)}>{zoomed && <MediaPreview media={media} label={label} expanded />}</Modal>}
  </figure>;
}

export function PublicReportLoading() {
  return <div className="pr-detail pr-detail-loading" role="status" aria-label="Loading report details">
    <div className="pr-loading-line" /><div className="pr-overview has-media"><div className="pr-summary"><div className="pr-loading-line" /><div className="pr-loading-facts">{[1,2,3,4].map(n => <div className="pr-loading-line" key={n} />)}</div></div><div className="pr-loading-attachment" /></div>
    <div className="pr-loading-panel" /><span className="pr-sr-only">Loading report details</span>
  </div>;
}

/** Shared by platform and organisation review, including narrower dialogs. */
export function PublicReportDetail({ report, onNote, actions }: { report: PublicReport; onNote: (note: string) => Promise<unknown>; actions?: React.ReactNode }) {
  const noteId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function addNote() {
    if (busy || !note.trim()) return;
    setBusy(true); setError('');
    try { await onNote(note.trim()); setNote(''); }
    catch { setError('Could not save your note. Try again.'); }
    finally { setBusy(false); }
  }
  return <div className="pr-detail">
    <div className="pr-tags"><span className={'pr-pill urgency-' + report.urgency}>{urgencyLabel[report.urgency]}</span><span className={'pr-pill status-' + report.status}>{statusLabel[report.status]}</span></div>
    <div className={'pr-overview' + (report.media.length ? ' has-media' : '')}>
      <div className="pr-summary">
        <p className="pr-text">{report.description}</p>
        <dl className="pr-facts">
          <div><dt>Country</dt><dd>{report.country}</dd></div>
          {report.place && <div><dt>Place</dt><dd>{report.place}</dd></div>}
          <div className="pr-contact-fact"><dt>Reporter contact</dt><dd>{report.contact ?? 'Not given'}</dd></div>
          <div><dt>Received</dt><dd><time dateTime={report.submittedAt}>{when(report.submittedAt)}</time></dd></div>
        </dl>
      </div>
      {!!report.media.length && <section className="pr-attachments" aria-label="Attachments"><h3>Attachments <span>{report.media.length}</span></h3>
        <div className="pr-media">{report.media.map((m, i) => m.url ? <MediaItem key={report.id + '/' + i + '/' + m.url} media={m as Media & { url: string }} index={i} reference={report.id} />
          : <div key={i} className="pr-preview pr-preview-error">{m.kind === 'video' ? 'Video' : 'Photo'} unavailable</div>)}</div>
      </section>}
    </div>
    <div className={'pr-workflow' + (actions ? ' has-actions' : '')}>
      {actions}
      <section className="pr-notes">
        <h3>Timeline &amp; notes</h3>
        {report.notes.length ? <ol>{report.notes.map((n, i) => <li key={i} className={n.action ? 'is-action' : undefined}><p>{n.text}</p><small>{n.byName} · {when(n.at)}</small></li>)}</ol> : <p className="pr-muted pr-notes-empty">No notes yet.</p>}
        <label className="pr-sr-only" htmlFor={noteId}>Add a note</label>
        <textarea id={noteId} rows={3} maxLength={1500} value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note…" />
        {error && <p className="pr-error" role="alert">{error}</p>}
        <button className="pr-ghost" disabled={busy || !note.trim()} onClick={() => void addNote()}>{busy ? 'Saving…' : 'Add note'}</button>
      </section>
    </div>
  </div>;
}
