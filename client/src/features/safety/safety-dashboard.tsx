import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { onboardingApi } from '../onboarding/onboarding.api';
import { Modal } from '@tilcayo/ui';
import { useAuth } from '../../app/auth';
import { AccountIcon } from '../../components/account-icon';
import { Toggle } from '../../components/toggle';
import { labels, safetyApi, type Update } from './safety.api';
import './safety-dashboard.css';
import '../onboarding/onboarding.css';
import { useAppDispatch } from '../../app/hooks';
import { WelfareCard } from '../welfare/welfare-card';
import { welfareApi } from '../welfare/welfare.api';

const levels = [2, 3, 4, 5];
const categories = ['welfare', 'medical', 'harassment', 'labour exploitation'];
const date = (value: string) => new Date(value).toLocaleString(undefined, {dateStyle:'medium', timeStyle:'short'});

function IncidentLink() {
  const [issue, generated] = safetyApi.useIssueIncidentLinkMutation();
  const [revoke, revoked] = safetyApi.useRevokeIncidentLinkMutation();
  const [feedback,setFeedback] = useState('');
  const busy = generated.isLoading || revoked.isLoading;
  const url = generated.data && new URL(generated.data.data.url, location.origin).href;
  async function generate(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    setFeedback('');
    try {
      await issue({alias:String(fields.get('alias')).trim().toLowerCase(), level:Number(fields.get('level')), category:String(fields.get('category')).trim(),
        country:String(fields.get('country')).trim().toUpperCase() || undefined}).unwrap();
    } catch (error) {
      const taken = typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 409;
      setFeedback(taken ? 'That link name is taken. Choose another.' : 'Could not generate the link. Try again.');
    }
  }
  return <div className="safety-link">
    <p>Opening this link reports for your account. Keep the name private.</p>
    <a href="/safety/activate.html?practice=1" target="_blank" rel="noreferrer">Practice with the gallery</a>
    <form className="incident-link-form" onSubmit={generate}>
      <label>Link name<input name="alias" placeholder="jomo1" required pattern="[a-z][a-z0-9]{1,12}[0-9]" maxLength={14} autoCapitalize="none" spellCheck={false} aria-describedby="link-name-hint"/></label>
      <small id="link-name-hint">Use 3–14 lowercase letters and digits. Start with a letter and end with a digit, like jomo1.</small>
      <label>Incident level<select name="level" required defaultValue=""><option value="" disabled>Select a level</option>
        {levels.map(n=><option key={n} value={n}>{labels[n]}</option>)}</select></label>
      <label>Category<input name="category" defaultValue="welfare" required maxLength={120}/></label>
      <label>Country code (optional)<input name="country" maxLength={2} pattern="[A-Za-z]{2}" placeholder="KE"/></label>
      <button disabled={busy}>Create one-tap link</button>
    </form>
    {url && <><label>Your link<input readOnly value={url} onFocus={e=>e.target.select()}/></label>
      <button onClick={async()=>{try{await navigator.clipboard.writeText(url);setFeedback('Link copied.');}catch{setFeedback('Select the link and copy it manually.');}}}>Copy link</button></>}
    <button disabled={busy} onClick={async()=>{try{await revoke().unwrap();generated.reset();setFeedback('Link revoked.');}catch{setFeedback('Could not revoke the link. Try again.');}}}>Revoke link</button>
    {feedback && <p role="status">{feedback}</p>}
  </div>;
}

function Tools() {
  const [linkOpen, setLinkOpen] = useState(false);
  const tools = [
    {to:'/assistant', icon:'chat', title:'Assistant', text:'Ask about your safety, circle or check-ins'},
    {to:'/photos', icon:'image', title:'Report photos', text:'Hide a report inside an ordinary photo'},
    {to:'/circle', icon:'user', title:'Circle', text:'People who look out for you'},
  ] as const;
  return <section className="safety-panel safety-tools" aria-labelledby="tools-title">
    <h2 id="tools-title">Tools</h2>
    <ul>
      {tools.map(t => <li key={t.to}><Link to={t.to}><span className="safety-link-icon"><AccountIcon name={t.icon}/></span>
        <span><strong>{t.title}</strong><small>{t.text}</small></span><AccountIcon name="arrow"/></Link></li>)}
      <li><button type="button" onClick={() => setLinkOpen(true)}><span className="safety-link-icon"><AccountIcon name="link"/></span>
        <span><strong>One-tap incident link</strong><small>Report by opening a private link</small></span><AccountIcon name="arrow"/></button></li>
    </ul>
    <Modal open={linkOpen} title="One-tap incident link" onClose={() => setLinkOpen(false)}>{linkOpen && <IncidentLink/>}</Modal>
  </section>;
}

