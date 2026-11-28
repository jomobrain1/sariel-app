import { AdminSessionShell } from '../features/admin/session-shell';
import { useLocation } from 'react-router';
import { PageLoading } from './page-loading';
export function SessionSkeleton() {
  const {pathname}=useLocation();
  if(/^\/admin(?:\/|$)/.test(pathname))return <AdminSessionShell/>;
  return <PageLoading/>;
}
