import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@tilcayo/ui';
import { AccountMenu } from '../../components/account-menu';
import { AccountIcon } from '../../components/account-icon';
import { labels, safetyApi } from '../safety/safety.api';
import { configApi, type PlatformIncident } from './configuration.api';
import './incidents.css';
import { visibleProgress } from '../../lib/visible-progress';
import { toast } from '../../lib/toast';

const priorities = [{level:5,name:'Critical'},{level:4,name:'High'},{level:3,name:'Medium'},{level:2,name:'Low'}];
const groups = [{key:'all',name:'All incidents'},{key:'open',name:'Open'},{key:'progress',name:'In progress'},{key:'resolved',name:'Resolved'}];
const timestamp = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});

function CreateIncident({done}:{done:()=>void}) {
  const [send, state] = safetyApi.useSubmitSafetyUpdateMutation();
  const [requestId,setRequestId] = useState(()=>crypto.randomUUID());
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await send({level:Number(form.get('level')),category:String(form.get('category')).trim(),
        country:String(form.get('country')).trim().toUpperCase() || undefined,requestId}).unwrap();
      done();
    } catch { /* The form retains the request ID and displays the mutation error. */ }
  }
  return <form className="incident-form" onSubmit={submit} onChange={()=>setRequestId(crypto.randomUUID())}>
    <p>This report will be recorded under your signed-in account.</p>
    <label>Severity<select required name="level" defaultValue=""><option value="" disabled>Select severity</option>{priorities.map(p=><option value={p.level} key={p.level}>{labels[p.level]}</option>)}</select></label>
    <label>Category<input name="category" required maxLength={120} defaultValue="welfare"/></label>
    <label>Country code (optional)<input name="country" pattern="[a-zA-Z]{2}" maxLength={2} placeholder="KE"/></label>
    {state.isError && <p role="alert">Submission unconfirmed. Check the details and try again.</p>}
    <button className="incident-primary" disabled={state.isLoading}>{state.isLoading?'Submitting…':'Create incident'}</button>
  </form>;
}

