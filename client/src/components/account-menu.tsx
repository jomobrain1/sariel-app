import { useEffect, useId, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { WorkspaceIdentity } from '../features/tenancy/workspace-switcher'
import { useAuth } from '../app/auth'
import { AccountIcon } from './account-icon'
import { NotificationBell } from '../features/notifications/notification-bell'

export function AccountMenu({ platform = false, onToggle }: { platform?: boolean; onToggle?: () => void }) {
  const { user, logout, logoutStatus } = useAuth()
  const platformAdmin = user?.platformRole === 'superadmin' && !user.tenant
  const individual = !!user && !user.tenant && !platformAdmin
  const canAdmin = user?.roles?.includes('admin') || !!user?.adminTabs?.length
  const [notice, setNotice] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)
  const accountToggleRef = useRef<HTMLButtonElement>(null)
  const accountId = useId()
  const close = () => setAccountOpen(false)
  useEffect(() => {
    if (!accountOpen) return
    const outside = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [accountOpen])
  async function signOut() {
    setNotice('')
    try { await logout(); close() } catch { setNotice('Unable to confirm sign-out. Please try again.') }
  }
  return <>
    <div className="starter-account" ref={accountRef} onKeyDown={event => {
      if (event.key === 'Escape' && accountOpen) { event.stopPropagation(); close(); accountToggleRef.current?.focus() }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false) }}>
      {(individual || platformAdmin) && <NotificationBell onNavigate={close} to={platformAdmin ? '/admin/notifications' : '/notifications'} />}
      <button ref={accountToggleRef} className="starter-account-toggle" type="button" aria-label="Open account menu" aria-expanded={accountOpen} aria-controls={accountId} onClick={() => { setAccountOpen(!accountOpen); onToggle?.() }}>
        <span className="starter-account-avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user?.name?.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'Me'}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {accountOpen && <div className="starter-account-popover" id={accountId}>
        <div className="starter-account-summary"><strong>{user?.name}</strong><span>{user?.email}</span></div>
        <WorkspaceIdentity />
        {platform ? <NavLink to="/" onClick={close}><AccountIcon name="globe" /> Homepage</NavLink> : <>
          <NavLink to={platformAdmin ? '/admin/workspaces' : '/dashboard'} onClick={close}><AccountIcon name="dashboard" /> {platformAdmin ? 'Platform administration' : 'My dashboard'}</NavLink>
          {!platformAdmin && canAdmin && <NavLink to="/admin" onClick={close}><AccountIcon name="shield" /> Workspace administration</NavLink>}
        </>}
        <NavLink to={platform ? "/admin/profile" : "/profile"} onClick={close}><AccountIcon name="user" /> Profile &amp; settings</NavLink>
        <div className="starter-account-divider" />
        <button className="account-sign-out" type="button" onClick={() => void signOut()} disabled={logoutStatus.isLoading}><AccountIcon name="logout" /> {logoutStatus.isLoading ? 'Signing out...' : 'Sign out'}</button>
      </div>}
    </div>
    {notice && <p className="starter-nav-notice" role="status">{notice}</p>}
  </>
}
