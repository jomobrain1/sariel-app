import { AccountMenu } from '../../components/account-menu';
import { Link, NavLink, Outlet } from 'react-router';
import { AccountIcon } from '../../components/account-icon';
import { WorkspaceGate } from '../tenancy/workspace-switcher';
import './platform.css';

const links = [
  ['Organizations', 'workspaces', 'globe'],
  ['Users', 'users', 'user'],
  ['Platform settings', 'platform-settings', 'edit'],
  ['Audit log', 'audit', 'shield'],
  ['Trash', 'recovery', 'calendar'],
  ['My profile', 'profile', 'user'],
] as const;

export function PlatformLayout() {
  return <div className="sariel-console">
    <aside className="sariel-rail">
      <header><Link to="/" className="sariel-home" aria-label="SARIEL home">SARIEL</Link><span>Platform administration</span></header>
      <nav aria-label="Platform administration">{links.map(([label, path, icon]) =>
        <NavLink key={path} to={'/admin/' + path}><AccountIcon name={icon}/>{label}</NavLink>)}</nav>
    </aside>
    <main className="sariel-content"><header className="platform-account-bar"><AccountMenu platform /></header><WorkspaceGate><Outlet/></WorkspaceGate></main>
  </div>;
}
