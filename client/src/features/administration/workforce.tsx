import { useState, type FormEvent } from 'react';
import { tilcayoApi } from '../../app/api';
import { useAuth } from '../../app/auth';
import { configApi } from './configuration.api';
import { Configuration } from './configuration';
import { useGetTenantMembersQuery } from '../tenancy/tenancy.api';
import { actionError } from '../admin/action-error';

const defaults=['Response manager','Response officer','Dispatcher','Welfare officer','Legal officer'].map(name=>({name,permissions:['Response manager','Dispatcher'].includes(name)?['scope.read','routing.read','incidents.respond','incidents.manage']:name==='Response officer'?['scope.read','routing.read','incidents.respond']:['scope.read']}));
const api=tilcayoApi.injectEndpoints({endpoints:b=>({
  invite:b.mutation<{data:{token:string}},{id:string;email:string;role:string}>({query:({id,...body})=>({url:'/sariel/admin/invitations/'+id,method:'POST',body})}),
  accept:b.mutation<unknown,string>({query:token=>({url:'/sariel/staff/accept',method:'POST',body:{token}})}),
  changeStaff:b.mutation<unknown,{id:string;member:string;role:string|null}>({query:({id,member,role})=>({url:'/sariel/admin/staff/'+id+'/'+member,method:'PUT',body:{role}})}),
  workspace:b.query<{data:Record<string,unknown>},string>({query:()=>'/sariel/staff/workspace'}),
})});
export function Workforce({id}:{id:string}){
  const [invite]=api.useInviteMutation(), [change]=api.useChangeStaffMutation();
  const members=useGetTenantMembersQuery(id);
  const {data}=configApi.useConfigurationQuery('admin/roles/'+id);
  const options=(data?.data?.value.roles as typeof defaults|undefined)??defaults;
  const [message,setMessage]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setMessage('');
    const form=new FormData(event.currentTarget),role=String(form.get('role')),member=String(form.get('member')??'');
    try {
      if(member){await change({id,member,role:role||null}).unwrap();await members.refetch();setMessage('Membership updated.');}
      else{const result=await invite({id,email:String(form.get('email')),role}).unwrap();setMessage('Share '+window.location.origin+'/staff/invitation and this one-day code with the recipient: '+result.data.token);}
    }catch(err){setMessage(actionError(err));}
  }
  return <><Configuration title="Staff roles" path={'admin/roles/'+id} initial={{roles:defaults}}/>
    <p>Permissions are scope.read, routing.read, incidents.respond and incidents.manage. Removing a role revokes its permissions.</p>
    <form className="tl-stack" onSubmit={submit}><h3>Invite staff</h3><label>Registered email<input className="tl-input" name="email" type="email" required/></label><label>Role<select className="tl-select" name="role">{options.map(o=><option key={o.name}>{o.name}</option>)}</select></label><button className="tl-btn tl-btn-primary">Create invitation</button></form>
    <form className="tl-stack" onSubmit={submit}><h3>Manage staff access</h3><label>Member<select className="tl-select" required name="member">{members.data?.data.filter(m=>!m.roles.includes('admin')).map(m=><option key={m.id} value={m.id}>{m.email}</option>)}</select></label><label>Access<select className="tl-select" name="role"><option value="">Suspend membership</option>{options.map(o=><option key={o.name}>{o.name}</option>)}</select></label><button className="tl-btn tl-btn-primary">Update access</button></form><p role="status">{message}</p>
  </>;
}
export function RoutingSettings({id}:{id:string}){
  return <><Configuration title="Routing configuration" path={'admin/routing/'+id} initial={{rules:[]}}/>
    <details><summary>Example routing rule</summary><p>Use a JSON list. Referral targets use the workspace ID shown below.</p><code>{JSON.stringify([{name:'Welfare assistance',priority:1,countries:['KE'],nationalities:['KE'],incidentCategories:['welfare'],capabilities:['welfare'],severities:['high'],availableOnly:true,referralTenantIds:[],authorization:'explicit-consent',disclose:['category']}])}</code><p>Workspace ID {id}</p></details></>;
}
export function StaffPanel(){
  const {user}=useAuth();

  const workspace=api.useWorkspaceQuery((user?.tenant?.id??'')+'/'+user?.id,{skip:!user?.tenant});
  return <section className="account-card"><h2>Workspace permissions</h2>{workspace.isError?<p>Workspace configuration is unavailable for this account.</p>:<pre>{JSON.stringify(workspace.currentData?.data,null,2)}</pre>}</section>;
}
export function InvitationPage(){
  const [accept]=api.useAcceptMutation(),[message,setMessage]=useState('');
  return <form className="account-card tl-stack" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;try{await accept(String(new FormData(form).get('token'))).unwrap();form.reset();setMessage('Invitation accepted. Sign in on the organization subdomain.');}catch(err){setMessage(actionError(err));}}}><h1>Accept staff invitation</h1><label>Invitation code<input className="tl-input" required name="token" pattern="[a-f0-9]{64}"/></label><button className="tl-btn tl-btn-primary">Accept invitation</button><p role="status">{message}</p></form>;
}
