import { AdminLayout } from '@tilcayo/admin';
import { PlatformLayout } from '../administration/platform-layout';
import { useGetWorkspaceQuery } from '../tenancy/tenancy.api';
import { lastShell } from '../../lib/shell-hint';
import { PageLoading } from '../../components/page-loading';
/** Presentation only; protected routes remain unmounted until verification. */
export function AdminSessionShell() {
  const workspace=useGetWorkspaceQuery();
  const organization=!!workspace.data?.data.tenant||lastShell()==='workspace';
  if(organization)return <AdminLayout title="Sariel" user={{name:'',email:'',adminTabs:['overview']}}><PageLoading/></AdminLayout>;
  return <PlatformLayout pending><PageLoading/></PlatformLayout>;
}
