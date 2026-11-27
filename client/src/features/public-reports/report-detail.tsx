import { useState } from 'react';
import { Modal } from '@tilcayo/ui';
import type { PublicReport } from './public-reports.api';
import { statusLabel, urgencyLabel } from './labels';
import './public-reports.css';

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type Media = PublicReport['media'][number];

/** Saves the file instead of opening it. Signed links are cross-origin, so fetch it first; if that fails, open it. */
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

/** A photo opens full size on click; a video plays inline. Download saves the original file. */
function MediaItem({ media, index, reference }: { media: Media & { url: string }; index: number; reference: string }) {
  const [zoomed, setZoomed] = useState(false);
  const [saving, setSaving] = useState(false);
  const label = media.kind === 'video' ? `Attached video ${index + 1}` : `Attached photo ${index + 1}`;
  const filename = `sariel-report-${reference.slice(0, 8)}-${index + 1}.${media.format ?? (media.kind === 'video' ? 'mp4' : 'jpg')}`;
  return <figure className="pr-media-item">
    {media.kind === 'video' ? <video src={media.url} controls preload="metadata" aria-label={label} />
      : <button type="button" className="pr-media-zoom" onClick={() => setZoomed(true)} aria-label={'View ' + label.toLowerCase() + ' full size'}><img src={media.url} alt={label} /></button>}
    <figcaption>
      <button type="button" className="pr-ghost pr-download" disabled={saving} onClick={async () => { setSaving(true); try { await download(media.url, filename); } finally { setSaving(false); } }}>
        {saving ? 'Downloading…' : 'Download'}</button>
    </figcaption>
    {media.kind === 'image' && <Modal open={zoomed} title={label} onClose={() => setZoomed(false)}>
      {zoomed && <img className="pr-zoomed" src={media.url} alt={label} />}
    </Modal>}
  </figure>;
}

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
      ? <MediaItem key={i} media={m as Media & { url: string }} index={i} reference={report.id} />
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