export function SafetyDashboard({accountId}:{accountId:string}) {
  const { user } = useAuth();
  const firstName = user?.name.trim().split(/\s+/)[0] ?? '';
  const onboarding = onboardingApi.useOnboardingQuery();
  const [now] = useState(() => Date.now());
  const status = safetyApi.useSafetyStatusQuery(accountId,{refetchOnMountOrArgChange:true});
  const history = safetyApi.useSafetyHistoryQuery(accountId,{refetchOnMountOrArgChange:true});
  const [send] = safetyApi.useSubmitSafetyUpdateMutation();
  const dispatch = useAppDispatch();
  const [level,setLevel] = useState<number>();
  const [category,setCategory] = useState('welfare');
  const [country,setCountry] = useState('');
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const pending = useRef(false);
  const last = useRef<Update | null>(null);
  const [message,setMessage] = useState('');
  const [reference,setReference] = useState('');
  const [showAll,setShowAll] = useState(false);
  const current = status.currentData?.data;
  const events = history.currentData?.data ?? [];

  async function submit(value: Pick<Update,'level'|'country'|'category'|'note'>){
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setMessage(''); setReference('');
    try {
      const previous = last.current;
      if (!previous || previous.level !== value.level || previous.country !== value.country || previous.category !== value.category || previous.note !== value.note)
        last.current = {...value, requestId:crypto.randomUUID()};
      const response = await send(last.current!).unwrap();
      last.current = null;
      if(value.level === 1) setMessage('Safe check-in recorded.');
      else {
        setMessage('Incident report recorded.');
        setReference(response.data.reference);
        setLevel(undefined); setCountry(''); setCategory('welfare'); setNote('');
      }
      void status.refetch(); void history.refetch();
      // A safe check-in also resets scheduled welfare check-ins.
      if (value.level === 1) dispatch(welfareApi.util.invalidateTags(['Welfare']));
    } catch {
      setMessage('Submission unconfirmed. Check your connection and retry with the same details.');
    } finally { pending.current = false; setBusy(false); }
  }
  function report(e:FormEvent){
    e.preventDefault();
    if(level !== undefined) void submit({level,category:category.trim(),country:country.trim().toUpperCase() || undefined,note:note.trim() || undefined});
  }

  const setupPending = onboarding.currentData && !onboarding.currentData.data.onboarded;
  // New accounts go straight to the welcome steps; older ones just get a reminder.
  const isNew = !!user?.createdAt && now - Date.parse(user.createdAt) < 2 * 24 * 60 * 60 * 1000;
  if (setupPending && isNew) return <Navigate to="/welcome" replace />;
  return <section className="safety-dashboard">
    {setupPending && <div className="setup-banner" role="status"><p><strong>Finish setting up.</strong> Add your details, circle and emergency contacts so help can reach you.</p><Link to="/welcome">Continue setup</Link></div>}
    <header className="safety-heading"><h1>{firstName ? `Hi ${firstName}` : 'Your safety'}</h1><p>Your safety at a glance. Report, check in, or reach your circle.</p></header>
    {message && <div className="safety-feedback" role="status">{message}{reference && <Toggle icon="tag" title="Report reference"><code>{reference}</code></Toggle>}</div>}
    <div className="safety-layout">
      <section className={'safety-panel safety-current level-' + (current?.level ?? 0)} aria-labelledby="status-title">
        <span className="safety-current-icon"><AccountIcon name="shield"/></span><h2 id="status-title">Current safety status</h2>
        {status.isError ? <button onClick={()=>void status.refetch()}>Retry loading status</button> : <><strong>{current?labels[current.level]:'Loading…'}</strong>
          <p>{current?.reportedAt ? `Reported ${date(current.reportedAt)}` : 'No reports yet'}</p></>}
        <div className="safety-current-foot">
          <button disabled={busy} onClick={()=>void submit({level:1,category:'welfare'})}>Confirm I’m safe</button>
          {current && current.level>=2 && <small>Checking in keeps your active incident open.</small>}
        </div>
      </section>
      <WelfareCard/>
      <Tools/>
      <form className="safety-panel safety-report" onSubmit={report} aria-labelledby="report-title">
        <h2 id="report-title">Report an incident</h2>
        <fieldset disabled={busy}><legend>Incident type</legend>
          <div className="safety-options">{levels.map(n=><label className="safety-choice" key={n}>
            <input type="radio" name="level" value={n} required checked={level===n} onChange={()=>setLevel(n)}/>
            <span>{labels[n]}</span></label>)}</div>
        </fieldset>
        <div className="safety-fields">
          <label>Incident category<select required disabled={busy} value={category} onChange={e=>setCategory(e.target.value)}>
            {categories.map(c=><option key={c} value={c}>{c[0].toUpperCase()+c.slice(1)}</option>)}</select></label>
          <label>Country code (optional)<input maxLength={2} pattern="[A-Za-z]{2}" placeholder="e.g. KE" autoCapitalize="characters" disabled={busy} value={country} onChange={e=>setCountry(e.target.value.toUpperCase())}/></label>
        </div>
        <label className="safety-note">What’s happening? (optional)<textarea rows={3} maxLength={1000} disabled={busy} value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. My employer has taken my passport and won’t let me leave."/>
          <small>{1000 - note.length} characters left · Shared with the responders handling your report.</small></label>
        <button className="safety-primary" type="submit" disabled={busy}>Submit incident report</button>
      </form>
      <section className="safety-panel safety-history" aria-labelledby="activity-title"><h2 id="activity-title">Recent activity</h2>
        {history.isError ? <button onClick={()=>void history.refetch()}>Retry loading activity</button> : history.isLoading ? <p>Loading activity…</p> : events.length ? <>
          <ul>{(showAll?events:events.slice(0,6)).map(event=><li key={event._id}><span className={'safety-dot level-'+event.level} aria-hidden="true"/>
            <span>{labels[event.level]}{event.level>=2 && <small>{event.active?'Open incident':'Resolved incident'}</small>}</span><time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ul>
          {events.length>6 && <button onClick={()=>setShowAll(!showAll)}>{showAll?'Show less':`Show all ${events.length}`}</button>}
        </> : <p>Your reports and check-ins will appear here.</p>}
      </section>
    </div>
  </section>;
}
