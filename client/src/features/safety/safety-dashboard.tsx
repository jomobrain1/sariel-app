import { useRef, useState, type FormEvent } from 'react';
import { AccountIcon } from '../../components/account-icon';
import { labels, safetyApi, type Update } from './safety.api';
import './safety-dashboard.css';
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
  return <details className="safety-panel safety-link"><summary><span className="safety-link-icon"><AccountIcon name="link"/></span><span>One-tap incident link</span><AccountIcon name="arrow"/></summary>
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
  </details>;
}

export function SafetyDashboard({accountId}:{accountId:string}) {
  const status = safetyApi.useSafetyStatusQuery(accountId,{refetchOnMountOrArgChange:true});
  const history = safetyApi.useSafetyHistoryQuery(accountId,{refetchOnMountOrArgChange:true});
  const [send] = safetyApi.useSubmitSafetyUpdateMutation();
  const dispatch = useAppDispatch();
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
      // A safe check-in also resets scheduled welfare check-ins.
      if (value.level === 1) dispatch(welfareApi.util.invalidateTags(['Welfare']));
    } catch {
      setMessage('Submission unconfirmed. Check your connection and retry with the same details.');
    } finally { pending.current = false; setBusy(false); }
  }
  function report(e:FormEvent){
    e.preventDefault();
    if(level !== undefined) void submit({level,category:category.trim(),country:country.trim().toUpperCase() || undefined});
  }

  return <section className="safety-dashboard">
    <h1 className="safety-sr-only">My safety dashboard</h1>
    {message && <div className="safety-feedback" role="status">{message}{reference && <details><summary>Report reference</summary><code>{reference}</code></details>}</div>}
    <div className="safety-grid">
      <form className="safety-panel safety-report" onSubmit={report}>
        <h2>Report an incident</h2>
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
        <button className="safety-primary" type="submit" disabled={busy}>Submit incident report</button>
      </form>
      <div className="safety-side">
        <section className="safety-panel safety-current">
          <span className="safety-current-icon"><AccountIcon name="shield"/></span><h2>Current safety status</h2>
          {status.isError ? <button onClick={()=>void status.refetch()}>Retry loading status</button> : <><strong>{current?labels[current.level]:'Loading…'}</strong>
            {current?.reportedAt && <p>Reported {date(current.reportedAt)}</p>}</>}
          <button disabled={busy} onClick={()=>void submit({level:1,category:'welfare'})}>Confirm I’m safe</button>
          {current && current.level>=2 && <small>Checking in keeps your active incident open.</small>}
        </section>
        <WelfareCard/>
        <IncidentLink/>
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
