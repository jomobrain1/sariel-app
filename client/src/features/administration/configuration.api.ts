import { tilcayoApi } from '../../app/api';
export type Value = Record<string, unknown>;
export type RecordData = {revision:number; value:Value};
export const configApi = tilcayoApi.injectEndpoints({endpoints: b => ({
  configuration:b.query<{data:RecordData|null},string>({query:path => '/sariel/'+path}),
  saveConfiguration:b.mutation<unknown,{path:string;body:RecordData}>({query:({path,body}) => ({url:'/sariel/'+path,method:'PUT',body})}),
  audit:b.query<{data:{action:string;actorId:string;createdAt:string}[]},void>({query:() => '/sariel/admin/audit'}),
})});
