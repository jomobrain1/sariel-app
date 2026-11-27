// Local, isolated MongoDB database and fake delivery provider only. No real recipient is contacted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import mongoose from 'mongoose';
process.env.AUTH_ACCESS_SECRET=randomUUID();
process.env.AUTH_REFRESH_SECRET=randomUUID();
process.env.TENANCY_BASE_DOMAIN='localhost';
process.env.SARIEL_WORKERS='off';
await mongoose.connect(process.env.TEST_MONGO_URI||'mongodb://127.0.0.1:27017',{dbName:'sariel_recovery_test_'+randomUUID().replaceAll('-','')});
const {default:app}=await import('../dist/app.js');
const {events,recoverIncidentNotifications}=await import('../dist/individual/status.js');
const {notifications,deliveries,notify,repairNotificationQueues,deliveryCycle}=await import('../dist/notifications/engine.js');
const sent=[];
const provider=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;sent.push({key:req.headers['idempotency-key'],...JSON.parse(raw)});res.end('{}');});
provider.listen(0,'127.0.0.1');await once(provider,'listening');
process.env.NOTIFICATION_DELIVERY_URL='http://127.0.0.1:'+provider.address().port;
process.env.NOTIFICATION_DELIVERY_TOKEN='local-test-only';
const server=app.listen(0);await once(server,'listening');
async function call(path,{method='GET',body,token,status=200}={}) {
  const response=await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/'+path,method,
    headers:{host:'localhost','content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},resolve);req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
  let raw='';for await(const chunk of response)raw+=chunk;
  assert.equal(response.statusCode,status,raw);return raw?JSON.parse(raw).data:null;
}
const post=(path,body,options={})=>call(path,{method:'POST',body,...options});
const password=randomUUID();
async function person(name){const email=name+'@example.test';const account=await post('auth/register',{name,email,password},{status:201});return {...account.user,token:account.tokens.accessToken};}
try {
  const owner=await person('Owner'),member=await person('Member'),limited=await person('Limited');
  for(const [person,location] of [[member,true],[limited,false]]) {
    const invite=await post('individual/circle',{email:person.email,relationship:'friend',permissions:{status:true,location,updates:false}},{token:owner.token,status:201});
    await post('individual/circle/'+invite.id+'/accept',undefined,{token:person.token,status:204});
  }
  await post('individual/emergency-contacts',{name:'External',email:'external@example.test',phone:'+254700000111',relationship:'friend'},{token:owner.token,status:201});
  const nc=notifications(),dc=deliveries();
  const originalInsert=nc.insertOne;
  let fail=true;
  nc.insertOne=function(doc,...args){if(fail&&doc.kind==='circle-incident'){fail=false;return Promise.reject(new Error('Injected notification insert failure'));}return originalInsert.call(this,doc,...args);};
  const captured=new Date(Date.now()-120000).toISOString();
  const body={level:4,category:'welfare',requestId:randomUUID(),location:{latitude:-1.29,longitude:36.82,accuracy:12,recordedAt:captured,source:'report'}};
  const first=await post('individual/status',body,{token:owner.token});
  nc.insertOne=originalInsert;
  assert.equal(first.notificationsPending,true);
  assert.equal(await events().countDocuments({owner:owner.id}),1);
  // Same request, different coordinates: replay must use original stored location, not retry input.
  const retry=await post('individual/status',{...body,location:{...body.location,latitude:0}},{token:owner.token});
  assert.equal(retry.reference,first.reference);assert.equal(retry.notificationsPending,false);
  assert.equal(await events().countDocuments({owner:owner.id}),1);
  const event=await events().findOne({_id:first.reference});
  assert.equal(event.location.recordedAt.toISOString(),captured);
  const full=await nc.findOne({recipient:member.id,kind:'circle-incident'});
  const redacted=await nc.findOne({recipient:limited.id,kind:'circle-incident'});
  assert(full.body.includes('-1.29000'));assert(full.body.includes('accuracy +/-12 m'));assert(full.body.includes('captured'));
  assert(!redacted.body.includes('maps.google'));assert(!redacted.body.includes('accuracy'));
  assert.equal(await mongoose.connection.collection('sariel_contact_alerts').countDocuments({owner:owner.id}),1);
  const externalRows=await dc.find({recipient:{$regex:'^contact:'}}).toArray();assert.equal(externalRows.length,2);
  // Background recovery also repairs intake without a client retry.
  fail=true;nc.insertOne=function(doc,...args){if(fail&&doc.kind==='circle-incident'){fail=false;return Promise.reject(new Error('Injected recovery failure'));}return originalInsert.call(this,doc,...args);};
  const second=await post('individual/status',{level:2,category:'welfare',requestId:randomUUID()},{token:owner.token});nc.insertOne=originalInsert;
  assert.equal(second.notificationsPending,true);
  await recoverIncidentNotifications(new Date(Date.now()+3600000));
  assert.equal((await events().findOne({_id:second.reference})).notificationDelivery.state,'done');
  // A notification survives a crash between inbox insertion and channel insertion.
  const originalUpdate=dc.updateOne;let queueFailure=true;
  dc.updateOne=function(...args){if(queueFailure){queueFailure=false;return Promise.reject(new Error('Injected delivery insert failure'));}return originalUpdate.apply(this,args);};
  await assert.rejects(notify(member.id,'circle-invite',{name:'Recovery'},'queue-gap'));
  dc.updateOne=originalUpdate;
  const pending=await nc.findOne({recipient:member.id,dedupeKey:'queue-gap'});assert.equal(pending.queueState,'pending');
  await repairNotificationQueues();
  assert.equal(await dc.countDocuments({notification:pending._id,channel:'email'}),1);
  await Promise.all(Array.from({length:5},()=>notify(member.id,'circle-invite',{name:'Recovery'},'queue-gap')));
  assert.equal(await nc.countDocuments({recipient:member.id,dedupeKey:'queue-gap'}),1);
  assert.equal(await dc.countDocuments({notification:pending._id,channel:'email'}),1);
  await deliveryCycle(new Date(Date.now()+3600000),100);
  const delivered=await dc.findOne({notification:pending._id});assert.equal(delivered.state,'sent');
  await notify(member.id,'circle-invite',{name:'Recovery'},'queue-gap');assert.equal((await dc.findOne({_id:delivered._id})).state,'sent');
  assert.equal(sent.filter(row=>row.key===delivered._id).length,1);
  // Pagination has stable boundaries, including equal timestamps.
  await nc.insertMany(Array.from({length:35},(_,i)=>({_id:randomUUID(),recipient:member.id,kind:'circle-update',title:'Page '+i,body:'',link:'/circle',priority:'normal',createdAt:new Date(),readAt:null,acknowledgedAt:null})));
  const page1=await call('individual/notifications?page=1',{token:member.token}),page2=await call('individual/notifications?page=2',{token:member.token});
  assert.equal(page1.pageSize,30);assert.equal(page1.items.length,30);assert(page1.hasNext);assert.equal(page2.page,2);assert.equal(page2.totalPages,Math.ceil(page2.total/30));
  assert(!page2.items.some(row=>page1.items.some(first=>first.id===row.id)));
  assert.equal((await call('individual/notifications?page=1',{token:member.token})).items[0].id,page1.items[0].id);
  console.log('Incident replay, queue repair, contact dedupe, private location details, pagination and fake-provider delivery passed.');
} finally {
  await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>provider.close(resolve));
  await mongoose.connection.dropDatabase();await mongoose.disconnect();
}
