import { Link } from 'react-router'
import { useAuth } from '../app/auth'

const YEAR = new Date().getFullYear()

export function SiteFooter() {
  const { isAuthenticated } = useAuth()
  return <footer className="site-footer">
    <div>
      <span className="site-footer-brand">SARIEL</span>
      <nav aria-label="Footer"><Link to="/about">About</Link>{isAuthenticated ? <Link to="/dashboard">Dashboard</Link> : <><Link to="/login">Log in</Link><Link to="/register">Create account</Link></>}</nav>
    </div>
    <p>© {YEAR} Sariel · <a href="https://github.com/jomobrain1/tilcayo#readme" target="_blank" rel="noreferrer">Powered by <strong>Tilcayo</strong></a></p>
  </footer>
}
