import mongoose from 'mongoose';
import { createHmac, randomInt } from 'node:crypto';
import { createHttpError, defineRoutes, rateLimit, type Middleware } from '@tilcayo/core';
import { z } from 'zod';
import { auth } from '../auth.js';
import { sendSms, smsConfigured } from '../notifications/sms.js';
import { sendEmail, smtpConfigured } from '../notifications/email.js';

const personalHost: Middleware = (ctx, next) => {
  if (auth.user(ctx).tenant) throw createHttpError(403, 'FORBIDDEN', 'Use your individual account on the main domain.');
  return next();
};
export const individual = [...auth.requestMiddleware, auth.middleware, personalHost];
const username = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,31}$/);
const channel = z.enum(['email', 'phone']);
type Channel = z.infer<typeof channel>;
interface Account {
  _id: string;
  username?: string;
  email?: string;
  phone?: string;
  challenges?: Partial<Record<Channel, { digest: string; target: string; expires: Date }>>;
}
const accounts = () => mongoose.connection.collection<Account>('sariel_individuals');
const limiter = rateLimit({ windowMs: 600_000, max: 12 });
function digest(owner: string, kind: Channel, target: string, code: string) {
  return createHmac('sha256', process.env.AUTH_ACCESS_SECRET!).update(JSON.stringify([owner,kind,target,code])).digest('hex');
}
export default defineRoutes(router => {
  router.group({prefix:'/api/individual',middleware:individual}, () => {
    router.get('/account', async ctx => {
      const user = auth.user(ctx);
      const account = await accounts().findOne({_id:user.id}, {projection:{challenges:0}});
      return ctx.response.success({name:user.name,email:user.email,username:account?.username ?? null,
        verifiedEmail:account?.email === user.email,verifiedPhone:account?.phone ?? null});
    });
    router.put('/username', async ctx => {
      const body = ctx.body as {username:string};
      await accounts().createIndex({username:1},{unique:true,sparse:true});
      try { await accounts().updateOne({_id:auth.user(ctx).id},{$set:body},{upsert:true}); }
      catch(error) {
        if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) throw createHttpError(409,'CONFLICT','Username unavailable.');
        throw error;
      }
      return ctx.response.success(body);
    }, {validate:{body:z.strictObject({username})}});
    router.post('/verification/request', async ctx => {
      const user=auth.user(ctx);
      const body=ctx.body as {channel:Channel;phone?:string};
      const target=body.channel==='email'?user.email:body.phone!;
      const endpoint=process.env.VERIFICATION_DELIVERY_URL;
      const key=process.env.VERIFICATION_DELIVERY_TOKEN;
      // Without a delivery webhook, codes go out directly: SMS via Mobile Sasa, email via SMTP.
      const direct=body.channel==='phone'?smsConfigured():smtpConfigured();
      if((!endpoint?.startsWith('https://') || !key) && !direct) throw createHttpError(503,'DELIVERY_UNAVAILABLE','Verification delivery is unavailable.');
      const code=String(randomInt(1_000_000)).padStart(6,'0');
      const challenge={target,digest:digest(user.id,body.channel,target,code),expires:new Date(Date.now()+600_000)};
      const path='challenges.'+body.channel;
      await accounts().updateOne({_id:user.id},{$set:{[path]:challenge}},{upsert:true});
      try {
        if(endpoint?.startsWith('https://') && key){
          const result=await fetch(endpoint,{method:'POST', redirect:'error',signal:AbortSignal.timeout(8000),
            headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({channel:body.channel,target,code})});
          if(!result.ok) throw new Error();
        } else if(body.channel==='phone') await sendSms(target,`Your Sariel verification code is ${code}. It expires in 10 minutes.`);
        else await sendEmail(target,'Your Sariel verification code',`Your Sariel verification code is ${code}. It expires in 10 minutes.`,'verify-'+user.id);
      } catch {
        await accounts().updateOne({_id:user.id,[path+'.digest']:challenge.digest},{$unset:{[path]:''}});
        throw createHttpError(503,'DELIVERY_UNAVAILABLE','Verification delivery failed.');
      }
      return ctx.response.noContent();
    },{middleware:[limiter],validate:{body:z.discriminatedUnion('channel',[
      z.strictObject({channel:z.literal('email')}),z.strictObject({channel:z.literal('phone'),phone:z.string().regex(/^\+[1-9]\d{7,14}$/)})])}});
    router.post('/verification/confirm',async ctx=>{
      const {channel:kind,code}=ctx.body as {channel:Channel;code:string};
      const user=auth.user(ctx);
      const path='challenges.'+kind;
      const pending=(await accounts().findOne({_id:user.id}))?.challenges?.[kind];
      if(!pending) throw createHttpError(422,'INVALID_CODE','Request a new code.');
      // Consume each challenge on the first attempt, including incorrect guesses.
      const valid=pending.expires>new Date() && pending.digest===digest(user.id,kind,pending.target,code)
        && (kind!=='email'||pending.target===user.email);
      const update=await accounts().updateOne({_id:user.id,[path+'.digest']:pending.digest},
        {$unset:{[path]:''},...(valid?{$set:{[kind]:pending.target}}:{})});
      if(!valid||!update.modifiedCount) throw createHttpError(422,'INVALID_CODE','Request a new code.');
      return ctx.response.noContent();
    },{middleware:[limiter],validate:{body:z.strictObject({channel,code:z.string().regex(/^\d{6}$/)})}});
    // Removes the verified phone number; SMS alerts stop until a new one is confirmed.
    router.delete('/phone',async ctx=>{
      await accounts().updateOne({_id:auth.user(ctx).id},{$unset:{phone:'','challenges.phone':''}});
      return ctx.response.noContent();
    });
  });
});
