import { useState } from 'react';
import { tilcayoApi } from '../../app/api';
import { actionError } from '../admin/action-error';

type Value = Record<string, unknown>;
type RecordData = {revision:number; value:Value};
export const configApi = tilcayoApi.injectEndpoints({endpoints: b => ({
  configuration:b.query<{data:RecordData|null},string>({query:path => '/sariel/'+path}),
  saveConfiguration:b.mutation<unknown,{path:string;body:RecordData}>({query:({path,body}) => ({url:'/sariel/'+path,method:'PUT',body})}),
  audit:b.query<{data:{action:string;actorId:string;createdAt:string}[]},void>({query:() => '/sariel/admin/audit'}),
})});
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
  const audit=configApi.useAuditQuery();
  return <><Configuration path="admin/platform" title="Platform settings" initial={{platformName:'SARIEL',supportEmail:'support@example.test',defaultLanguage:'English'}}/>
    <details><summary>Recent administration activity</summary><button onClick={()=>audit.refetch()}>Refresh activity</button>{audit.isError&&<p>Unable to load activity.</p>}<ol>{audit.data?.data.map((e,i)=><li key={i}>{new Date(e.createdAt).toLocaleString()} · {e.action} · {e.actorId}</li>)}</ol></details></>;
}
export function OrganizationSettings({id}:{id:string}){
  return <Configuration path={'admin/organization/'+id} title="Organization scope" initial={{category:'Government',verification:'pending',countries:['KE'],jurisdictions:['Kenya'],incidentCategories:['welfare'],capabilities:['welfare'],officialEmail:'',officialPhone:'',operatingHours:'',timeZone:'Africa/Nairobi',available:false,preferredLanguage:'English'}} choices={{category:['Government','Diplomatic mission','Law enforcement','Labour regulator','Humanitarian','GBV support','Legal aid'],verification:['pending','verified','rejected']}}/>;
}
