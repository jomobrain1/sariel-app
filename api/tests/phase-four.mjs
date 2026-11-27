// Run after building the API. The database name is unique to this run.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
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

  // Members see status (discreet link reports included); outsiders see nothing.
  await post('individual/status',{requestId:randomUUID(),level:3},{token:alice.token});
  let view=await call('individual/circle/people/'+alice.id,{token:bob.token});
  assert.equal(view.status.level,3);
  await call('individual/circle/people/'+alice.id,{token:eve.token,status:404});
  await call('individual/circle/people/'+bob.id,{token:alice.token,status:404});
  await post('individual/incident-link',{alias:'alice9',level:5,category:'welfare'},{token:alice.token,status:201});
  await post('auth/safety/activate',{token:'alice9'},{status:204});
  assert.equal((await call('individual/status',{token:alice.token})).level,5);
  assert.equal((await call('individual/circle/people/'+alice.id,{token:bob.token})).status.level,5);

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

  // ── Updates ──────────────────────────────────────────────
  await post('individual/updates',{text:'   '},{token:alice.token,status:422});
  await post('individual/updates',{text:'x'.repeat(281)},{token:alice.token,status:422});
  const trip=await post('individual/updates',{text:'Going to Russia for work'},{token:alice.token,status:201});
  assert.equal((await call('individual/updates',{token:alice.token}))[0].text,'Going to Russia for work');
  const feed=await call('individual/circle/feed',{token:bob.token});
  assert.equal(feed[0].text,'Going to Russia for work');
  assert.equal(feed[0].name,'Alice');
  assert.equal((await call('individual/circle/feed',{token:eve.token})).length,0);
  await call('individual/circle/people/'+alice.id+'/updates',{token:eve.token,status:404});
  assert.equal((await call('individual/circle/people/'+alice.id+'/updates',{token:bob.token})).length,1);
  await call('individual/circle/'+invited.id,{method:'PATCH',body:{permissions:{status:true,location:true,updates:false}},token:alice.token});
  await call('individual/circle/people/'+alice.id+'/updates',{token:bob.token,status:404});
  assert.equal((await call('individual/circle/feed',{token:bob.token})).length,0);
  await call('individual/updates/'+trip.id,{method:'DELETE',token:bob.token,status:404});
  await call('individual/updates/'+trip.id,{method:'DELETE',token:alice.token,status:204});

  // ── Location ─────────────────────────────────────────────
  const spot=(minutesAgo,lat=-1.2921)=>({clientId:randomUUID(),latitude:lat,longitude:36.8219,accuracy:25,recordedAt:new Date(Date.now()-minutesAgo*60_000).toISOString()});
  await post('individual/location',{points:[spot(1)]},{token:alice.token,status:409});
  assert.equal((await call('individual/location/settings',{token:alice.token})).sharing,false);
  await call('individual/location/settings',{method:'PUT',body:{sharing:true},token:alice.token});
  await post('individual/location',{points:[{...spot(1),latitude:91}]},{token:alice.token,status:422});
  await post('individual/location',{points:[spot(-30)]},{token:alice.token,status:422});
  const repeated=spot(10,-1.30);
  const sent=await post('individual/location',{points:[repeated,spot(5,-1.29),spot(60*24*8)]},{token:alice.token});
  assert.deepEqual(sent,{accepted:2,skipped:1});
  await post('individual/location',{points:[repeated]},{token:alice.token});
  assert.equal((await call('individual/location',{token:alice.token})).length,2);
  const seen=await call('individual/circle/people/'+alice.id+'/location',{token:bob.token});
  assert.equal(seen.sharing,true);
  assert.equal(seen.latest.latitude,-1.29);
  assert.equal(seen.history.length,2);
  await call('individual/circle/people/'+alice.id+'/location',{token:eve.token,status:404});
  await call('individual/circle/'+invited.id,{method:'PATCH',body:{permissions:{status:true,location:false,updates:true}},token:alice.token});
  await call('individual/circle/people/'+alice.id+'/location',{token:bob.token,status:404});
  await call('individual/location',{method:'DELETE',token:alice.token,status:204});
  assert.equal((await call('individual/location',{token:alice.token})).length,0);
  console.log('Phase 4 updates and location checks passed.');

  // ── Notifications ────────────────────────────────────────
  const {deliveryCycle}=await import('../dist/notifications/engine.js');
  const received=new Map();let failFirst=true;
  const provider=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    const key=req.headers['idempotency-key'];const count=(received.get(key)?.length??0)+1;
    received.set(key,[...(received.get(key)??[]),{auth:req.headers.authorization,...JSON.parse(raw)}]);
    res.statusCode=failFirst&&count===1?503:200;res.end();});});
  provider.listen(0);await once(provider,'listening');
  process.env.NOTIFICATION_DELIVERY_URL='http://127.0.0.1:'+provider.address().port+'/send';
  process.env.NOTIFICATION_DELIVERY_TOKEN='test-token';
  const inbox=async user=>(await call('individual/notifications',{token:user.token})).items;
  const latest=async(user,kind)=>(await inbox(user)).find(n=>n.kind===kind);

  // Earlier circle activity already produced notifications.
  assert.equal((await latest(bob,'circle-invite')).title,'Alice invited you to their circle');
  assert.equal((await latest(alice,'circle-accepted')).title,'Bob joined your circle');
  assert(await latest(bob,'circle-update'));

  // Retries: the provider fails once, the delivery waits for its backoff, then succeeds.
  await post('individual/circle/people/'+alice.id+'/check-in',undefined,{token:bob.token,status:204});
  let request=await latest(alice,'check-in-request');
  assert.deepEqual(request.deliveries.map(d=>[d.channel,d.state]),[['email','queued']]);
  const start=new Date();
  await deliveryCycle(start);
  request=await latest(alice,'check-in-request');
  assert.equal(request.deliveries[0].state,'queued');
  assert.equal(request.deliveries[0].attempts,1);
  assert.match(request.deliveries[0].lastError,/503/);
  await deliveryCycle(start);
  assert.equal((await latest(alice,'check-in-request')).deliveries[0].attempts,1);
  await deliveryCycle(new Date(start.getTime()+2*60_000));
  request=await latest(alice,'check-in-request');
  assert.equal(request.deliveries[0].state,'sent');
  // Delivery is not acknowledgement.
  assert.equal(request.acknowledgedAt,null);
  const sentBody=[...received.values()].flat().find(b=>b.target===alice.email);
  assert.equal(sentBody.auth,'Bearer test-token');
  assert(!sentBody.text.includes('Bob'),'external text stays discreet');

  // Read state and acknowledgement belong to the recipient only.
  await post('individual/notifications/'+request.id+'/acknowledge',undefined,{token:eve.token,status:404});
  await post('individual/notifications/'+request.id+'/acknowledge',undefined,{token:alice.token,status:204});
  assert((await latest(alice,'check-in-request')).acknowledgedAt);
  assert((await call('individual/notifications/unread',{token:alice.token})).unread>0);
  await post('individual/notifications/read',undefined,{token:alice.token,status:204});
  assert.equal((await call('individual/notifications/unread',{token:alice.token})).unread,0);

  // Preferences: with email off, routine notifications stay in-app.
  await post('individual/circle/check-in-requests/answer',undefined,{token:alice.token,status:204});
  assert.deepEqual(await call('individual/notification-preferences',{token:alice.token}),{email:true,sms:false});
  await call('individual/notification-preferences',{method:'PUT',body:{email:false,sms:false},token:alice.token});
  await post('individual/circle/people/'+alice.id+'/check-in',undefined,{token:bob.token,status:204});
  assert.deepEqual((await latest(alice,'check-in-request')).deliveries,[]);

  // Two workers running at once send each delivery exactly once.
  failFirst=false;
  const forEve2=await post('individual/circle',{email:eve.email,permissions:statusOnly},{token:alice.token,status:201});
  const eveInvite=await latest(eve,'circle-invite');
  assert.equal(eveInvite.deliveries.length,1);
  const toEve=()=>[...received.values()].flat().filter(b=>b.target===eve.email).length;
  const before=toEve();
  await Promise.all([deliveryCycle(new Date(start.getTime()+3*60_000)),deliveryCycle(new Date(start.getTime()+3*60_000))]);
  assert.equal((await latest(eve,'circle-invite')).deliveries[0].state,'sent');
  assert.equal(toEve()-before,1);

  // Without a provider, deliveries are skipped rather than retried forever.
  delete process.env.NOTIFICATION_DELIVERY_URL;
  await post('individual/circle/'+forEve2.id+'/reject',undefined,{token:eve.token,status:204});
  await post('individual/circle',{email:eve.email,permissions:statusOnly},{token:alice.token,status:201});
  await deliveryCycle(new Date(start.getTime()+4*60_000));
  assert.equal((await latest(eve,'circle-invite')).deliveries[0].state,'skipped');
  provider.close();
  console.log('Phase 4 notification checks passed.');

  // ── Status defaults, Travelling and danger alerts ────────
  const users=mongoose.connection.collection('users');
  const individuals=mongoose.connection.collection('sariel_individuals');
  const deliveryRows=mongoose.connection.collection('sariel_notification_deliveries');
  const tom=await person('Tom'), sam=await person('Sam'), kim=await person('Kim'), lee=await person('Lee');
  await users.updateOne({_id:new mongoose.Types.ObjectId(sam.id)},{$addToSet:{roles:'superadmin'}});
  for (const [who,phone] of [[sam,'+254700000001'],[kim,'+254700000002'],[lee,'+254700000003']])
    await individuals.updateOne({_id:who.id},{$set:{phone}},{upsert:true});
  // New people are Confirmed safe, not Unknown.
  let mine=await call('individual/status',{token:tom.token});
  assert.deepEqual([mine.level,mine.status,mine.reportedAt],[1,'CONFIRMED_SAFE',null]);
  // Travelling is a status update, never an incident.
  await post('individual/status',{requestId:randomUUID(),level:1,category:'travelling'},{token:tom.token});
  mine=await call('individual/status',{token:tom.token});
  assert.deepEqual([mine.level,mine.status],[1,'TRAVELLING']);
  assert.equal((await call('individual/status/history',{token:tom.token}))[0].category,'travelling');
  assert.equal(await mongoose.connection.collection('sariel_safety_events').countDocuments({owner:tom.id,active:true}),0);
  // Kim sees Tom's status and location; Lee sees only the status.
  for (const [who,permissions] of [[kim,all],[lee,statusOnly]]) {
    const entry=await post('individual/circle',{email:who.email,permissions},{token:tom.token,status:201});
    await post('individual/circle/'+entry.id+'/accept',undefined,{token:who.token,status:204});
  }
  assert.equal((await call('individual/circle/people/'+tom.id,{token:kim.token})).status.status,'TRAVELLING');
  // A danger report sent with a location: everyone is alerted by email and SMS with level, time and note;
  // only members allowed to see the location (and superadmins) get the map link.
  await post('individual/status',{requestId:randomUUID(),level:2,category:'welfare',note:'Stuck at the border',
    location:{latitude:-1.28333,longitude:36.81667,accuracy:20}},{token:tom.token});
  const channels=n=>n.deliveries.map(d=>d.channel).sort();
  const queued=(n,channel)=>deliveryRows.findOne({notification:n.id,channel});
  const queuedText=async n=>(await queued(n,'email')).text;
  const admin=await latest(sam,'incident-new'), kimAlert=await latest(kim,'circle-incident'), leeAlert=await latest(lee,'circle-incident');
  for (const alert of [admin,kimAlert,leeAlert]) {
    assert.equal(alert.priority,'emergency');
    assert.deepEqual(channels(alert),['email','sms']);
    // Email and SMS say exactly what the in-app notification says.
    const email=await queued(alert,'email'), sms=await queued(alert,'sms');
    assert.deepEqual([email.subject,email.text],[alert.title,alert.body]);
    assert.equal(sms.text,alert.title+'. '+alert.body);
    assert.match(alert.body,/.+ UTC.+Stuck at the border/);
  }
  assert.match(await queuedText(admin),/maps\.google\.com\/\?q=-1\.28333,36\.81667/);
  assert.match(kimAlert.body,/maps\.google\.com/);
  assert.doesNotMatch(leeAlert.body+await queuedText(leeAlert),/maps\.google/);
  const saved=await mongoose.connection.collection('sariel_safety_events').findOne({owner:tom.id,active:true});
  assert.equal(saved.location.source,'report');
  // Superadmins see the location in the incident register.
  const register=await call('platform/incidents',{token:(await post('auth/login',{email:sam.email,password})).tokens.accessToken});
  assert.equal(register.items.find(i=>i.reference===saved._id).location.latitude,-1.28333);
  // Without a location in the report, the last shared point is used. Discreet link reports alert the circle too.
  await call('individual/location/settings',{method:'PUT',body:{sharing:true},token:tom.token});
  await post('individual/location',{points:[spot(1,-4.05)]},{token:tom.token});
  await post('individual/incident-link',{alias:'tom7',level:4,category:'welfare'},{token:tom.token,status:201});
  await post('auth/safety/activate',{token:'tom7'},{status:204});
  const discreet=await mongoose.connection.collection('sariel_safety_events').findOne({owner:tom.id,channel:'gateway'});
  assert.deepEqual([discreet.location.source,discreet.location.latitude],['last-known',-4.05]);
  const kimDiscreet=(await inbox(kim)).filter(n=>n.kind==='circle-incident');
  assert.equal(kimDiscreet.length,2);
  assert.match(kimDiscreet[0].title,/Tom reported: Serious danger/);
  assert.match(kimDiscreet[0].body,/last shared location/);
  assert.equal((await inbox(sam)).filter(n=>n.kind==='incident-new').length,2);
  // After an incident is resolved, the person is Confirmed safe again (not Unknown).
  await mongoose.connection.collection('sariel_safety_events').updateMany({owner:tom.id},{$set:{active:false}});
  assert.equal((await call('individual/status',{token:tom.token})).status,'CONFIRMED_SAFE');
  console.log('Phase 4 status and danger alert checks passed.');

  // ── Welfare monitoring ───────────────────────────────────
  const {welfareCycle}=await import('../dist/welfare/welfare.js');
  const H=3_600_000;
  // Start from a clean slate: close Alice's earlier test incidents, which would otherwise outrank Unknown.
  await mongoose.connection.collection('sariel_safety_events').updateMany({owner:alice.id},{$set:{active:false}});
  const welfare=()=>call('individual/welfare',{token:alice.token});
  assert.equal((await welfare()).enabled,false);
  const plan={enabled:true,intervalHours:6,graceHours:1,shareLocation:true,escalateAfterHours:2};
  await call('individual/welfare',{method:'PUT',body:{...plan,intervalHours:5},token:alice.token,status:422});
  const t0=Date.now();
  let w=await call('individual/welfare',{method:'PUT',body:plan,token:alice.token});
  assert.equal(w.state,'ok');
  assert(Math.abs(new Date(w.dueAt).getTime()-(t0+6*H))<60_000);
  await call('individual/circle/'+invited.id,{method:'PATCH',body:{permissions:all},token:alice.token});
  await post('individual/location',{points:[spot(2,-1.2833)]},{token:alice.token});

  // On time: nothing happens.
  assert.equal(await welfareCycle(new Date(t0+H)),0);
  // Due: the person is reminded first, once.
  await welfareCycle(new Date(t0+6*H+60_000));
  await welfareCycle(new Date(t0+6*H+120_000));
  assert.equal((await welfare()).state,'reminded');
  assert.equal((await inbox(alice)).filter(n=>n.kind==='welfare-reminder').length,1);
  assert.notEqual((await call('individual/circle/people/'+alice.id,{token:bob.token})).status.level,0);

  // Grace period over: status becomes Unknown and the circle is alerted. No incident yet.
  await welfareCycle(new Date(t0+7*H+120_000));
  assert.equal((await welfare()).state,'concern');
  assert.equal((await call('individual/circle/people/'+alice.id,{token:bob.token})).status.level,0);
  const concern=await latest(bob,'welfare-concern');
  assert.equal(concern.priority,'emergency');
  assert.match(concern.body,/Last known location: -1\.28330/);
  assert.equal((await inbox(eve)).filter(n=>n.kind==='welfare-concern').length,0);
  const welfareEvents=async()=>(await call('individual/status/history',{token:alice.token})).filter(e=>e.channel==='welfare');
  assert.deepEqual((await welfareEvents()).map(e=>[e.level,e.active]),[[0,false]]);
  assert((await call('individual/notifications/unread',{token:bob.token})).urgent>=1);

  // Escalation happens only because it was configured, and only once.
  await welfareCycle(new Date(t0+8*H));
  assert.equal((await welfare()).state,'concern');
  await welfareCycle(new Date(t0+9*H+180_000));
  await welfareCycle(new Date(t0+9*H+240_000));
  assert.equal((await welfare()).state,'escalated');
  assert.deepEqual((await welfareEvents()).map(e=>[e.level,e.active]),[[2,true],[0,false]]);

  // Confirming safety from the dashboard counts as a check-in and tells the circle.
  await post('individual/status',{requestId:randomUUID(),level:1},{token:alice.token});
  w=await welfare();
  assert.equal(w.state,'ok');
  // Simulated cycle events are dated in the future, so check membership rather than order.
  assert(['resolved','check-in','escalated','concern','reminder','enabled'].every(kind=>w.events.some(e=>e.kind===kind)));
  assert(await latest(bob,'welfare-resolved'));

  // The check-in endpoint resets the schedule and records a safe status.
  w=await post('individual/welfare/check-in',undefined,{token:alice.token});
  assert(new Date(w.dueAt).getTime()>Date.now()+5*H);
  assert.equal((await call('individual/status',{token:alice.token})).level,2);

  // Without escalation configured, a concern never becomes an incident; location stays private when not allowed.
  await call('individual/welfare',{method:'PUT',body:{...plan,shareLocation:false,escalateAfterHours:null},token:alice.token});
  const t1=Date.now();
  await welfareCycle(new Date(t1+6*H+60_000));
  await welfareCycle(new Date(t1+7*H+120_000));
  await welfareCycle(new Date(t1+40*H));
  assert.equal((await welfare()).state,'concern');
  assert.equal((await welfareEvents()).filter(e=>e.level===2).length,1);
  assert.doesNotMatch((await latest(bob,'welfare-concern')).body,/Last known location/);

  // Turned off: nothing progresses.
  await call('individual/welfare',{method:'PUT',body:{...plan,enabled:false},token:alice.token});
  assert.equal(await welfareCycle(new Date(t1+100*H)),0);
  console.log('Phase 4 welfare checks passed.');
}finally{
  await new Promise(resolve=>server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
