import { Skeleton } from '@tilcayo/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { useAuth } from '../app/auth'
import { BrandMark } from './starter-visuals'
import { AccountMenu } from './account-menu'


export function Navigation() {
  const { initialized, isAuthenticated, user } = useAuth()
  const individual = isAuthenticated && !!user && !user.tenant && user.platformRole !== 'superadmin'
  const [isOpen, setIsOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const close = () => setIsOpen(false)
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 48rem)')
    const closeOnResize = () => setIsOpen(false)
    desktop.addEventListener('change', closeOnResize)
    return () => { desktop.removeEventListener('change', closeOnResize) }
  }, [])
  return <nav className="starter-nav" aria-label="Main navigation" onKeyDown={event => {
    if (event.key === 'Escape') {
      if (isOpen) { setIsOpen(false); toggleRef.current?.focus() }
    }
  }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}>
    <Link className="starter-brand" to="/" onClick={close}><BrandMark />SARIEL</Link>
    <button ref={toggleRef} className="starter-menu-toggle" type="button" aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={isOpen} aria-controls="starter-navigation-links" onClick={() => { setIsOpen(!isOpen) }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d={isOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
    </button>
    <div id="starter-navigation-links" className={`starter-nav-panel${isOpen ? ' is-open' : ''}`}>
      <div className="starter-nav-links">
        <NavLink to="/" end onClick={close}>Home</NavLink>
        {individual && <NavLink to="/circle" onClick={close}>Circle</NavLink>}
        {individual && <NavLink to="/assistant" onClick={close}>Assistant</NavLink>}
        <NavLink to="/elements" onClick={close}>Elements</NavLink>
        <NavLink to="/about" onClick={close}>About</NavLink>
      </div>
      {initialized && !isAuthenticated && <div className="starter-nav-actions">
        <NavLink to="/login" onClick={close}>Log in</NavLink>
        <NavLink className="starter-get-started" to="/register" onClick={close}>Get Started</NavLink>
      </div>}
    </div>
    {!initialized && <div className="starter-account" aria-label="Checking session"><Skeleton width={38} height={38} circle /></div>}
    {isAuthenticated && <AccountMenu onToggle={() => setIsOpen(false)} />}
  </nav>
}
