import { randomUUID } from 'node:crypto';
import { Tenant } from '@tilcayo/auth';
import { Config, profile } from '../administration/config.js';
import { routing } from '../administration/policies.js';
import { profiles } from '../individual/profile.js';
import type { StatusEvent } from '../individual/status.js';

export type AuditEntry={at:Date; action:string; tenant?:string; actor?:string; note?:string};
export type Incident={
  handle:string; state:'pending'|'assigned'|'acknowledged'|'resolved'; tenant:string|null; officer:string|null;
  rule:string|null; audit:AuditEntry[]; version:number;
};
export const severity=(level:number)=>['low','moderate','high','critical'][level-2];
export async function eligible(event:StatusEvent, onlyTenant?:string){
  const personal=await profiles().findOne({_id:event.owner});
  const country=event.country??personal?.information.residence;
  const nationality=personal?.information.nationality;
  if(!country) return [];
  const orgs=await Tenant.where({status:'active',deletedAt:null,...(onlyTenant?{_id:onlyTenant}:{})});
  const matches=[];
  for(const org of orgs){
    const tenant=String(org._id);
    const [a,b]=await Promise.all([Config.findById('organization/'+tenant),Config.findById('routing/'+tenant)]);
    const scope=profile.safeParse(a?.value);
    const rules=routing.safeParse(b?.value);
    if(!scope.success||!rules.success||scope.data.verification!=='verified'||!scope.data.available
      ||!scope.data.countries.includes(country)||!scope.data.incidentCategories.includes(event.category)) continue;
    for(const rule of rules.data.rules){
      if(!rule.countries.includes(country)||!rule.incidentCategories.includes(event.category)
        ||!rule.severities.some(s=>s===severity(event.level))
        ||rule.capabilities.some(c=>!scope.data.capabilities.includes(c))
        ||(rule.nationalities.length && !rule.nationalities.some(n=>n===nationality))
        ||(rule.authorization==='explicit-consent' && !personal?.disclosure.some(d=>d.tenantId===tenant))) continue;
      matches.push({tenant,rule,country});
    }
  }
  return matches.sort((a,b)=>a.rule.priority-b.rule.priority || a.tenant.localeCompare(b.tenant));
}
export function pendingIncident(event:StatusEvent):Incident {
  return {handle:randomUUID(),state:'pending',tenant:null,officer:null,rule:null,version:0,
    audit:[{at:event.createdAt,action:'created'}]};
}

export async function initialIncident(event:StatusEvent):Promise<Incident>{
  const incident=event.incident??pendingIncident(event);
  const [match]=await eligible(event);
  if(!match) return incident;
  return {...incident,state:'assigned',tenant:match.tenant,rule:match.rule.name,
    audit:[...incident.audit,{at:new Date(),action:'routed',tenant:match.tenant}]};
}
