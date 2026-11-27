import { useState, type ChangeEvent } from 'react';
import { tilcayoApi } from '../../app/api';
import { AccountIcon } from '../../components/account-icon';
import './photos.css';

const shareApi = tilcayoApi.injectEndpoints({ endpoints: b => ({
  sharePhoto: b.mutation<unknown, string>({ query: image => ({ url: '/auth/safety/photo', method: 'POST', body: { image } }) }),
}) });

// Public page where anyone can submit a photo. It always answers the same way, so it reveals nothing.
export function SharePhotoPage() {
  const [share, sharing] = shareApi.useSharePhotoMutation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; setError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 6 * 1024 * 1024) { setError('Choose a PNG or JPEG under 6 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { share(String(reader.result)).unwrap().then(() => setDone(true), () => setError('Upload failed. Check your connection and try again.')); };
    reader.readAsDataURL(file);
  }
  return <section className="photo-page share-page" aria-labelledby="share-title">
    <div className="photo-card-panel share-card">
      <span className="share-icon"><AccountIcon name="image" /></span>
      <h1 id="share-title">Share a photo</h1>
      {done ? <><p>Thank you. Your photo was received.</p><button className="photo-ghost" onClick={() => setDone(false)}>Share another</button></> : <>
        <p>Upload the original photo file.</p>
        <label className="photo-drop"><AccountIcon name="edit" /><span>{sharing.isLoading ? 'Uploading…' : 'Choose a photo (PNG or JPEG)'}</span>
          <input type="file" accept="image/png,image/jpeg" disabled={sharing.isLoading} onChange={choose} /></label>
        {error && <p role="alert" className="photo-error">{error}</p>}</>}
    </div>
  </section>;
}
