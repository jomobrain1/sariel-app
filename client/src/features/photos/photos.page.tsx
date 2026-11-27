import { useMemo, useState, type ChangeEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { apiStatus } from '../../lib/api-status';
import { AccountIcon } from '../../components/account-icon';
import { drawScene, scenes, type Scene } from './landscapes';
import { photosApi, type CoverPhoto } from './photos.api';
import './photos.css';

type Tab = 'generate' | 'library' | 'upload';
const kindLabel = { generated: 'Generated', upload: 'Uploaded', library: 'Library' } as const;
const MAX_BYTES = 6 * 1024 * 1024;

function problem(error: unknown, fallback: string) {
  const status = apiStatus(error);
  if (status === 503) return 'Image generation isn’t set up yet. Use the library or upload a photo instead.';
  if (status === 429) return 'You’ve reached the limit for now. Try again later.';
  if (status === 422 || status === 413) return 'That file can’t be used. Choose a PNG or JPEG under 6 MB.';
  return fallback;
}
function daysLeft(value: string, now: number) {
  const days = Math.round((new Date(value).getTime() - now) / 86_400_000);
  return days <= 1 ? 'Deletes within a day' : `Deletes in ${days} days`;
}

function PhotoCard({ photo, now }: { photo: CoverPhoto; now: number }) {
  const full = photosApi.usePhotoQuery(photo.id);
  const [remove, removing] = photosApi.useDeletePhotoMutation();
  const src = full.currentData?.data.dataUrl;
  return <li className="photo-card">
    <div className="photo-frame">{src ? <img src={src} alt={`${kindLabel[photo.kind]} photo`} /> : <span role="status">Loading…</span>}</div>
    <div className="photo-meta">
      <div><strong>{photo.theme ? photo.theme[0].toUpperCase() + photo.theme.slice(1) : kindLabel[photo.kind]}</strong>
        <small>{kindLabel[photo.kind]} · {photo.width}×{photo.height} · {daysLeft(photo.expiresAt, now)}</small></div>
      <div className="photo-actions">
        {src && <a className="photo-ghost" href={src} download={`photo-${photo.id.slice(0, 8)}.png`}>Download</a>}
        <button className="photo-ghost is-danger" disabled={removing.isLoading} onClick={() => void remove(photo.id)}>Delete</button>
      </div>
    </div>
  </li>;
}

function Generate({ onError }: { onError: (message: string) => void }) {
  const themes = photosApi.usePhotoThemesQuery();
  const [generate, generating] = photosApi.useGeneratePhotoMutation();
  const [active, setActive] = useState('');
  async function pick(theme: string) {
    onError(''); setActive(theme);
    try { await generate(theme).unwrap(); } catch (error) { onError(problem(error, 'Couldn’t create a photo. Try another theme.')); }
    setActive('');
  }
  return <div className="photo-pane">
    <p>Pick a theme. Only the theme is sent to the image service, never anything about you.</p>
    <div className="photo-themes">{(themes.currentData?.data ?? []).map(t =>
      <button key={t.id} disabled={generating.isLoading} aria-busy={active === t.id} onClick={() => void pick(t.id)}>{active === t.id ? 'Creating…' : t.label}</button>)}</div>
  </div>;
}

function Library({ onError }: { onError: (message: string) => void }) {
  const [upload, uploading] = photosApi.useUploadPhotoMutation();
  const previews = useMemo(() => Object.keys(scenes).map(scene => ({ scene: scene as Scene, src: drawScene(scene as Scene, 360, 180).toDataURL('image/png') })), []);
  async function pick(scene: Scene) {
    onError('');
    try { await upload({ image: drawScene(scene).toDataURL('image/png'), kind: 'library' }).unwrap(); }
    catch (error) { onError(problem(error, 'Couldn’t add that photo.')); }
  }
  return <div className="photo-pane">
    <p>Free built-in photos. Nothing is sent to an outside service.</p>
    <div className="photo-library">{previews.map(p => <button key={p.scene} disabled={uploading.isLoading} onClick={() => void pick(p.scene)}>
      <img src={p.src} alt="" /><span>{scenes[p.scene]}</span></button>)}</div>
  </div>;
}

function Upload({ onError }: { onError: (message: string) => void }) {
  const [upload, uploading] = photosApi.useUploadPhotoMutation();
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    onError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > MAX_BYTES) { onError('Choose a PNG or JPEG under 6 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { upload({ image: String(reader.result), kind: 'upload' }).unwrap().catch(error => onError(problem(error, 'Couldn’t upload that photo.'))); };
    reader.readAsDataURL(file);
  }
  return <div className="photo-pane">
    <p>Use one of your own photos. Location and camera details are removed.</p>
    <label className="photo-drop"><AccountIcon name="edit" /><span>{uploading.isLoading ? 'Uploading…' : 'Choose a PNG or JPEG (up to 6 MB)'}</span>
      <input type="file" accept="image/png,image/jpeg" disabled={uploading.isLoading} onChange={choose} /></label>
  </div>;
}

export function PhotosPage() {
  const { user } = useAuth();
  const photos = photosApi.usePhotosQuery(undefined, { skip: !user || !!user.tenant });
  const [tab, setTab] = useState<Tab>('generate');
  const [error, setError] = useState('');
  const [now] = useState(() => Date.now());
  if (user?.tenant) return <Navigate to="/dashboard" replace />;
  const list = photos.currentData?.data ?? [];
  return <section className="photo-page" aria-labelledby="photos-title">
    <header className="photo-head"><h1 id="photos-title">Photos</h1>
      <p>Ordinary photos you can later turn into report photos. They delete themselves after 7 days.</p></header>
    <section className="photo-card-panel">
      <div className="photo-tabs" role="tablist" aria-label="Add a photo">
        {([['generate', 'Generate'], ['library', 'Library'], ['upload', 'Upload']] as const).map(([key, label]) =>
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setError(''); }}>{label}</button>)}
      </div>
      {tab === 'generate' ? <Generate onError={setError} /> : tab === 'library' ? <Library onError={setError} /> : <Upload onError={setError} />}
      {error && <p role="alert" className="photo-error">{error}</p>}
    </section>
    <section className="photo-card-panel">
      <h2>Your photos</h2>
      {photos.isError ? <p role="alert">Couldn’t load your photos.</p> : !photos.currentData ? <p role="status">Loading…</p>
        : list.length ? <ul className="photo-grid">{list.map(p => <PhotoCard key={p.id} photo={p} now={now} />)}</ul>
        : <div className="photo-empty"><AccountIcon name="globe" /><p>No photos yet. Generate one, pick from the library, or upload your own.</p></div>}
    </section>
  </section>;
}
