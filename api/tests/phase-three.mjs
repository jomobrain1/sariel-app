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
  assert.equal(response.statusCode,status,method+' '+path+' returned '+response.statusCode);return raw?JSON.parse(raw).data:null;
}
try {
  const password=randomUUID(), email='admin@example.test', citizen='individual@example.test';
  const post=(path,body,options={})=>call(path,{method:'POST',body,...options});
  await bootstrapTenancy({email,password});
  const login=async(email,host='localhost')=>(await post('auth/login',{email,password},{host})).tokens.accessToken;
  await post('auth/register',{name:'Demo Individual',email:citizen,password},{status:201});
  const token=await login(citizen), admin=await login(email);
  const put=(path,body,options={})=>call(path,{method:'PUT',body,token,...options});
  await put('individual/username',{username:'DemoCitizen'});
  await put('individual/username',{username:'democitizen'},{token:admin,status:409});
  assert.equal((await call('individual/account',{token})).username,'democitizen');
  const confirm=(channel,code,status=204)=>post('individual/verification/confirm',{channel,code},{token,status});
  // Replace only the outbound delivery relay. HTTP API, auth and MongoDB are real.
  process.env.VERIFICATION_DELIVERY_URL='https://verification.example.test/send';
  process.env.VERIFICATION_DELIVERY_TOKEN=randomUUID();
  const realFetch=globalThis.fetch;
  let delivery;
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,process.env.VERIFICATION_DELIVERY_URL);
    delivery=JSON.parse(init.body);
    return new Response(null,{status:204});
  };
  try {
    for(const channel of ['phone','email']){
      const target=channel==='email'?citizen:'+254700000000';
      await post('individual/verification/request',{channel,...(channel==='phone'?{phone:target}:{})},{token,status:204});
      assert.equal(delivery.target,target);
      await confirm(channel,delivery.code);
      await confirm(channel,delivery.code,422);
    }
  }finally{globalThis.fetch=realFetch;}
  assert.equal((await call('individual/account',{token})).verifiedEmail,true);
  const createOrg=(slug)=>post('platform/tenants',{name:'Demo '+slug,slug,adminEmail:email},{token:admin,status:201});
  const org=await createOrg('first-demo'), other=await createOrg('second-demo');
  const host=org.slug+'.localhost', otherHost=other.slug+'.localhost';
  const firstStaff={token:await login(email,host),host}, secondStaff={token:await login(email,otherHost),host:otherHost};
  await call('individual/account',{...firstStaff,status:403});
  const scope={category:'Government',verification:'verified',countries:['KE'],jurisdictions:['Kenya'],incidentCategories:['welfare'],capabilities:['welfare'],officialEmail:email,officialPhone:'demo',operatingHours:'Always',timeZone:'Africa/Nairobi',available:true,preferredLanguage:'English'};
  const config=(path,value)=>put('sariel/admin/'+path,{value,revision:0},{token:admin});
  for(const tenant of [org,other]) await config('organization/'+tenant.id,scope);
  // Verified isn't enough: incident access must also be granted by the platform administrator.
  assert.deepEqual(await call('incidents/access',firstStaff),{verified:true,enabled:false,allowed:false,changedAt:null,responder:true,manager:true});
  await call('incidents/',{...firstStaff,status:403});
  await call('sariel/admin/organization/'+org.id+'/access',{token:firstStaff.token,host:firstStaff.host,status:403});
  for(const tenant of [org,other]){
    const granted=await put('sariel/admin/organization/'+tenant.id+'/access',{incidentAccess:true},{token:admin});
    assert.equal(granted.allowed,true);
  }
  assert.equal((await call('incidents/access',firstStaff)).allowed,true);
  const rule={name:'Demo rule',priority:1,countries:['KE'],nationalities:['KE'],incidentCategories:['welfare'],capabilities:['welfare'],severities:['high'],availableOnly:true,referralTenantIds:[other.id],authorization:'explicit-consent',disclose:['severity']};
  await config('routing/'+org.id,{rules:[rule]});
  await config('routing/'+other.id,{rules:[{...rule,priority:2,referralTenantIds:[]}]});
  const profile={information:{residence:'KE',nationality:'KE',preferredLanguage:'Kiswahili',medicalInformation:'Private demo field'},
    disclosure:[{tenantId:org.id,fields:['preferredLanguage']},{tenantId:other.id,fields:[]}]};
  await put('individual/safety-profile',profile,{status:204});
  assert.deepEqual(await call('individual/safety-profile',{token:admin}),{information:{},disclosure:[]});
  const issue=()=>post('individual/safety-identity',{}, {token,status:201});
  const old=await issue(), identity=await issue();
  assert.equal(new Set(identity.codes.map(item=>item.secret)).size,6);
  for(const {level,secret} of identity.codes) {
    assert.equal((await post('auth/safety/validate',{selector:identity.selector,secret})).level,level);
  }
  await call('auth/safety/report',{status:404});
  assert.deepEqual(await call('individual/status/history',{token}),[]);
  const credential={selector:identity.selector,secret:identity.codes[4].secret};
  await post('auth/safety/validate',{selector:old.selector,secret:old.codes[4].secret},{status:403});
  assert.equal((await post('auth/safety/validate',credential)).level,4);
  assert.equal((await call('individual/status',{token})).level,0);
  const report={...credential,requestId:randomUUID(),category:'welfare',country:'KE'};
  const [one,two]=await Promise.all([post('auth/safety/report',report),post('auth/safety/report',report)]);
  assert.equal(one.reference,two.reference);
  await post('auth/safety/report',{...report,category:'different'},{status:409});
  await post('individual/status',{requestId:randomUUID(),level:0},{token});
  assert.equal((await call('individual/status',{token})).level,4);
  await post('individual/status',{requestId:randomUUID(),level:1},{token});
  assert.equal((await call('individual/status',{token})).level,4);
  const list=await call('incidents/',firstStaff);
  assert.equal(list.length,1);
  const path='incidents/'+list[0].handle;
  await call(path,{...secondStaff,status:404});
  const detail=await call(path,firstStaff);
  assert.equal(detail.severity,'high');assert.equal(detail.category,undefined);
  assert.deepEqual(await call(path+'/disclosure',firstStaff),{preferredLanguage:'Kiswahili'});
  await put('individual/safety-profile',{...profile,disclosure:[{tenantId:org.id,fields:[]},profile.disclosure[1]]},{status:204});
  assert.deepEqual(await call(path+'/disclosure',firstStaff),{});
  const act=(path,option,version,command,status=204)=>post(path+'/actions',{version,command},{...option,status});
  await act(path,firstStaff,0,{action:'resolve',note:'too early'},409);
  const me=await call('auth/me',firstStaff);
  await act(path,firstStaff,0,{action:'assign',officer:me.id});
  await act(path,firstStaff,1,{action:'acknowledge'});
  await act(path,firstStaff,2,{action:'note',note:'private handoff notes'});
  await act(path,firstStaff,3,{action:'refer',tenant:other.id,note:'Request further assistance'});
  await call(path,{...firstStaff,status:404});
  const target='incidents/'+(await call('incidents/',secondStaff))[0].handle;
  assert(!(await call(target,secondStaff)).timeline.some(e=>e.note));
  await act(target,secondStaff,4,{action:'acknowledge'});
  await act(target,secondStaff,5,{action:'resolve',note:'Demo completed'});
  assert.equal((await call('individual/status',{token})).level,1);
  assert.equal((await call('individual/status/history',{token})).length,3);
  await call('individual/safety-identity',{method:'DELETE',token,status:204});
  await post('auth/safety/report',{...report,requestId:randomUUID()},{status:403});
  await call('individual/safety-profile',{method:'DELETE',token,status:204});
  const pending=await post('individual/status',{requestId:randomUUID(),level:4},{token});
  assert((await call('platform/incidents/pending',{token:admin})).some(i=>i._id===pending.reference));
  await put('individual/safety-profile',profile,{status:204});
  assert.equal((await post('platform/incidents/'+pending.reference+'/retry',{}, {token:admin})).state,'assigned');
  const generateLink=()=>post('individual/incident-link',{level:3,category:'welfare'},{token,status:201});
  const activate=(url,status)=>post('auth/safety/activate',{token:url.slice(1)},{status});
  const before=(await call('individual/status/history',{token})).length;
  const replaced=await generateLink();
  const link=await generateLink();
  assert.match(link.url,/^\/[A-Za-z0-9_-]{16}$/);
  await activate(replaced.url,403);
  await call('auth/safety/activate',{status:404});
  assert.equal((await call('individual/status/history',{token})).length,before);
  await Promise.all([activate(link.url,204),activate(link.url,204)]);
  await activate(link.url,204);
  assert.equal((await call('individual/status/history',{token})).length,before+1);
  await call('individual/incident-link',{token,method:'DELETE',status:204});
  await activate(link.url,403);
  const named={alias:'jomo1',level:4,category:'welfare'};
  const memorable=await post('individual/incident-link',named,{token,status:201});
  assert.equal(memorable.url,'/jomo1');
  await post('individual/incident-link',named,{token:admin,status:409});
  await activate('/jomo1',204);
  await activate('/jomo1',204);
  assert.equal((await call('individual/status/history',{token})).length,before+2);
  await call('individual/incident-link',{token,method:'DELETE',status:204});
  await activate('/jomo1',403);
  await post('individual/incident-link',named,{token:admin,status:409});
  assert.equal((await post('individual/incident-link',named,{token,status:201})).url,'/jomo1');
  await call('platform/incidents',{token,status:403});
  await call('platform/incidents',{...firstStaff,status:403});
  const directory=await call('platform/incidents',{token:admin});
  const filtered=await call('platform/incidents?group=resolved&level=4&search=Demo%20Individual',{token:admin});
  assert.equal(filtered.total,1);
  assert.equal(filtered.levels['4'],1);
  assert.equal(filtered.groups.resolved,1);
  assert.equal((await call('platform/incidents?search=%2E%2A',{token:admin})).total,0);
  assert(directory.items.some(i=>i.state==='resolved' && i.organization===other.name));
  const linkIncident=directory.items.find(i=>i.channel==='gateway' && i.level===3);
  assert.equal(linkIncident.account.email,citizen);
  assert.equal(linkIncident.account.name,'Demo Individual');
  assert(directory.items.every(i=>i.level>=2 && !('audit' in i)));
  const galleryToken={token:'jomo1'};
  const {edition}=await post('auth/safety/activate',{...galleryToken,gallery:true});
  const cover=()=>post('auth/safety/gallery',galleryToken);
  assert.deepEqual(await cover(),{edition,cover:'valley'});
  const selection={...galleryToken,edition,requestId:randomUUID(),image:'mountain'};
  await Promise.all([1,2].map(()=>post('auth/safety/gallery/select',selection,{status:204})));
  const newest=(await call('platform/incidents',{token:admin})).items[0];
  assert.equal(newest.level,5);
  assert.deepEqual(newest.signals.map(e=>e.action),['gallery-mountain']);
  const responsePath='platform/incidents/'+newest.reference+'/response';
  const dispatch={action:'dispatch',confirmed:true,version:newest.version};
  await post(responsePath,dispatch,{token:admin,status:409});
  await post(responsePath,{action:'acknowledge',version:newest.version},{token,status:403});
  await post(responsePath,{action:'acknowledge',version:newest.version},{token:admin,status:204});
  assert.deepEqual(await cover(),{edition,cover:'sunrise'});
  await post(responsePath,{...dispatch,version:newest.version+1},{token:admin,status:204});
  assert.deepEqual(await cover(),{edition,cover:'harbor'});
  const after=(await call('platform/incidents',{token:admin})).items[0];
  assert.equal(after.reference,newest.reference);
  assert.deepEqual(after.signals.map(s=>s.action),['gallery-mountain','acknowledge','dispatch']);
  assert(after.signals[2].actorName);
  // Links never expire: once the incident is resolved, reopening the link starts a new incident.
  const reopened=(await call('individual/status/history',{token})).length;
  await activate('/jomo1',204);
  assert.equal((await call('individual/status/history',{token})).length,reopened);
  await mongoose.connection.collection('sariel_safety_events').updateOne({_id:newest.reference},{$set:{active:false,'incident.state':'resolved'}});
  const fresh=await post('auth/safety/activate',{...galleryToken,gallery:true});
  assert.notEqual(fresh.edition,edition);
  assert.equal((await call('individual/status/history',{token})).length,reopened+1);
  await activate('/jomo1',204);
  assert.equal((await call('individual/status/history',{token})).length,reopened+1);
  assert.deepEqual(await cover(),{edition:fresh.edition,cover:'valley'});
  // Revoking incident access blocks the organisation immediately.
  await put('sariel/admin/organization/'+org.id+'/access',{incidentAccess:false},{token:admin});
  await call('incidents/',{...firstStaff,status:403});
  assert.equal((await call('incidents/access',firstStaff)).allowed,false);
  console.log('Phase 3 HTTP integration checks passed.');
}finally{
  await new Promise(resolve=>server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
