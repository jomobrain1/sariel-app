import { defineRoutes } from '@tilcayo/core';
import { z } from 'zod';
import { credential, publicReporting, resolveCredential } from './identity.js';
import { recordStatus, reportInput } from './status.js';

const submission=reportInput.extend(credential.shape);
export default defineRoutes(router=>{
  router.group({prefix:'/api/auth/safety',middleware:publicReporting},()=>{
    router.post('/report',async ctx=>{
      const {selector,secret,...report}=ctx.body as z.output<typeof submission>;
      const {owner,level}=await resolveCredential({selector,secret});
      return ctx.response.success(await recordStatus(owner,{...report,level},'gateway'));
    },{validate:{body:submission}});
  });
});
