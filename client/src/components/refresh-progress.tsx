import { useSelector } from 'react-redux';
import { auth } from '../app/auth';
import type { RootState } from '../app/store';
export function RefreshProgress() {
  const pending=useSelector((state:RootState)=>{
    const api=state[auth.api.reducerPath as keyof RootState] as unknown as {queries?:Record<string,{status?:string}|undefined>};
    return Object.values(api?.queries??{}).some(query=>query?.status==='pending');
  });
  return pending?<div className="refresh-progress" role="status" aria-label="Updating content"/>:null;
}
