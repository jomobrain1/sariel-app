import { AccountIcon } from './account-icon';
import { BrandMark } from './starter-visuals';
/** Illustration of the mobile Home screen, with no customer data. */
export function MobileAppPreview() {
  return <div className="app-phone-stage"><div className="app-phone" role="img" aria-label="Sariel mobile app preview: safety status, incident reporting and safety tools">
    <div className="app-phone-camera"/><div className="app-phone-screen">
      <div className="app-preview-brand"><span><BrandMark/>SARIEL</span><AccountIcon name="bell"/></div>
      <p className="app-preview-greeting">Hi, there</p>
      <div className="app-preview-status"><small>CURRENT STATUS</small><strong>Confirmed safe</strong><span>I'm safe</span><span>I'm travelling</span></div>
      <div className="app-preview-report"><b>+</b> Report an incident</div>
      <div className="app-preview-tools">{([{icon:'image',label:'Report photos'},{icon:'link',label:'Private link'},{icon:'calendar',label:'Scheduled check-ins'}] as const).map(item=><div key={item.label}><AccountIcon name={item.icon}/><span>{item.label}</span><span>›</span></div>)}</div>
      <div className="app-preview-nav"><span><AccountIcon name="dashboard"/>Home</span><span><AccountIcon name="shield"/>Incidents</span><span><AccountIcon name="user"/>Profile</span></div>
    </div></div><span className="app-preview-caption">App preview</span></div>;
}
