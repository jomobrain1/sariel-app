// Run after building the API. The database name is unique to this run.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import mongoose from 'mongoose';
process.env.AUTH_ACCESS_SECRET=randomUUID();
process.env.AUTH_REFRESH_SECRET=randomUUID();
process.env.TENANCY_BASE_DOMAIN='localhost';
process.env.SARIEL_WORKERS='off';
await mongoose.connect(process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017', {dbName:'sariel_test_'+randomUUID().replaceAll('-','')});
const {default:app}=await import('../dist/app.js');
const server=app.listen(0);
await once(server,'listening');
async function call(path,{method='GET',body,token,status=200}={}){
  const response=await new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/'+path,method,headers:{host:'localhost','content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},resolve);
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  let raw='';for await(const chunk of response)raw+=chunk;
  assert.equal(response.statusCode,status,method+' '+path+' returned '+response.statusCode+' '+raw);return raw?JSON.parse(raw).data:null;
}
const post=(path,body,options={})=>call(path,{method:'POST',body,...options});
const password=randomUUID();
async function person(name){
  const email=name.toLowerCase()+'@example.test';
  await post('auth/register',{name,email,password},{status:201});
  const login=await post('auth/login',{email,password});
  const token=login.tokens.accessToken;
  return {name,email,token,id:login.user.id};
}
try {
  const alice=await person('Alice'), bob=await person('Bob'), eve=await person('Eve');
  const circle=user=>call('individual/circle',{token:user.token});
  const all={status:true,location:true,updates:true};

  // ── Circle ───────────────────────────────────────────────
  const statusOnly={status:true,location:false,updates:false};
  await post('individual/circle',{email:alice.email,permissions:statusOnly},{token:alice.token,status:422});
  const invited=await post('individual/circle',{email:bob.email,relationship:'family',permissions:statusOnly},{token:alice.token,status:201});
  const unknown=await post('individual/circle',{email:'nobody@example.test',permissions:statusOnly},{token:alice.token,status:201});
  // Same response shape for existing and unknown addresses.
  assert.deepEqual(Object.keys(invited).sort(),Object.keys(unknown).sort());
  assert.equal(invited.name,null);
  await post('individual/circle',{email:bob.email.toUpperCase(),permissions:statusOnly},{token:alice.token,status:409});

  // Only the invited person can accept.
  assert.equal((await circle(eve)).invitations.length,0);
  await post('individual/circle/'+invited.id+'/accept',undefined,{token:eve.token,status:404});
  await call('individual/circle/people/'+alice.id,{token:bob.token,status:404});
  const bobView=await circle(bob);
  assert.equal(bobView.invitations.length,1);
  assert.equal(bobView.invitations[0].name,'Alice');
  await post('individual/circle/'+invited.id+'/accept',undefined,{token:bob.token,status:204});
  await post('individual/circle/'+invited.id+'/accept',undefined,{token:bob.token,status:404});
  assert.equal((await circle(alice)).members.find(m=>m.id===invited.id).name,'Bob');
  assert.equal((await circle(bob)).circles[0].owner,alice.id);

  // Members see status; outsiders see nothing; discreet link reports stay hidden.
  await post('individual/status',{requestId:randomUUID(),level:3},{token:alice.token});
  let view=await call('individual/circle/people/'+alice.id,{token:bob.token});
  assert.equal(view.status.level,3);
  await call('individual/circle/people/'+alice.id,{token:eve.token,status:404});
  await call('individual/circle/people/'+bob.id,{token:alice.token,status:404});
  await post('individual/incident-link',{alias:'alice9',level:5,category:'welfare'},{token:alice.token,status:201});
  await post('auth/safety/activate',{token:'alice9'},{status:204});
  assert.equal((await call('individual/status',{token:alice.token})).level,5);
  assert.equal((await call('individual/circle/people/'+alice.id,{token:bob.token})).status.level,3);

  // Permissions can be narrowed by the owner only.
  await call('individual/circle/'+invited.id,{method:'PATCH',body:{permissions:{...statusOnly,status:false}},token:bob.token,status:404});
  await call('individual/circle/'+invited.id,{method:'PATCH',body:{permissions:{...statusOnly,status:false}},token:alice.token});
  assert.equal((await call('individual/circle/people/'+alice.id,{token:bob.token})).status,null);
  await call('individual/circle/'+invited.id,{method:'PATCH',body:{permissions:all},token:alice.token});

  // Check-in requests: one open request per member, answered by the owner.
  await post('individual/circle/people/'+alice.id+'/check-in',undefined,{token:eve.token,status:404});
  await post('individual/circle/people/'+alice.id+'/check-in',undefined,{token:bob.token,status:204});
  await post('individual/circle/people/'+alice.id+'/check-in',undefined,{token:bob.token,status:204});
  assert.equal((await circle(alice)).checkInRequests.length,1);
  await post('individual/circle/check-in-requests/answer',undefined,{token:alice.token,status:204});
  assert.equal((await circle(alice)).checkInRequests.length,0);
  assert((await call('individual/circle/people/'+alice.id,{token:bob.token})).lastCheckInRequest.answeredAt);

  // Rejecting removes the invite; leaving removes access immediately.
  const forEve=await post('individual/circle',{email:eve.email,permissions:statusOnly},{token:alice.token,status:201});
  await post('individual/circle/'+forEve.id+'/reject',undefined,{token:eve.token,status:204});
  assert(!(await circle(alice)).members.some(m=>m.id===forEve.id));
  const bobCircle=await post('individual/circle',{email:alice.email,permissions:all},{token:bob.token,status:201});
  await post('individual/circle/'+bobCircle.id+'/accept',undefined,{token:alice.token,status:204});
  await call('individual/circle/'+bobCircle.id,{method:'DELETE',token:alice.token,status:204});
  await call('individual/circle/people/'+bob.id,{token:alice.token,status:404});
  await call('individual/circle/'+bobCircle.id,{method:'DELETE',token:eve.token,status:404});

  console.log('Phase 4 circle checks passed.');
}finally{
  await new Promise(resolve=>server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
