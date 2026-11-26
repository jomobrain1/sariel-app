// Run after building the API. The database name is unique to this run.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import mongoose from 'mongoose';
import { bootstrapTenancy } from '@tilcayo/auth';
process.env.AUTH_ACCESS_SECRET=randomUUID();
process.env.AUTH_REFRESH_SECRET=randomUUID();
process.env.TENANCY_BASE_DOMAIN='localhost';
await mongoose.connect(process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017', {dbName:'sariel_test_'+randomUUID().replaceAll('-','')});
const {default:app}=await import('../dist/app.js');
const server=app.listen(0);
await once(server,'listening');
async function call(path,{method='GET',body,token,host='localhost',status=200}={}){
  const response=await new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/'+path,method,headers:{host,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},resolve);
    req.on('error',reject);req.end(JSON.stringify(body));
  });
  let raw='';for await(const chunk of response)raw+=chunk;
  assert.equal(response.statusCode,status,method+' '+path+' '+raw);return raw?JSON.parse(raw).data:null;
}
try {
  const password='TemporaryDemo123!',email='platform@example.test',staff='staff@example.test';
  await bootstrapTenancy({email,password});
  const login=async(email,host)=> (await call('auth/login',{method:'POST',body:{email,password},host})).tokens.accessToken;
  const token=await login(email);
  await call('auth/register',{method:'POST',status:201,body:{name:'Demo Staff',email:staff,password}});
  const individual=await login(staff);
  const org=await call('platform/tenants',{method:'POST',status:201,token,body:{name:'Demo mission',slug:'demo',adminEmail:email}});
  await call('sariel/admin/platform',{token:individual,status:403});
  const put=(path,value,revision=0,status=200)=>call('sariel/admin/'+path,{method:'PUT',token,status,body:{revision,value}});
  const scope={category:'Government',verification:'verified',countries:['KE'],jurisdictions:['Kenya'],incidentCategories:['welfare'],capabilities:['welfare'],officialEmail:email,officialPhone:'demo',operatingHours:'Always',timeZone:'Africa/Nairobi',available:true,preferredLanguage:'English'};
  await put('organization/'+org.id,scope);
  await put('organization/'+org.id,scope,0,409);
  const rule={name:'Check in',priority:1,countries:['KE'],nationalities:['KE'],incidentCategories:['welfare'],capabilities:['welfare'],severities:['high'],availableOnly:true,referralTenantIds:[],authorization:'explicit-consent',disclose:['category']};
  await put('routing/'+org.id,{rules:[rule]});
  await put('routing/'+org.id,{rules:[{...rule,countries:['UG']}]},1,422);
  const invitation=await call('sariel/admin/invitations/'+org.id,{token,method:'POST',body:{email:staff,role:'Legal officer'}});
  await call('sariel/staff/accept',{token:individual,method:'POST',body:{token:invitation.token},status:204});
  const host='demo.localhost', staffToken=await login(staff,host);
  const view=await call('sariel/staff/workspace',{token:staffToken,host});
  assert.deepEqual(view.scope,scope);assert.equal(view.routing,undefined);
  await call('sariel/admin/platform',{token:staffToken,host,status:403});
  await call('platform/tenants',{method:'POST',status:201,token,body:{name:'Other demo',slug:'other-demo',adminEmail:email}});
  await call('auth/login',{method:'POST',body:{email:staff,password},host:'other-demo.localhost',status:403});
  const members=await call('platform/tenants/'+org.id+'/members',{token});
  const member=members.find(m=>m.email===staff);
  await call('sariel/admin/staff/'+org.id+'/'+member.id,{method:'PUT',token,body:{role:null},status:204});
  await call('sariel/staff/workspace',{token:staffToken,host,status:403});
  const audit=await call('sariel/admin/audit',{token});
  const adminUser=await call('auth/me',{token});
  assert(audit.some(entry=>entry.action==='staff.suspended' && entry.actorName===adminUser.name));
  await call('platform/tenants/'+org.id,{method:'DELETE',token,status:204});
  const actors=await call('sariel/admin/trash/actors?ids='+org.id,{token});
  assert.equal(actors[org.id],adminUser.name);
  await call('admin/users/'+member.id,{method:'DELETE',token,status:204});
  const userActors=await call('sariel/admin/trash/actors?kind=users&ids='+member.id,{token});
  assert.equal(userActors[member.id],adminUser.name);
  console.log('Phase 2 API checks passed.');
}finally{
  await new Promise(resolve=>server.close(resolve));
  await mongoose.connection.dropDatabase();await mongoose.disconnect();
}
