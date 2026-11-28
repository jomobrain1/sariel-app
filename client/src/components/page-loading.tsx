import { useLocation } from 'react-router';
import './page-loading.css';
const titles: Record<string,string> = { workspaces:'Organizations', incidents:'Incidents', 'public-reports':'Public reports', notifications:'Notifications', 'ai-settings':'AI providers', 'platform-settings':'Platform settings', 'photo-check':'Photo check', users:'Users', profile:'My profile', audit:'Audit log', recovery:'Trash', dashboard:'Your safety', circle:'Circle', assistant:'Assistant', photos:'Report photos' };
export function PageLoading() {
  const { pathname } = useLocation();
  const segment = pathname.split('/').filter(Boolean).at(-1) ?? '';
  const title = titles[segment], table = ['incidents','users','audit'].includes(segment);
  return <section className="page-loading" role="status" aria-label={'Loading '+(title??'page')}>
    {title ? <h1>{title}</h1> : <div className="skeleton-block skeleton-heading" />}
    <div className="skeleton-block skeleton-subtitle" />
    <div className={table?'loading-table':'loading-cards'} aria-hidden="true">
      {(table?[1,2,3,4,5]:[1,2,3]).map(n=><div className="loading-card" key={n}><div className="skeleton-block"/><div className="skeleton-block"/><div className="skeleton-block"/></div>)}
    </div>
  </section>;
}
