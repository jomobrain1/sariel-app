import { useEffect } from 'react';
import { useAuth } from '../app/auth';
// Presentation only: never persist names, tokens, IDs, permissions or API data.
import { shellHintKey } from '../lib/shell-hint';
export function SessionPresentation() {
  const { initialized,isAuthenticated,user }=useAuth();
  useEffect(()=>{
    if(!initialized)return;
    try { if(!isAuthenticated||!user)sessionStorage.removeItem(shellHintKey); else sessionStorage.setItem(shellHintKey,user.tenant?'workspace':user.platformRole==='superadmin'?'platform':'personal'); }
    catch { /* Optional presentation hint. */ }
  },[initialized,isAuthenticated,user]);
  return null;
}
