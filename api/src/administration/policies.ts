import { z } from 'zod';
import { country, id, label, labels } from './config.js';

export const permissions = z.enum(['scope.read','routing.read','incidents.respond','incidents.manage']);
export const role = z.strictObject({name:label, permissions:z.array(permissions).max(4)});
export const defaults = ['Response manager','Response officer','Dispatcher','Welfare officer','Legal officer'].map(name=>({
  name, permissions:name==='Response manager' || name==='Dispatcher' ? ['scope.read','routing.read','incidents.respond','incidents.manage'] : name==='Response officer' ? ['scope.read','routing.read','incidents.respond'] : ['scope.read'],
}));
export const roles = z.strictObject({roles:z.array(role).max(50).refine(list=>new Set(list.map(item=>item.name.toLowerCase())).size===list.length,'Role names must be unique')});
const rule = z.strictObject({
  name:label, priority:z.number().int().min(1).max(1000), countries:z.array(country).min(1), nationalities:z.array(country),
  incidentCategories:labels.min(1), capabilities:labels.min(1), severities:z.array(z.enum(['low','moderate','high','critical'])).min(1),
  availableOnly:z.literal(true), referralTenantIds:z.array(id).max(20),
  authorization:z.enum(['explicit-consent','authorized-responder']), disclose:z.array(z.enum(['category','severity','country','incident-reference'])).max(4),
});
export const routing=z.strictObject({rules:z.array(rule).max(100).refine(list=>new Set(list.map(r=>r.priority)).size===list.length,'Priorities must be unique')});
