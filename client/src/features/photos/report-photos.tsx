import { useState, type FormEvent } from 'react';
import { Modal } from '@tilcayo/ui';
import { AccountIcon } from '../../components/account-icon';
import { Toggle } from '../../components/toggle';
import { apiStatus } from '../../lib/api-status';
import { photosApi, type CoverPhoto, type CreatedReportPhoto } from './photos.api';

const levels = [{ value: 2, label: 'Assistance needed' }, { value: 3, label: 'Safety concern' }, { value: 4, label: 'Serious danger' }, { value: 5, label: 'Critical danger' }];
const categories = ['welfare', 'medical', 'harassment', 'labour exploitation', 'trafficking', 'domestic violence'];
const fullLink = (path: string) => new URL(path, location.origin).href;
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function copy(text: string, done: (m: string) => void) {
  navigator.clipboard.writeText(text).then(() => done('Copied.'), () => done('Select the text and copy it manually.'));
}

function Result({ photo, close }: { photo: CreatedReportPhoto; close: () => void }) {
  const [note, setNote] = useState('');
  const link = fullLink(photo.link);
  const caption = `Beautiful view today 🌿 ${link}`;
  return <div className="report-result">
    <img src={photo.dataUrl} alt="Your report photo" />
    <div className="report-steps">
      <p className="report-ok"><AccountIcon name="shield" /> Report photo ready: <strong>{photo.status}</strong>. Nothing has been reported yet.</p>
      <a className="photo-primary" href={photo.dataUrl} download={photo.filename}>Download photo</a>
      <label>Private link<span className="report-copy"><input readOnly value={link} onFocus={e => e.target.select()} /><button type="button" className="photo-ghost" onClick={() => copy(link, setNote)}>Copy</button></span></label>
      <label>Suggested caption<span className="report-copy"><input readOnly value={caption} onFocus={e => e.target.select()} /><button type="button" className="photo-ghost" onClick={() => copy(caption, setNote)}>Copy</button></span></label>
      {note && <small role="status">{note}</small>}
      <Toggle className="report-how" icon="shield" title="How to send it when you need help" open>
        <ul>
          <li><strong>Facebook or social media:</strong> post the photo with the link in the caption. When the link is opened, Sariel is alerted.</li>
          <li><strong>Email:</strong> attach the downloaded photo file and send it to someone you trust, or upload it on Sariel’s <em>Share a photo</em> page.</li>
          <li><strong>WhatsApp or Telegram:</strong> send it as a <em>document/file</em>, not as a photo. Normal photo sending compresses it and removes the hidden report.</li>
          <li>Keep the file in your gallery. It looks like an ordinary picture.</li>
        </ul></Toggle>
      <button type="button" className="photo-ghost" onClick={close}>Done</button>
    </div>
  </div>;
}

export function CreateReportPhoto({ cover, close }: { cover: CoverPhoto; close: () => void }) {
  const [create, creating] = photosApi.useCreateReportPhotoMutation();
  const [level, setLevel] = useState(4);
  const [category, setCategory] = useState('welfare');
  const [country, setCountry] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedReportPhoto | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try { setCreated((await create({ coverId: cover.id, level, category, ...(country ? { country } : {}), ...(description.trim() ? { description: description.trim() } : {}) }).unwrap()).data); }
    catch (failure) { setError(apiStatus(failure) === 404 ? 'That photo has expired. Choose another.' : 'Couldn’t create the report photo. Try again.'); }
  }
  if (created) return <Result photo={created} close={close} />;
  return <form className="report-form" onSubmit={submit}>
    <p>Choose the message hidden inside this photo. It is encrypted, so only Sariel can read it.</p>
    <fieldset><legend>Safety level</legend><div className="report-levels">{levels.map(l =>
      <label key={l.value} className={'report-level level-' + l.value}><input type="radio" name="level" checked={level === l.value} onChange={() => setLevel(l.value)} /><span>{l.label}</span></label>)}</div></fieldset>
    <div className="report-fields">
      <label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>
      <label>Country (optional)<input maxLength={2} placeholder="e.g. SA" value={country} onChange={e => setCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} /></label>
    </div>
    <label className="report-description">What’s happening? (optional)<textarea rows={3} maxLength={500} value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. My employer took my passport and locked the door." />
      <small>{500 - description.length} characters left · Encrypted inside the photo; only Sariel responders can read it.</small></label>
    {error && <p role="alert" className="photo-error">{error}</p>}
    <button className="photo-primary" disabled={creating.isLoading || (country.length > 0 && country.length !== 2)}>{creating.isLoading ? 'Creating…' : 'Create report photo'}</button>
  </form>;
}

export function ReportPhotoList() {
  const list = photosApi.useReportPhotosQuery();
  const [revoke] = photosApi.useRevokeReportPhotoMutation();
  const [revokeAll, revokingAll] = photosApi.useRevokeAllReportPhotosMutation();
  const [note, setNote] = useState('');
  const rows = list.currentData?.data ?? [];
  const active = rows.filter(r => !r.revoked);
  return <section className="photo-card-panel">
    <div className="report-list-head"><div><h2>Your report photos</h2><p>Each one carries a hidden report and its own private link.</p></div>
      {!!active.length && <button className="photo-ghost is-danger" disabled={revokingAll.isLoading}
        onClick={() => { if (confirm('Revoke all report photos? Every copy, wherever it was sent, stops working.')) void revokeAll(); }}>Revoke all</button>}</div>
    {note && <p role="status" className="report-note">{note}</p>}
    {!list.currentData ? <p role="status">Loading…</p> : rows.length ? <ul className="report-list">{rows.map(r => <li key={r.id} className={r.revoked ? 'is-revoked' : undefined}>
      <span className={'report-dot level-' + r.level} aria-hidden="true" />
      <div><strong>{r.status}</strong>{r.description && <em className="report-desc">“{r.description}”</em>}<small>{r.category}{r.country ? ' · ' + r.country : ''} · created {date(r.createdAt)}{r.lastUsedAt ? ` · last used ${date(r.lastUsedAt)}` : ''}</small></div>
      {r.revoked ? <span className="report-tag">Revoked</span> : <div className="photo-actions">
        <button className="photo-ghost" onClick={() => copy(fullLink(r.link), setNote)}>Copy link</button>
        <button className="photo-ghost is-danger" onClick={() => void revoke(r.id)}>Revoke</button></div>}
    </li>)}</ul> : <div className="photo-empty"><AccountIcon name="image" /><p>No report photos yet. Pick one of your photos above and choose “Create report photo”.</p></div>}
  </section>;
}

export function ReportPhotoModal({ cover, onClose }: { cover: CoverPhoto | null; onClose: () => void }) {
  return <Modal open={!!cover} title="Create a report photo" onClose={onClose}>{cover && <CreateReportPhoto key={cover.id} cover={cover} close={onClose} />}</Modal>;
}
