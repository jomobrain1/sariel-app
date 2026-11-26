import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@tilcayo/ui';
import { AccountMenu } from '../../components/account-menu';
import { AccountIcon } from '../../components/account-icon';
import { labels, safetyApi } from '../safety/safety.api';
import { configApi, type PlatformIncident } from './configuration.api';
import './incidents.css';

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
  'gallery-road':'Help still needed','gallery-bridge':'Situation worsening','gallery-mountain':'Immediate danger',
  acknowledge:'Report acknowledged',dispatch:'Dispatch confirmed'
};
function ResponsePanel({item,refresh}:{item:PlatformIncident;refresh:()=>Promise<unknown>}){
  const [send,result]=configApi.useRespondToIncidentMutation();
  const [confirmed,setConfirmed]=useState(false);
  const seen=item.signals.some(s=>s.action==='acknowledge');
  const dispatched=item.signals.some(s=>s.action==='dispatch');
  async function respond(){
    if(item.version===undefined)return;
    try{
      await send({reference:item.reference,version:item.version,...(seen?{action:'dispatch' as const,confirmed:true as const}:{action:'acknowledge' as const})}).unwrap();
    }catch{/* Display the mutation error below and refresh concurrent updates. */}
    await refresh();
    setConfirmed(false);
  }
  return <section className="incident-response"><h3>Response timeline</h3>
    {item.signals.length ? <ol>{item.signals.map((s,i)=><li key={i}><strong>{signalLabels[s.action]}</strong><small>{s.actorName || (s.action.startsWith('gallery-')?'Reporting link':'Responder')} · {timestamp.format(new Date(s.at))}</small></li>)}</ol> : <p>Awaiting a response.</p>}
    {item.state!=='resolved' && !dispatched && item.version!==undefined && <>
      {seen && <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I have confirmed a responder is on the way.</label>}
      <button className="incident-primary" disabled={result.isLoading || (seen && !confirmed)} onClick={()=>void respond()}>{seen?'Confirm dispatch':'Acknowledge report'}</button></>}
    {result.isError && <p role="alert">Response could not be saved. Review the latest incident and try again.</p>}
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
    <Modal open={creating} title="New incident" onClose={()=>setCreating(false)}>{creating && <CreateIncident done={()=>{setCreating(false);setNotice('Incident recorded.');setDraft('');setSearch('');setGroup('all');chooseLevel(0);void query.refetch();}}/>}</Modal>
    <Modal open={!!selected} title={selected?labels[selected.level]:'Incident details'} onClose={()=>select(null)}>{selected && <><dl className="incident-detail">
      {Object.entries({'Account holder':selected.account?.name??'Unavailable',Email:selected.account?.email??'Unavailable',Organization:selected.organization??'Unassigned',Category:selected.category,Status:selected.state,'Reported via':selected.channel==='gateway'?'Reporting link':'Signed-in account','Date reported':timestamp.format(new Date(selected.createdAt)),Reference:selected.reference}).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><ResponsePanel key={selected.reference} item={selected} refresh={()=>query.refetch()}/></>}</Modal>
  </section>;
}
