import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Modal } from '@tilcayo/ui';
import { useAuth } from '../../app/auth';
import { AccountIcon } from '../../components/account-icon';
import { notificationsApi, type NotificationItem } from './notifications.api';
import './notifications.css';

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const deliveryLabel: Record<string, string> = { queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Not sent' };

function DeliveryBadges({ item }: { item: NotificationItem }) {
  return <>{item.deliveries.map(d => <span key={d.channel} className={'note-delivery state-' + d.state}>
    {d.channel === 'sms' ? 'SMS' : 'Email'}: {deliveryLabel[d.state]}</span>)}</>;
}
function Item({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const [read] = notificationsApi.useMarkReadMutation();
  const [acknowledge, acknowledging] = notificationsApi.useAcknowledgeMutation();
  const [error, setError] = useState('');
  return <li className={'note-item' + (item.readAt ? '' : ' is-unread') + (item.priority === 'emergency' ? ' is-emergency' : '')}>
    <span className="note-dot" aria-hidden="true" />
    <button type="button" className="note-open note-main" onClick={() => { onOpen(); if (!item.readAt) void read(item.id); }} aria-label={'View notification: ' + item.title}>
      <strong>{item.title}</strong>
      <span className="note-meta"><time dateTime={item.createdAt}>{date(item.createdAt)}</time><DeliveryBadges item={item} /></span>
    </button>
    <div className="note-actions">
      {item.priority === 'emergency' && (item.acknowledgedAt ? <span className="note-acknowledged">Acknowledged</span>
        : <button className="note-primary" disabled={acknowledging.isLoading} onClick={async () => {
          setError(''); try { await acknowledge(item.id).unwrap(); } catch { setError('Could not acknowledge. Try again.'); }
        }}>I'm on it</button>)}
      {error && <small role="alert">{error}</small>}
    </div>
  </li>;
}
function Preferences() {
  const prefs = notificationsApi.usePreferencesQuery();
  const [save, saving] = notificationsApi.useSavePreferencesMutation();
  const value = prefs.currentData?.data;
  return <section className="note-prefs" aria-labelledby="delivery-preferences">
    <div><h2 id="delivery-preferences">Delivery preferences</h2><p>Urgent alerts use your available contact details.</p></div>
    {value ? <div className="note-toggles">
      <label><input type="checkbox" checked={value.email} disabled={saving.isLoading} onChange={e => void save({ ...value, email: e.target.checked })} />Email</label>
      <label><input type="checkbox" checked={value.sms} disabled={saving.isLoading} onChange={e => void save({ ...value, sms: e.target.checked })} />SMS <small>Verified phone required</small></label>
    </div> : <span role="status">{prefs.isError ? 'Preferences unavailable' : 'Loading preferences...'}</span>}
    {saving.isError && <p role="alert">Could not save preferences. Try again.</p>}
  </section>;
}
function NotificationDetails({ item }: { item: NotificationItem }) {
  // Only linkify validated HTTPS map links; React escapes the remaining description.
  const parts = item.body.split(/(https:\/\/maps\.google\.com\/\?q=[-\d.,]+)/g);
  return <div className="note-detail">
    <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
    <p className="note-description">{parts.map((part, i) => part.startsWith('https://maps.google.com/?q=')
      ? <a key={i} href={part} target="_blank" rel="noreferrer">Open location in Maps</a> : part)}</p>
    {!!item.deliveries.length && <section><h3>Delivery</h3><dl>{item.deliveries.map(d => <div key={d.channel}>
      <dt>{d.channel === 'sms' ? 'SMS' : 'Email'}</dt><dd><span className={'note-delivery state-' + d.state}>{deliveryLabel[d.state]}</span>
        {d.sentAt && <small>Sent {date(d.sentAt)}</small>}
        {d.attempts > 0 && <small>{d.attempts} attempt{d.attempts === 1 ? '' : 's'}</small>}
        {d.lastError && <small className="note-delivery-error">{d.lastError}</small>}</dd>
    </div>)}</dl></section>}
    {item.acknowledgedAt && <p>Acknowledged {date(item.acknowledgedAt)}</p>}
    {item.link.startsWith('/') && !item.link.startsWith('//') && <Link className="note-ghost note-detail-link" to={item.link}>Open related page <AccountIcon name="arrow" /></Link>}
  </div>;
}
export function NotificationsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<NotificationItem | null>(null);
  const list = notificationsApi.useNotificationsQuery(page, { pollingInterval: 30_000, skip: !user || !!user.tenant });
  const [readAll, readingAll] = notificationsApi.useMarkAllReadMutation();
  if (user?.tenant) return <Navigate to="/dashboard" replace />;
  const data = list.currentData?.data;
  const detail = data?.items.find(item => item.id === selected?.id) ?? selected;
  const pages = data?.totalPages ?? Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 30)));
  const pagination = data && <nav className="note-pages" aria-label="Notification pages">
    <button className="note-ghost" disabled={page === 1 || list.isFetching} onClick={() => setPage(page - 1)}>Previous</button>
    <span aria-live="polite">Page {page} of {pages} · {data.total} notifications</span>
    <button className="note-ghost" disabled={!data.hasNext || list.isFetching} onClick={() => setPage(page + 1)}>Next</button>
  </nav>;
  return <section className="note-page" aria-labelledby="notifications-title">
    <header className="note-head"><div><h1 id="notifications-title">Notifications</h1><p>{data ? data.unread ? data.unread + ' unread' : "You're all caught up." : ' '}</p></div>
      {!!data?.unread && <button className="note-ghost" disabled={readingAll.isLoading} onClick={() => void readAll()}>Mark all as read</button>}
    </header>
    <Preferences />
    <section className="note-card note-feed">
      {pagination}
      {list.isError && <p role="alert">Could not refresh notifications. <button className="note-ghost" onClick={() => void list.refetch()}>Retry</button></p>}
      {!data ? <div className="content-skeleton" role="status" aria-label="Loading notifications">{[1,2,3].map(n => <div key={n} className="skeleton-block" style={{ height: 76 }} />)}</div>
        : data.items.length ? <ul className="note-list">{data.items.map(item => <Item key={item.id} item={item} onOpen={() => setSelected(item)} />)}</ul>
          : <div className="note-empty"><AccountIcon name="bell" /><p>No notifications yet.</p></div>}
      {data && data.items.length > 5 && pagination}
    </section>
    <Modal open={!!detail} title={detail?.title ?? 'Notification details'} onClose={() => setSelected(null)}>
      {detail && <NotificationDetails item={detail} />}
    </Modal>
  </section>;
}