const signalLabels:Record<string,string>={
  'gallery-road':'Help still needed','photo-link-spread':'Report link opened by 3+ people','gallery-bridge':'Situation worsening','gallery-mountain':'Immediate danger',
  acknowledge:'Report acknowledged',dispatch:'Dispatch confirmed',contact:'Person contacted',note:'Note added',refer:'Referred',resolve:'Resolved'
};
type Command={action:'acknowledge'}|{action:'dispatch';confirmed:true}|{action:'contact';note?:string}|{action:'note';note:string}|{action:'resolve';note:string};
// Where the person was: sent with the report, or their last shared point. Superadmins always see it.
function IncidentLocation({location}:{location:NonNullable<PlatformIncident['location']>}){
  const at=location.latitude.toFixed(5)+','+location.longitude.toFixed(5);
  return <span className="incident-location"><a href={'https://maps.google.com/?q='+at} target="_blank" rel="noreferrer">Open in Maps ↗</a>
    <small>{location.source==='report'?'Sent with the report':'Last shared location'} · {timestamp.format(new Date(location.recordedAt))} · within {Math.round(location.accuracy)} m</small></span>;
}
const savedLabels:Record<Command['action'],string>={acknowledge:'Report acknowledged.',contact:'Saved: person contacted.',dispatch:'Dispatch confirmed.',note:'Note added.',resolve:'Incident resolved.'};
function ResponsePanel({item,refresh}:{item:PlatformIncident;refresh:()=>Promise<unknown>}){
  const [send,result]=configApi.useRespondToIncidentMutation();
  const [confirmed,setConfirmed]=useState(false);
  const [note,setNote]=useState('');
  const seen=item.signals.some(s=>s.action==='acknowledge');
  const dispatched=item.signals.some(s=>s.action==='dispatch');
  const open=item.state!=='resolved' && item.version!==undefined;
  const text=note.trim();
  // Which action is running: its button shows progress and every action stays locked until the timeline refreshes.
  const [busy,setBusy]=useState<Command['action']>();
  const [saved,setSaved]=useState('');
  async function run(command:Command){
    if(item.version===undefined || busy)return;
    setBusy(command.action); setSaved('');
    try{
      const result=await visibleProgress(send({reference:item.reference,version:item.version,...command}).unwrap());
      const others=(result as {data?:{alsoClosed?:number}}|null)?.data?.alsoClosed ?? 0;
      setNote(''); setConfirmed(false);
      const done=savedLabels[command.action]+(others ? ` ${others} other open report${others>1?'s':''} from this person ${others>1?'were':'was'} closed too.` : '');
      setSaved(done); toast.success(done);
    }
    catch{ toast.error('The action couldn’t be saved. The incident may have changed; review it and try again.'); }
    try{ await refresh(); } finally { setBusy(undefined); }
  }
  const label=(action:Command['action'],text:string)=>busy===action?<><span className="incident-spinner" aria-hidden="true"/>Saving…</>:text;
  const actorOf=(s:PlatformIncident['signals'][number])=>s.actorName || (s.action.startsWith('gallery-')||s.action==='photo-link-spread'?'Reporting link':'Responder');
  return <section className="incident-response"><h3>Response timeline</h3>
    {item.signals.length ? <ol>{item.signals.map((s,i)=><li key={i}><strong>{signalLabels[s.action]??s.action}</strong>{s.note && <p>{s.note}</p>}<small>{actorOf(s)} · {timestamp.format(new Date(s.at))}</small></li>)}</ol> : <p>Awaiting a response.</p>}
    {open && <div className="incident-act">
      <h3>Actions</h3>
      <div className="incident-act-row">
        {!seen && <button className="incident-primary" disabled={!!busy} aria-busy={busy==='acknowledge'} onClick={()=>void run({action:'acknowledge'})}>{label('acknowledge','Acknowledge report')}</button>}
        <button className="incident-secondary" disabled={!!busy} aria-busy={busy==='contact'} onClick={()=>void run({action:'contact',...(text?{note:text}:{})})}>{label('contact','Person contacted')}</button>
      </div>
      {seen && !dispatched && <div className="incident-act-row">
        <label className="incident-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> A responder is on the way</label>
        <button className="incident-primary" disabled={!!busy || !confirmed} aria-busy={busy==='dispatch'} onClick={()=>void run({action:'dispatch',confirmed:true})}>{label('dispatch','Confirm dispatch')}</button></div>}
      <label className="incident-note">Note<textarea rows={3} maxLength={1500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Who you spoke to, what was done, what happens next…"/></label>
      <div className="incident-act-row">
        <button className="incident-secondary" disabled={!!busy || !text} aria-busy={busy==='note'} onClick={()=>void run({action:'note',note:text})}>{label('note','Add note')}</button>
        <button className="incident-resolve" title="Closes all of this person’s open incidents" disabled={!!busy || !text} aria-busy={busy==='resolve'} onClick={()=>{ if(confirm('Resolve this incident? This also closes any other open incidents from this person, so their status returns to Confirmed safe.')) void run({action:'resolve',note:text}); }}>{label('resolve','Resolve with note')}</button>
      </div>
      <small>Write a note first to resolve. “Person contacted” saves the note with it if you write one.</small>
    </div>}
    {saved && !busy && !result.isError && <p className="incident-saved" role="status">✓ {saved}</p>}
    {result.isError && !busy && <p role="alert">The action couldn’t be saved. The incident may have changed; review it and try again.</p>}
  </section>;
}
export function PlatformIncidents(){
  const [page,setPage]=useState(1), [draft,setDraft]=useState(''), [search,setSearch]=useState('');
  const [group,setGroup]=useState('all'), [level,setLevel]=useState(0), [filters,setFilters]=useState(false);
  const [creating,setCreating]=useState(false), [snapshot,select]=useState<PlatformIncident|null>(null);
  const [notice,setNotice]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(draft.trim());setPage(1);},250);return ()=>clearTimeout(timer);},[draft]);
  const query=configApi.usePlatformIncidentsQuery({page,search,level,group},{refetchOnMountOrArgChange:true,pollingInterval:15000});
  const data=query.currentData?.data;
  const selected=data?.items.find(item=>item.reference===snapshot?.reference)??snapshot;
  function chooseLevel(value:number){setLevel(value);setPage(1);}
  return <section className="incident-register" aria-label="Incidents">
    <header className="register-head"><div><h1>Incidents</h1><p>Track and review reported incidents.</p></div>
      <label className="register-search"><AccountIcon name="search"/><input type="search" aria-label="Search incidents by account, category, organization or reference" placeholder="Search incidents…" maxLength={100} value={draft} onChange={e=>setDraft(e.target.value)}/></label>
      <AccountMenu platform/>
    </header>
    <div className="register-metrics">{priorities.map(p=><button key={p.level} type="button" className={'priority-'+p.level} aria-pressed={level===p.level} onClick={()=>chooseLevel(level===p.level?0:p.level)}>
      <strong>{data ? data.levels[p.level]??0 : '—'}</strong><span>{p.name}</span></button>)}</div>
    <section className="register-panel" aria-label="Incident directory">
      <header className="register-tools"><div className="register-tabs" role="group" aria-label="Incident status">
        {groups.map(g=><button key={g.key} aria-pressed={group===g.key} onClick={()=>{setGroup(g.key);setPage(1);}}>{g.name}{g.key!=='all' && data && ' ('+(data.groups[g.key]??0)+')'}</button>)}</div>
        <div className="register-actions"><button className="incident-secondary" aria-expanded={filters} onClick={()=>setFilters(!filters)}><AccountIcon name="filter"/>Filters{level?' · 1':''}</button>
        <button className="incident-primary" onClick={()=>{setNotice('');setCreating(true);}}><span aria-hidden="true">＋</span> New incident</button></div>
      </header>
      {filters && <div className="register-filter"><label>Severity <select value={level} onChange={e=>chooseLevel(Number(e.target.value))}><option value={0}>All severities</option>{priorities.map(p=><option key={p.level} value={p.level}>{p.name}</option>)}</select></label></div>}
      {notice && <p className="register-message" role="status">{notice}</p>}
      {query.isError ? <div className="register-message" role="alert">Couldn’t load incidents. <button onClick={()=>void query.refetch()}>Retry</button></div> :
      !data ? <p className="register-message" role="status">Loading incidents…</p> :
      <><table className="register-table"><thead><tr>{['Incident','Account holder','Category','Severity','Status','Date reported','Actions'].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead>
        <tbody>{data.items.map(item=><tr key={item.reference}>
          <td className="register-name"><button onClick={()=>select(item)}><span className={'register-glyph priority-'+item.level}><AccountIcon name="shield"/></span>{labels[item.level]}</button></td>
          <td data-label="Account holder"><span className="register-cell"><AccountIcon name="user"/>{item.account?.name??'Account unavailable'}</span></td>
          <td data-label="Category"><span className="register-cell"><AccountIcon name="tag"/>{item.category}</span></td>
          <td data-label="Severity"><span className={'register-pill priority-'+item.level}>Level {item.level}</span></td>
          <td data-label="Status"><span className={'register-pill status-'+item.state}>{item.state}</span></td>
          <td data-label="Date reported"><time dateTime={item.createdAt}>{timestamp.format(new Date(item.createdAt))}</time></td>
          <td className="register-more"><button aria-label={'View '+labels[item.level]+' details'} onClick={()=>select(item)}>•••</button></td>
        </tr>)}</tbody></table>
        {!data.items.length && <p className="register-message">No incidents match this view.</p>}</>}
      <footer className="register-footer"><span>{data && (data.total ? 'Showing '+((page-1)*25+1)+'–'+Math.min(page*25,data.total)+' of '+data.total : '0 incidents')}</span>
        <nav aria-label="Incident pagination"><button aria-label="Previous page" disabled={page===1} onClick={()=>setPage(page-1)}>‹</button><b aria-current="page">{page}</b>
          <button aria-label="Next page" disabled={!data?.hasNext} onClick={()=>setPage(page+1)}>›</button></nav></footer>
    </section>
    <Modal open={creating} title="New incident" onClose={()=>setCreating(false)}>{creating && <CreateIncident done={()=>{setCreating(false);setNotice('Incident recorded.');toast.success('Incident recorded.');setDraft('');setSearch('');setGroup('all');chooseLevel(0);void query.refetch();}}/>}</Modal>
    <Modal open={!!selected} title={selected?labels[selected.level]:'Incident details'} onClose={()=>select(null)}>{selected && <><dl className="incident-detail">
      {Object.entries({'Account holder':selected.account?.name??'Unavailable',Email:selected.account?.email??'Unavailable',Organization:selected.organization??'Unassigned',Category:selected.category,...(selected.note?{Description:selected.note}:{}),...(selected.location?{Location:<IncidentLocation location={selected.location}/>}:{}),Status:selected.state,'Reported via':selected.channel==='gateway'?'Reporting link':selected.channel==='welfare'?'Missed check-in escalation':selected.channel==='image'?'Report photo':'Signed-in account','Date reported':timestamp.format(new Date(selected.createdAt)),Reference:selected.reference}).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><ResponsePanel key={selected.reference} item={selected} refresh={()=>query.refetch()}/></>}</Modal>
  </section>;
}
