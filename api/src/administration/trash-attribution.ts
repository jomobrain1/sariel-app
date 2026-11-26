import mongoose from 'mongoose';
import { currentTenantScope, type Middleware } from '@tilcayo/core';
import { auth } from '../auth.js';

// Tilcayo performs the delete and revokes sessions. Attach attribution only to
// the resulting soft deletion, so a later restore cannot reuse an old name.
export const recordUserDeletion: Middleware = async (ctx,next) => {
  const match=ctx.method==='DELETE' && /^\/api\/admin\/users\/([a-f\d]{24})\/?$/i.exec(ctx.path);
  if(!match || currentTenantScope()?.tenantId) return next();
  const actor=auth.user(ctx);
  if(actor.platformRole!=='superadmin') return next();
  const users=mongoose.connection.collection('users');
  const _id=new mongoose.Types.ObjectId(match[1]);
  const before=await users.findOne({_id,deletedAt:null},{projection:{_id:1}});
  const started=new Date();
  const result=await next();
  if(before) {
    const deleted=await users.findOne({_id,deletedAt:{$gte:started}},{projection:{deletedAt:1}});
    if(deleted) await users.updateOne({_id,deletedAt:deleted.deletedAt},{$set:{
      sarielDeletion:{at:deleted.deletedAt,name:actor.name}
    }});
  }
  return result;
};
