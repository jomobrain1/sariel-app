import { orgIncidentsApi } from './org-incidents.api';
import './org-incidents.css';

/** Superadmin control: whether a verified organisation may see and respond to incidents. */
export function OrganizationAccess({ id }: { id: string }) {
  const access = orgIncidentsApi.useOrganizationAccessQuery(id);
  const [save, saving] = orgIncidentsApi.useSetOrganizationAccessMutation();
  const data = access.currentData?.data;
  if (access.isError) return <p role="alert">Couldn’t load incident access.</p>;
  if (!data) return <p role="status">Loading…</p>;
  return <section className="org-access">
    <div className="org-access-head">
      <div><h3>Incident access</h3><p>Approved organisations are routed incidents and their responders can see an Incidents tab. Only incidents routed to them are visible.</p></div>
      <span className={'org-pill ' + (data.allowed ? 'is-on' : 'is-off')}>{data.allowed ? 'Approved' : 'Not approved'}</span>
    </div>
    <ul className="org-checks">
      <li className={data.verified ? 'is-ok' : undefined}>{data.verified ? '✓' : '•'} Organisation verified <small>(set under Scope → verification)</small></li>
      <li className={data.enabled ? 'is-ok' : undefined}>{data.enabled ? '✓' : '•'} Incident access turned on</li>
    </ul>
    <div className="org-actions">
      {data.enabled
        ? <button className="org-ghost is-danger" disabled={saving.isLoading} onClick={() => { if (confirm('Revoke incident access? Responders lose the Incidents tab immediately.')) void save({ id, incidentAccess: false }); }}>Revoke access</button>
        : <button className="org-primary" disabled={saving.isLoading} onClick={() => void save({ id, incidentAccess: true })}>Grant incident access</button>}
      {!data.verified && data.enabled && <small>Access takes effect once the organisation is verified.</small>}
      {data.changedAt && <small>Last changed {new Date(data.changedAt).toLocaleString()}</small>}
    </div>
  </section>;
}
