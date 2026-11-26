import { useState } from 'react';
import { configApi, type Value, type RecordData } from './configuration.api';
import { actionError } from '../admin/action-error';

export function Configuration({path,title,initial,choices={}}:{path:string;title:string;initial:Value;choices?:Record<string,string[]>}) {
  const result = configApi.useConfigurationQuery(path);
  if (result.isError) return <p role="alert">Unable to load {title}.</p>;
  if (!result.currentData) return <p>Loading {title}…</p>;
  const record = result.currentData.data ?? {revision:0,value:initial};
  return <Editor key={path+':'+record.revision} {...{path,title,record,choices}} reload={result.refetch}/>;
}
function Editor({path,title,record,choices,reload}:{path:string;title:string;record:RecordData;choices:Record<string,string[]>;reload:()=>unknown}) {
  const [fields,setFields] = useState(Object.fromEntries(Object.entries(record.value).map(([k,v])=>[k,typeof v==='string'?v:JSON.stringify(v)])));
  const [save,state] = configApi.useSaveConfigurationMutation();
  const [error,setError] = useState('');
  return <form className="tl-stack account-card" onSubmit={async e=>{
    e.preventDefault();
    try {
      const value=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,typeof record.value[k]==='string'?v:JSON.parse(v)]));
      await save({path,body:{revision:record.revision,value}}).unwrap(); reload();
    } catch(err){setError(err instanceof SyntaxError?'Check the JSON list format.':actionError(err));}
  }}><h2>{title}</h2>{Object.entries(fields).map(([key,value])=>{
    const options=choices[key] ?? (typeof record.value[key]==='boolean'?['true','false']:undefined);
    const props={className:'tl-input',value,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>)=>setFields({...fields,[key]:e.target.value})};
    return <label key={key}>{key.replace(/[A-Z]/g,c=>' '+c.toLowerCase())}{options?<select {...props}>{options.map(o=><option key={o}>{o}</option>)}</select>:Array.isArray(record.value[key])?<textarea {...props} rows={3} aria-description="Enter a JSON list"/>:<input {...props} required/>}</label>;
  })}{error&&<p role="alert">{error}</p>}<button className="tl-btn tl-btn-primary" disabled={state.isLoading}>Save {title.toLowerCase()}</button><small>Saved revision {record.revision}</small></form>;
}
export function PlatformSettings(){
  return <Configuration path="admin/platform" title="Platform settings" initial={{platformName:'SARIEL',supportEmail:'support@example.test',defaultLanguage:'English'}}/>;
}
export function AuditPage(){
  const audit = configApi.useAuditQuery();
  return <section className="sariel-audit"><header><h1>Audit log</h1><button className="tl-btn tl-btn-outline" onClick={() => audit.refetch()}>Refresh</button></header>
    {audit.isError ? <p role="alert">Unable to load activity.</p> : audit.isLoading ? <p>Loading activity…</p> : audit.data?.data.length ?
      <table><thead><tr><th>Time</th><th>Action</th><th>Performed by</th></tr></thead><tbody>
        {audit.data.data.map((entry,i) => <tr key={i}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.action}</td><td>{entry.actorName}</td></tr>)}
      </tbody></table> : <p>No activity recorded yet.</p>}
  </section>;
}
export function OrganizationSettings({id}:{id:string}){
  return <Configuration path={'admin/organization/'+id} title="Organization scope" initial={{category:'Government',verification:'pending',countries:['KE'],jurisdictions:['Kenya'],incidentCategories:['welfare'],capabilities:['welfare'],officialEmail:'',officialPhone:'',operatingHours:'',timeZone:'Africa/Nairobi',available:false,preferredLanguage:'English'}} choices={{category:['Government','Diplomatic mission','Law enforcement','Labour regulator','Humanitarian','GBV support','Legal aid'],verification:['pending','verified','rejected']}}/>;
}
