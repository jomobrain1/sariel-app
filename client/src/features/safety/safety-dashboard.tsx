import { useRef, useState, type FormEvent } from 'react';
import { AccountIcon } from '../../components/account-icon';
import { labels, safetyApi, type Update } from './safety.api';
import './safety-dashboard.css';

const levels = [2, 3, 4, 5];
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
  return <details className="safety-panel safety-link"><summary>One-tap incident link</summary>
    <p>Anyone who knows or guesses this name can open the link and report for your account. Each link creates one incident and expires after 24 hours. A new link replaces your previous one.</p>
    <p>Opening the gallery sends your preset report. Tap the road to repeat your request, the bridge if things worsen, or the mountain for immediate danger. Each tap updates the same incident.</p>
    <p>A sunrise means someone has seen your report. A sailboat means a responder confirmed help was dispatched. A valley means you have no confirmed response. Browser history may show the visit.</p>
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
  </details>;
}

function PersonalLink() {
  const [issue, result] = safetyApi.useIssueReportLinkMutation();
  return <details className="safety-panel safety-link" onToggle={e => { if (!e.currentTarget.open) result.reset(); }}>
    <summary>Personal reporting link</summary>
    <p>Use this link and a private safety code to report from another device. Generating a link replaces all previous codes.</p>
    {result.data ? <>
      <label>Reporting link<input readOnly value={new URL(result.data.data.reportUrl, location.origin).href} onFocus={e=>e.target.select()}/></label>
      {result.data.data.codes.map(code=><label key={code.level}>{labels[code.level]}<input readOnly value={code.secret} onFocus={e=>e.target.select()}/></label>)}
      <button type="button" onClick={result.reset}>Hide private codes</button>
    </> : <button type="button" disabled={result.isLoading} onClick={()=>void issue()}>Generate new link and codes</button>}
    {result.isError && <p role="alert">Couldn’t generate the link. Try again.</p>}
  </details>;
}

export function SafetyDashboard({accountId}:{accountId:string}) {
  const status = safetyApi.useSafetyStatusQuery(accountId,{refetchOnMountOrArgChange:true});
  const history = safetyApi.useSafetyHistoryQuery(accountId,{refetchOnMountOrArgChange:true});
  const [send] = safetyApi.useSubmitSafetyUpdateMutation();
  const [level,setLevel] = useState<number>();
  const [category,setCategory] = useState('welfare');
  const [country,setCountry] = useState('');
  const [busy,setBusy] = useState(false);
  const pending = useRef(false);
  const last = useRef<Update | null>(null);
  const [message,setMessage] = useState('');
  const [reference,setReference] = useState('');
  const [showAll,setShowAll] = useState(false);
  const current = status.currentData?.data;
  const events = history.currentData?.data ?? [];

  async function submit(value: Pick<Update,'level'|'country'|'category'>){
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setMessage(''); setReference('');
    try {
      const previous = last.current;
      if (!previous || previous.level !== value.level || previous.country !== value.country || previous.category !== value.category)
        last.current = {...value, requestId:crypto.randomUUID()};
      const response = await send(last.current!).unwrap();
      last.current = null;
      if(value.level === 1) setMessage('Safe check-in recorded.');
      else {
        setMessage('Incident report recorded.');
        setReference(response.data.reference);
        setLevel(undefined); setCountry(''); setCategory('welfare');
      }
      void status.refetch(); void history.refetch();
    } catch {
      setMessage('Submission unconfirmed. Check your connection and retry with the same details.');
    } finally { pending.current = false; setBusy(false); }
  }
  function report(e:FormEvent){
    e.preventDefault();
    if(level !== undefined) void submit({level,category:category.trim(),country:country.trim().toUpperCase() || undefined});
  }

  return <section className="safety-dashboard">
    <header className="safety-heading"><h1>My safety dashboard</h1></header>
    {message && <div className="safety-feedback" role="status">{message}{reference && <details><summary>Report reference</summary><code>{reference}</code></details>}</div>}
    <div className="safety-grid">
      <form className="safety-panel safety-report" onSubmit={report}>
        <h2>Report an incident</h2>
        <fieldset disabled={busy}><legend>What level of help do you need?</legend>
          <div className="safety-options">{levels.map(n=><label className="safety-choice" key={n}>
            <input type="radio" name="level" value={n} required checked={level===n} onChange={()=>setLevel(n)}/>
            <span>{labels[n]}</span></label>)}</div>
        </fieldset>
        <div className="safety-fields">
          <label>Incident category<input required maxLength={120} pattern=".*\S.*" list="safety-categories" disabled={busy} value={category} onChange={e=>setCategory(e.target.value)}/></label>
          <datalist id="safety-categories"><option value="welfare"/><option value="medical"/><option value="harassment"/><option value="labour exploitation"/></datalist>
          <label>Country code (optional)<input maxLength={2} pattern="[A-Za-z]{2}" placeholder="e.g. KE" autoCapitalize="characters" disabled={busy} value={country} onChange={e=>setCountry(e.target.value.toUpperCase())}/></label>
        </div>
        <button className="safety-primary" type="submit" disabled={busy}>Submit incident report</button>
      </form>
      <div className="safety-side">
        <section className="safety-panel safety-current">
          <AccountIcon name="shield"/><h2>Current safety status</h2>
          {status.isError ? <button onClick={()=>void status.refetch()}>Retry loading status</button> : <><strong>{current?labels[current.level]:'Loading…'}</strong>
            {current?.reportedAt && <p>Reported {date(current.reportedAt)}</p>}</>}
          <button disabled={busy} onClick={()=>void submit({level:1,category:'welfare'})}>Confirm I’m safe</button>
          {current && current.level>=2 && <small>Checking in keeps your active incident open.</small>}
        </section>
        <IncidentLink/>
        <PersonalLink/>
      </div>
    </div>
    <section className="safety-panel safety-history"><h2>Recent safety activity</h2>
      {history.isError ? <button onClick={()=>void history.refetch()}>Retry loading activity</button> : history.isLoading ? <p>Loading activity…</p> : events.length ? <>
        <ul>{(showAll?events:events.slice(0,5)).map(event=><li key={event._id}><span>{labels[event.level]}{event.level>=2 && <small>{event.active?'Open incident':'Resolved incident'}</small>}</span><time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ul>
        {events.length>5 && <button onClick={()=>setShowAll(!showAll)}>{showAll?'Show less':'Show more'}</button>}
      </> : <p>Your reports and check-ins will appear here.</p>}
    </section>
  </section>;
}
