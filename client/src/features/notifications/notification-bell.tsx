import { NavLink } from 'react-router';
import { AccountIcon } from '../../components/account-icon';
import { notificationsApi } from './notifications.api';
import './notifications.css';

// Polls for new notifications. Live push (WebSocket) can replace this without changing the API data.
export function NotificationBell({ onNavigate }: { onNavigate?: () => void }) {
  const count = notificationsApi.useUnreadQuery(undefined, { pollingInterval: 30_000, refetchOnFocus: true });
  const unread = count.currentData?.data.unread ?? 0;
  const urgent = (count.currentData?.data.urgent ?? 0) > 0;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return <NavLink to="/notifications" className={'notification-bell' + (urgent ? ' is-urgent' : '')} aria-label={label} title={label} onClick={onNavigate}>
    <AccountIcon name="bell" />
    {unread > 0 && <span className="notification-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
  </NavLink>;
}
