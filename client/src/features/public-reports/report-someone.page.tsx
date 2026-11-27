import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AccountIcon } from '../../components/account-icon';
import { apiStatus } from '../../lib/api-status';
import { publicReportsApi } from './public-reports.api';
import './public-reports.css';
import { toast } from '../../lib/toast';

const countries: [string, string][] = [['KE', 'Kenya'], ['UG', 'Uganda'], ['TZ', 'Tanzania'], ['ET', 'Ethiopia'], ['SA', 'Saudi Arabia'], ['AE', 'United Arab Emirates'],
  ['QA', 'Qatar'], ['KW', 'Kuwait'], ['OM', 'Oman'], ['BH', 'Bahrain'], ['LB', 'Lebanon'], ['JO', 'Jordan'], ['GB', 'United Kingdom'], ['US', 'United States']];
const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** Public page: anyone can report someone else in danger, optionally with photos or videos. */
// A file that the storage service refused (or that never reached it).
class UploadError extends Error { file: string; constructor(file: string) { super('upload'); this.file = file; } }

export function ReportSomeonePage() {
  const config = publicReportsApi.usePublicReportConfigQuery();
  const [create] = publicReportsApi.useCreatePublicReportMutation();
  const [authorize] = publicReportsApi.useAuthorizePublicUploadMutation();
  const [complete] = publicReportsApi.useCompletePublicUploadMutation();
  const [submitReport] = publicReportsApi.useSubmitPublicReportMutation();
  const [form, setForm] = useState({ description: '', country: '', place: '', urgency: 'urgent', contact: '', website: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const settings = config.currentData?.data;

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    setError('');
    if (!settings) return;
    const next = [...files];
    for (const file of picked) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const kind = settings.video.extensions.includes(ext) ? settings.video : settings.image.extensions.includes(ext) ? settings.image : null;
      if (!kind) { setError(`${file.name}: use a photo (JPG, PNG, WEBP, HEIC) or video (MP4, MOV, WEBM, 3GP).`); continue; }
      if (file.size > kind.maxBytes) { setError(`${file.name} is larger than ${megabytes(kind.maxBytes)}.`); continue; }
      if (next.length >= settings.maxFiles) { setError(`Up to ${settings.maxFiles} files.`); break; }
      next.push(file);
    }
    setFiles(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      setProgress('Sending your report…');
      const { id, token } = (await create({ description: form.description.trim(), country: form.country, urgency: form.urgency,
        ...(form.place.trim() ? { place: form.place.trim() } : {}), ...(form.contact.trim() ? { contact: form.contact.trim() } : {}), ...(form.website ? { website: form.website } : {}) }).unwrap()).data;
      for (const [index, file] of files.entries()) {
        setProgress(`Uploading file ${index + 1} of ${files.length}…`);
        const auth = (await authorize({ id, token, filename: file.name, bytes: file.size }).unwrap()).data;
        const body = new FormData();
        Object.entries(auth.fields).forEach(([key, value]) => body.append(key, String(value)));
        body.append('file', file);
        const response = await fetch(auth.uploadUrl, { method: 'POST', body }).catch(() => null);
        if (!response?.ok) throw new UploadError(file.name);
        await complete({ id, token, publicId: auth.publicId, filename: file.name, bytes: file.size }).unwrap();
      }
      setProgress('Finishing…');
      await submitReport({ id, token }).unwrap();
      setDone(true);
      toast.success('Sariel’s team will review it.', 'Report sent');
    } catch (failure) {
      const status = apiStatus(failure);
      if (failure instanceof UploadError) { toast.error(`Couldn’t upload ${failure.file}.`); setError(`Couldn’t upload ${failure.file}. Your report was not sent. Try again, or remove the file and send without it.`); return; }
      if (status === 503) { setError('Photo and video uploads are not available right now. Remove the files and send your report without them.'); return; }
      setError(status === 429 ? 'Too many reports from this connection. Please wait a few minutes.' : status === 422 ? 'Please check the details and try again.'
        : 'Something went wrong while sending. Check your connection and try again.');
    } finally { setProgress(''); }
  }

  if (done) return <section className="pr-page"><div className="pr-card pr-done">
    <span className="pr-icon"><AccountIcon name="shield" /></span>
    <h1>Thank you. Your report was sent.</h1>
    <p>Sariel’s team and verified organisations in that country will review it. If the person is in immediate danger, also contact local emergency services.</p>
    <Link className="pr-ghost" to="/">Back to home</Link>
  </div></section>;

  return <section className="pr-page" aria-labelledby="pr-title">
    <form className="pr-card" onSubmit={submit}>
      <span className="pr-icon"><AccountIcon name="activity" /></span>
      <h1 id="pr-title">Report someone in danger</h1>
      <p className="pr-lead">You don’t need an account. Tell us what you saw. If someone is in immediate danger, also contact local emergency services.</p>
      <label>What is happening?<textarea required minLength={10} maxLength={2000} rows={5} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
        placeholder="Who is in danger, what you saw, and when." /></label>
      <div className="pr-row">
        <label>Country<select required value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}><option value="">Choose a country</option>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        <label>Place (optional)<input maxLength={200} value={form.place} onChange={e => setForm({ ...form, place: e.target.value })} placeholder="Town, area or building" /></label>
      </div>
      <fieldset className="pr-urgency"><legend>How urgent is it?</legend>
        {([['urgent', 'Urgent: they are in danger now'], ['soon', 'They need help soon'], ['information', 'For information']] as const).map(([value, label]) =>
          <label key={value}><input type="radio" name="urgency" checked={form.urgency === value} onChange={() => setForm({ ...form, urgency: value })} />{label}</label>)}
      </fieldset>
      <div className="pr-files">
        <strong>Photos or videos (optional)</strong>
        {settings?.uploads ? <>
          <small>Up to {settings.maxFiles} files · photos up to {megabytes(settings.image.maxBytes)}, videos up to {megabytes(settings.video.maxBytes)}. Only reviewers can see them.</small>
          {!!files.length && <ul>{files.map((f, i) => <li key={i}><span>{f.name}</span><small>{megabytes(f.size) === '0 MB' ? '<1 MB' : megabytes(f.size)}</small>
            <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button></li>)}</ul>}
          {files.length < settings.maxFiles && <label className="pr-drop"><AccountIcon name="image" /><span>Add photo or video</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm,video/3gpp" multiple onChange={choose} /></label>}
        </> : <small>Photo and video uploads are not available right now. You can still send your report.</small>}
      </div>
      <label>Your contact (optional)<input maxLength={200} value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="Phone or email, if we may contact you" /></label>
      <label className="pr-trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} /></label>
      {error && <p role="alert" className="pr-error">{error}</p>}
      <button className="pr-primary" disabled={!!progress}>{progress || 'Send report'}</button>
      <p className="pr-small">Reports are reviewed by Sariel’s team and verified organisations in the country you choose.</p>
    </form>
  </section>;
}
