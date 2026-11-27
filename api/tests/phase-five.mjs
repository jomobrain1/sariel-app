// Run after building the API. Uses a local fake Gemini server; no real provider is called.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import mongoose from 'mongoose';
import { bootstrapTenancy } from '@tilcayo/auth';
process.env.AUTH_ACCESS_SECRET=randomUUID()+randomUUID();
process.env.AUTH_REFRESH_SECRET=randomUUID()+randomUUID();
process.env.TENANCY_BASE_DOMAIN='localhost';
process.env.SARIEL_WORKERS='off';
delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY;

// ── Fake Gemini ──────────────────────────────────────────────
const gemini={calls:[],script:[],fail:0};
const fake=createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const body=raw?JSON.parse(raw):{};gemini.calls.push({path:req.url,key:req.headers['x-goog-api-key'],body});
  res.setHeader('content-type','application/json');
  if(gemini.fail>0){gemini.fail--;res.statusCode=500;return res.end(JSON.stringify({error:{message:'boom'}}));}
  if(req.headers['x-goog-api-key']!=='gemini-test-key'){res.statusCode=403;return res.end(JSON.stringify({error:{message:'API key not valid'}}));}
  if(req.url.includes(':batchEmbedContents'))
    return res.end(JSON.stringify({embeddings:body.requests.map(r=>({values:embedText(r.content.parts[0].text)}))}));
  if(body.generationConfig?.responseModalities?.includes('IMAGE'))
    return res.end(JSON.stringify({candidates:[{content:{role:'model',parts:[{inlineData:{mimeType:'image/png',data:globalThis.fakeImage}}]}}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:1290}}));
  const next=gemini.script.shift()??{text:'OK'};
  const parts=typeof next==='function'?next(body):next.parts??[{text:next.text}];
  res.end(JSON.stringify({candidates:[{content:{role:'model',parts},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}}));
});});
// Deterministic toy embedding: word buckets, so related texts land near each other.
function embedText(text){const v=new Array(16).fill(0);for(const w of text.toLowerCase().match(/[a-z]+/g)??[]){let h=0;for(const c of w)h=(h*31+c.charCodeAt(0))%16;v[h]+=1;}const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
fake.listen(0);await once(fake,'listening');
process.env.GEMINI_BASE_URL='http://127.0.0.1:'+fake.address().port;
globalThis.fakeImage='';

await mongoose.connect(process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017', {dbName:'sariel_test_'+randomUUID().replaceAll('-','')});
const {default:app}=await import('../dist/app.js');
const server=app.listen(0);
await once(server,'listening');
export async function call(path,{method='GET',body,token,status=200}={}){
  const response=await new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/'+path,method,headers:{host:'localhost','content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},resolve);
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  let raw='';for await(const chunk of response)raw+=chunk;
  assert.equal(response.statusCode,status,method+' '+path+' returned '+response.statusCode+' '+raw.slice(0,300));return raw?JSON.parse(raw).data:null;
}
const post=(path,body,options={})=>call(path,{method:'POST',body,...options});
const put=(path,body,options={})=>call(path,{method:'PUT',body,...options});
const password=randomUUID();
async function login(email){return (await post('auth/login',{email,password})).tokens.accessToken;}
async function person(name){const email=name.toLowerCase()+'@example.test';await post('auth/register',{name,email,password},{status:201});
  const l=await post('auth/login',{email,password});return {name,email,token:l.tokens.accessToken,id:l.user.id};}

try {
  await bootstrapTenancy({email:'admin@example.test',password});
  const admin=await login('admin@example.test');
  const alice=await person('Alice'), bob=await person('Bob');

  // ── AI providers and settings ─────────────────────────────
  await call('platform/ai',{token:alice.token,status:403});
  let ai=await call('platform/ai',{token:admin});
  assert.equal(ai.chat.provider,'gemini');
  assert.equal(ai.keys.gemini.configured,false);
  assert.deepEqual(ai.providers.find(p=>p.id==='anthropic').capabilities,['chat']);
  // Without a key, AI is unavailable rather than failing obscurely.
  assert.equal((await post('platform/ai/test',{capability:'chat'},{token:admin})).ok,false);
  // Providers can only be chosen for what they support.
  const settings={chat:ai.chat,embeddings:ai.embeddings,images:ai.images,dailyLimit:5};
  await put('platform/ai',{...settings,images:{provider:'anthropic',model:'claude-opus-5-5'}},{token:admin,status:422});
  ai=await put('platform/ai',settings,{token:admin});
  assert.equal(ai.dailyLimit,5);

  // Keys are stored encrypted and never returned.
  ai=await put('platform/ai/keys/gemini',{apiKey:'gemini-test-key'},{token:admin});
  assert.deepEqual(ai.keys.gemini,{configured:true,source:'stored',hint:'••••-key'});
  const stored=await mongoose.connection.collection('sariel_ai_settings').findOne({_id:'ai'});
  assert(!JSON.stringify(stored).includes('gemini-test-key'));
  let test=await post('platform/ai/test',{capability:'chat'},{token:admin});
  assert.equal(test.ok,true);assert.equal(test.detail,'OK');
  assert.equal(gemini.calls.at(-1).key,'gemini-test-key');
  assert.match(gemini.calls.at(-1).path,/gemini-2\.5-flash:generateContent/);
  test=await post('platform/ai/test',{capability:'embeddings'},{token:admin});
  assert.equal(test.detail,'16 dimensions');
  // Provider failures are reported, not thrown at the admin.
  gemini.fail=1;
  assert.equal((await post('platform/ai/test',{capability:'chat'},{token:admin})).ok,false);
  // Switching the chat model takes effect immediately.
  await put('platform/ai',{...settings,chat:{provider:'gemini',model:'gemini-2.5-pro'}},{token:admin});
  await post('platform/ai/test',{capability:'chat'},{token:admin});
  assert.match(gemini.calls.at(-1).path,/gemini-2\.5-pro:generateContent/);
  await put('platform/ai',settings,{token:admin});

  const report=await call('platform/ai/usage?days=7',{token:admin});
  const chatRow=report.byCapability.find(r=>r.capability==='chat'&&r.model==='gemini-2.5-flash');
  assert(chatRow.requests>=2);assert(chatRow.failures>=1);assert(chatRow.input>=100);
  console.log('Phase 5 AI provider checks passed.');

  globalThis.phase5={call,post,put,admin,alice,bob,gemini,mongoose,settings,embedText};
  // Later sections are appended below as features land.
}finally{
  await new Promise(resolve=>server.close(resolve));
  fake.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
