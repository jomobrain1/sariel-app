import { Link } from 'react-router'
import { useAuth } from '../app/auth'
import { AccountIcon } from '../components/account-icon'
import './home.css'

const features = [
  { icon: 'shield', title: 'Report in seconds', text: 'Tell responders what’s happening with one tap, a private link, or a photo that hides your report.' },
  { icon: 'user', title: 'A circle that looks out for you', text: 'Invite family and friends. Choose exactly what each person can see, and change it any time.' },
  { icon: 'calendar', title: 'Check-ins that notice silence', text: 'If you miss a check-in, your circle is asked to reach out. Never treated as an emergency unless you choose.' },
  { icon: 'chat', title: 'Help in your language', text: 'An assistant in English and Kiswahili for your status, circle and next steps. You confirm every action.' },
] as const

const steps = [
  { title: 'Create your account', text: 'Add your details and the people you trust.' },
  { title: 'Prepare quietly', text: 'Set up check-ins, a one-tap link or a report photo while you’re safe.' },
  { title: 'Get help when it matters', text: 'Report from anywhere. Your circle and verified responders are alerted.' },
]

export function HomePage() {
  const { isAuthenticated, user } = useAuth()
  const staff = !!user?.tenant || user?.platformRole === 'superadmin'
  return <div className="home">
    <section className="home-hero" aria-labelledby="home-title">
      <p className="home-eyebrow">Personal safety for migrant workers and travellers</p>
      <h1 id="home-title">Help that reaches you, wherever you are.</h1>
      <p className="home-lead">Sariel connects you with the people you trust and verified responders, discreetly and on your terms.</p>
      <div className="home-actions">
        {isAuthenticated
          ? <Link className="home-primary" to={staff && !user?.tenant ? '/admin/workspaces' : '/dashboard'}>Open your dashboard <AccountIcon name="arrow" /></Link>
          : <><Link className="home-primary" to="/register">Create a free account <AccountIcon name="arrow" /></Link>
            <Link className="home-secondary" to="/login">Log in</Link></>}
      </div>
      <p className="home-report"><Link to="/report-someone">See someone in danger? Report it, no account needed →</Link></p>
    </section>

    <section className="home-features" aria-label="What Sariel does">
      {features.map(f => <article key={f.title}>
        <span className="home-icon"><AccountIcon name={f.icon} /></span>
        <h2>{f.title}</h2>
        <p>{f.text}</p>
      </article>)}
    </section>

    <section className="home-steps" aria-labelledby="steps-title">
      <h2 id="steps-title">How it works</h2>
      <ol>{steps.map((s, i) => <li key={s.title}><span>{i + 1}</span><div><h3>{s.title}</h3><p>{s.text}</p></div></li>)}</ol>
    </section>

    <section className="home-privacy">
      <span className="home-icon"><AccountIcon name="lock" /></span>
      <div><h2>Private by design</h2>
        <p>Reports are encrypted, alerts by email and text never reveal names or places, and you decide who sees what.</p></div>
      <Link className="home-secondary" to="/about">Learn more</Link>
    </section>
  </div>
}
