import { useState } from 'react';
import { AccountMenu } from '../../components/account-menu';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { AccountIcon } from '../../components/account-icon';
import { WorkspaceGate } from '../tenancy/workspace-switcher';
import './platform.css';

const primary = [
  ['Organizations', 'workspaces', 'globe'],
  ['Incidents', 'incidents', 'activity'],
  ['Public reports', 'public-reports', 'activity'],
  ['Photo check', 'photo-check', 'image'],
  ['Users', 'users', 'user'],
] as const;
const settings = [
  ['Platform', 'platform-settings'], ['AI providers', 'ai-settings'], ['Audit log', 'audit'], ['Trash', 'recovery'], ['My profile', 'profile'],
] as const;

export function PlatformLayout() {
  const path = useLocation().pathname.replace(/\/$/,'');
  const incidents = path === '/admin/incidents';
  const inSettings = settings.some(([,slug])=>path==='/admin/'+slug);
  const [collapsed,setCollapsed] = useState(()=>{
    try { return localStorage.getItem('sariel.sidebar.collapsed') === 'true'; } catch { return false; }
  });
  function toggle() {
    setCollapsed(!collapsed);
    try { localStorage.setItem('sariel.sidebar.collapsed',String(!collapsed)); } catch { /* Optional preference storage. */ }
  }
  return <div className={'sariel-console'+(incidents?' incident-console':'')+(collapsed?' rail-collapsed':'')}>
    <aside className="sariel-rail">
      <header className="rail-head"><Link to="/" className="sariel-home" aria-label="SARIEL home">{collapsed ? 'S' : 'SARIEL'}</Link>
        <button className="rail-toggle" aria-label={collapsed?'Expand sidebar':'Collapse sidebar'} title={collapsed?'Expand sidebar':'Collapse sidebar'}
          aria-controls="platform-navigation" aria-expanded={!collapsed} onClick={toggle}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>
        </button>
        {!collapsed && <span>Platform administration</span>}
      </header>
      <nav id="platform-navigation" aria-label="Platform administration">{primary.map(([label,slug,icon])=>
        <NavLink key={slug} title={label} aria-label={label} to={'/admin/'+slug}><AccountIcon name={icon}/>{!collapsed && <span>{label}</span>}</NavLink>)}
        <Link to="/admin/platform-settings" className={inSettings?'active':undefined} title="Settings" aria-label="Settings"><AccountIcon name="edit"/>{!collapsed && <span>Settings</span>}</Link>
      </nav>
    </aside>
    <main className="sariel-content">{!incidents && <header className="platform-account-bar">
      {inSettings && <nav className="platform-settings-tabs" aria-label="Settings sections">{settings.map(([label,slug])=>
        <NavLink key={slug} to={'/admin/'+slug}>{label}</NavLink>)}</nav>}
      <AccountMenu platform /></header>}
      <WorkspaceGate><Outlet/></WorkspaceGate>
    </main>
  </div>;
}
