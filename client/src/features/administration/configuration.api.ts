import { tilcayoApi } from '../../app/api';
export type Value = Record<string, unknown>;
export type RecordData = {revision:number; value:Value};
export interface PlatformIncident {
  version?:number;
  signals:{action:string;at:string;actorName?:string}[];
  reference:string; category:string; level:number; createdAt:string; channel:'account'|'gateway';
  state:'pending'|'assigned'|'acknowledged'|'resolved'; organization:string|null;
  account:{name:string;email:string}|null;
}
export const configApi = tilcayoApi.injectEndpoints({endpoints: b => ({
  configuration:b.query<{data:RecordData|null},string>({query:path => '/sariel/'+path}),
  saveConfiguration:b.mutation<unknown,{path:string;body:RecordData}>({query:({path,body}) => ({url:'/sariel/'+path,method:'PUT',body})}),
  respondToIncident:b.mutation<unknown,{reference:string;version:number;action:'acknowledge'|'dispatch';confirmed?:true}>({
    query:({reference,...body})=>({url:'/platform/incidents/'+reference+'/response',method:'POST',body})
  }),
  platformIncidents:b.query<{data:{items:PlatformIncident[];hasNext:boolean;total:number;levels:Record<string,number>;groups:Record<string,number>}}, {page:number;search:string;level:number;group:string}>({
    query:params=>({url:'/platform/incidents',query:params}),
  }),
  trashActors:b.query<{data:Record<string,string>},{ids:string;kind:string}>({query:query=>({url:"/sariel/admin/trash/actors",query})}),
  audit:b.query<{data:{action:string;actorName:string;createdAt:string}[]},void>({query:() => '/sariel/admin/audit'}),
})});
