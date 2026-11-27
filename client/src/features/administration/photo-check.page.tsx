import { useState, type ChangeEvent } from 'react';
import { tilcayoApi } from '../../app/api';
import { AccountIcon } from '../../components/account-icon';
import './ai-settings.css';

type CheckResult = {
  valid: boolean; message: string; person: { name: string; email: string } | null;
  report: { level: number; status: string; category: string; country: string | null; createdAt: string; revoked: boolean; uses: number } | null;
  incident: { reference: string; duplicate: boolean } | null;
};
const checkApi = tilcayoApi.injectEndpoints({ endpoints: b => ({
  checkPhoto: b.mutation<{ data: CheckResult }, { image: string; createIncident: boolean }>({ query: body => ({ url: '/platform/photo-check', method: 'POST', body }) }),
}) });

export function PhotoCheckPage() {
  const [check, checking] = checkApi.useCheckPhotoMutation();
  const [image, setImage] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState('');
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; setError(''); setResult(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 6 * 1024 * 1024) { setError('Choose a PNG or JPEG under 6 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  }
  async function run(createIncident: boolean) {
    setError('');
    try { setResult((await check({ image, createIncident }).unwrap()).data); } catch { setError('The check failed. Try again.'); }
  }
  return <section className="ai-admin" aria-labelledby="check-title">
    <header className="ai-head"><h1 id="check-title">Photo check</h1><p>Decode a photo someone forwarded or posted, and confirm whether it carries a genuine Sariel report.</p></header>
    <section className="ai-panel">
      <div className="check-grid">
        <label className={'check-drop' + (image ? ' has-image' : '')}>{image ? <><img src={image} alt="Photo to check" /><span className="check-change">Choose a different photo</span></>
          : <><span className="check-drop-icon"><AccountIcon name="image" /></span><strong>Choose a photo to check</strong><small>PNG or JPEG, up to 6 MB</small></>}
          <input type="file" accept="image/png,image/jpeg" onChange={choose} /></label>
        <div className="check-side">
          <div className="ai-actions">
            <button className="ai-ghost" disabled={!image || checking.isLoading} onClick={() => void run(false)}>Check only</button>
            <button className="ai-primary" disabled={!image || checking.isLoading} onClick={() => void run(true)}>Check and create incident</button>
          </div>
          {error && <p role="alert" className="ai-error">{error}</p>}
          {result && <div className={'check-result ' + (result.valid ? 'is-valid' : 'is-invalid')} role="status">
            <strong>{result.valid ? '✓ Genuine Sariel report' : '✕ Not a valid report'}</strong>
            <p>{result.message}</p>
            {result.report && <dl>
              {result.person && <><dt>Person</dt><dd>{result.person.name} · {result.person.email}</dd></>}
              <dt>Report</dt><dd>{result.report.status} · {result.report.category}{result.report.country ? ' · ' + result.report.country : ''}</dd>
              <dt>Created</dt><dd>{new Date(result.report.createdAt).toLocaleString()}</dd>
              <dt>Used</dt><dd>{result.report.uses} time{result.report.uses === 1 ? '' : 's'}{result.report.revoked ? ' · revoked' : ''}</dd>
              {result.incident && <><dt>Incident</dt><dd>{result.incident.duplicate ? 'Already open' : 'Created'} · ref {result.incident.reference.slice(0, 12)}… (see Incidents)</dd></>}
            </dl>}
          </div>}
        </div>
      </div>
    </section>
  </section>;
}
