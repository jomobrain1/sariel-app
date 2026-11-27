import { WorkspaceGate } from '../features/tenancy/workspace-switcher';
import { Outlet } from 'react-router'
import { SiteHeader } from '../components/site-header'
import { SiteFooter } from '../components/site-footer'
import { LocationSharer } from '../features/circle/location-sharer'

export function AppLayout() {
  return (
    <div className="starter-site">
      <a className="starter-skip" href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main" className="tl-container starter-main" tabIndex={-1}>
        <WorkspaceGate><Outlet /></WorkspaceGate>
      </main>
      <SiteFooter />
      <LocationSharer />
    </div>
  )
}
