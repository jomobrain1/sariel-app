import { AdminProfile } from '@tilcayo/admin';
import { ProfilePhoto } from '../../components/profile-photo';
import { useAuth } from '../../app/auth';
import { PhoneSettings } from '../account/phone-settings';

export function ProfilePage() {
  const { user, restoreSession } = useAuth();
  // Superadmins add their phone here so incident alerts reach them by SMS.
  return <><AdminProfile user={user} onRefreshSession={restoreSession} photoControls={<ProfilePhoto />} />
    <div className="sariel-admin-phone"><PhoneSettings /></div></>;
}
