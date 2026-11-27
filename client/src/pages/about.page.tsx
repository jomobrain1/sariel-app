import { Link } from 'react-router'
import { AccountIcon } from '../components/account-icon'
import './home.css'

const principles = [
  { icon: 'lock', title: 'Your information, your choice', text: 'You choose who sees your status, location and updates. You can change or remove access at any time, and removal is silent.' },
  { icon: 'shield', title: 'Discreet when it matters', text: 'One-tap links, report photos and neutral email and text alerts are designed so that someone watching your phone sees nothing unusual.' },
  { icon: 'globe', title: 'Verified responders only', text: 'Organisations are verified before they can see any incident, and only the ones that cover your country and situation are involved.' },
] as const

export function AboutPage() {
  return <div className="home">
    <section className="home-hero" aria-labelledby="about-title">
      <p className="home-eyebrow">About Sariel</p>
      <h1 id="about-title">Safety that travels with you.</h1>
      <p className="home-lead">Sariel helps migrant workers, travellers and the people who care about them stay connected and get help quickly, from reporting danger to everyday check-ins.</p>
      <div className="home-actions"><Link className="home-primary" to="/register">Get started <AccountIcon name="arrow" /></Link></div>
    </section>
    <section className="home-features home-features-3" aria-label="Our principles">
      {principles.map(p => <article key={p.title}><span className="home-icon"><AccountIcon name={p.icon} /></span><h2>{p.title}</h2><p>{p.text}</p></article>)}
    </section>
  </div>
}
