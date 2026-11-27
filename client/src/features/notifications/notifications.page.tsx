import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { AccountIcon } from '../../components/account-icon';
import { notificationsApi, type NotificationItem } from './notifications.api';
import './notifications.css';

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const deliveryLabel: Record<string, string> = { queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Not sent' };

function Item({ item }: { item: NotificationItem }) {
  const [read] = notificationsApi.useMarkReadMutation();
  const [acknowledge, acknowledging] = notificationsApi.useAcknowledgeMutation();
  const emergency = item.priority === 'emergency';
  return <li className={'note-item' + (item.readAt ? '' : ' is-unread') + (emergency ? ' is-emergency' : '')}>
    <span className="note-dot" aria-hidden="true" />
    <div className="note-main">
      <Link to={item.link} onClick={() => { if (!item.readAt) void read(item.id); }}><strong>{item.title}</strong></Link>
      {item.body && <p>{item.body}</p>}
      <small><time dateTime={item.createdAt}>{date(item.createdAt)}</time>
        {item.deliveries.map(d => <span key={d.channel} className={'note-delivery state-' + d.state} title={d.lastError ?? undefined}>
          {d.channel === 'sms' ? 'SMS' : 'Email'}: {deliveryLabel[d.state]}{d.attempts > 1 ? ` after ${d.attempts} tries` : ''}</span>)}
      </small>
    </div>
    <div className="note-actions">
      {emergency && (item.acknowledgedAt
        ? <span className="note-acknowledged">Acknowledged</span>
        : <button className="note-primary" disabled={acknowledging.isLoading} onClick={() => void acknowledge(item.id)}>I’m on it</button>)}
      {!emergency && !item.readAt && <button className="note-ghost" onClick={() => void read(item.id)}>Mark read</button>}
    </div>
  </li>;
}

function Preferences() {
  const prefs = notificationsApi.usePreferencesQuery();
  const [save, saving] = notificationsApi.useSavePreferencesMutation();
  const value = prefs.currentData?.data;
  return <section className="note-card note-prefs">
    <h2>How we reach you</h2>
    <p>In-app notifications are always on. Urgent alerts about your circle use every channel you’ve set up.</p>
    {value && <div className="note-toggles">
      <label><input type="checkbox" checked={value.email} disabled={saving.isLoading} onChange={e => void save({ ...value, email: e.target.checked })} /><span><strong>Email</strong><small>Invites, check-in requests and reminders. Urgent alerts about your circle are always emailed.</small></span></label>
      <label><input type="checkbox" checked={value.sms} disabled={saving.isLoading} onChange={e => void save({ ...value, sms: e.target.checked })} /><span><strong>SMS</strong><small>Check-in requests and reminders. Needs a verified phone number.</small></span></label>
    </div>}
    <p className="note-hint">Email and text messages never include names, places or danger levels.</p>
  </section>;
}

export function NotificationsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const list = notificationsApi.useNotificationsQuery(page, { pollingInterval: 30_000, skip: !user || !!user.tenant });
  const [readAll, readingAll] = notificationsApi.useMarkAllReadMutation();
  if (user?.tenant) return <Navigate to="/dashboard" replace />;
  const data = list.currentData?.data;
  return <section className="note-page" aria-labelledby="notifications-title">
    <header className="note-head">
      <div><h1 id="notifications-title">Notifications</h1><p>{data ? data.unread ? `${data.unread} unread` : 'You’re all caught up.' : ' '}</p></div>
      {!!data?.unread && <button className="note-ghost" disabled={readingAll.isLoading} onClick={() => void readAll()}>Mark all as read</button>}
    </header>
    <div className="note-grid">
      <section className="note-card">
        {list.isError ? <p role="alert">Couldn’t load notifications. <button className="note-ghost" onClick={() => void list.refetch()}>Retry</button></p>
          : !data ? <p role="status">Loading…</p>
          : data.items.length ? <ul className="note-list">{data.items.map(item => <Item key={item.id} item={item} />)}</ul>
          : <div className="note-empty"><AccountIcon name="bell" /><p>Invites, check-in requests and circle alerts will appear here.</p></div>}
        {data && (page > 1 || data.hasNext) && <nav className="note-pages" aria-label="Notification pages">
          <button className="note-ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button>
          <button className="note-ghost" disabled={!data.hasNext} onClick={() => setPage(page + 1)}>Older</button>
        </nav>}
      </section>
      <Preferences />
    </div>
  </section>;
}
