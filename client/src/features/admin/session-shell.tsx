import { AdminLayout } from '@tilcayo/admin';

// While the session loads, show only Sariel's name and a neutral menu, never the framework's defaults.
const placeholder = { id: '', name: '', email: '', adminTabs: ['overview'] };

/** Navigation is presentation only; protected routes and queries stay unmounted. */
export function AdminSessionShell() {
  return <AdminLayout pending title="Sariel" user={placeholder} />;
}
