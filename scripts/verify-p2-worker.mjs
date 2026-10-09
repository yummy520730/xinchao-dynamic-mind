// Optional integration harness, no app dependency: use a separate pinned
// Miniflare install and an audited xiaowo-app checkout. Failure never becomes
// a mock success. This is local workerd, not deployed Cloudflare/browser E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as httpsServer } from 'node:https';
import { request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const modulePath = process.env.P2_MINIFLARE_MODULE;
const workerRoot = process.env.P2_XIAOWO_ROOT;
let Miniflare;
if (modulePath) ({ Miniflare } = await import(pathToFileURL(resolve(modulePath)).href));
test('REAL unchanged Owner Worker → TLS → P2 runtime → Snapshot', {
  skip: !Miniflare || !workerRoot ? 'NOT_RUN: set P2_MINIFLARE_MODULE and P2_XIAOWO_ROOT' : false, timeout: 45000,
}, async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'p2-worker-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise((r)=>probe.close(r));
  const base=`http://127.0.0.1:${port}`,key='d'.repeat(64),channel='p2-worker-owner-channel-test-independent',service='p2-worker-service-token-test-independent',owner='p2-worker-owner-test';
  const child=spawn(process.execPath,['src/server.js'],{env:{PATH:process.env.PATH,PORT:String(port),SERVICE_TOKEN:service,
    STATE_PATH:join(dir,'state.json'),TRANSITION_JOURNAL_PATH:join(dir,'journal.jsonl'),OAUTH_STATE_PATH:join(dir,'oauth.json'),AI_OUTBOX_PATH:join(dir,'outbox.json'),
    CORE_AXES_V4_ENABLED:'true',MOOD_V4_ENABLED:'true',MIXED_FEELINGS_V4_ENABLED:'true',EMOTION_V4_ENABLED:'true',
    SHADOW_OWNER_INGRESS_ENABLED:'true',SHADOW_OWNER_INGRESS_TOKEN:channel,SHADOW_OWNER_EVIDENCE_KEY:key,
    FAVORED_SHADOW_ENABLED:'false',EMPATHY_SHADOW_ENABLED:'false',MODEL_ENABLED:'false',MEMORY_READ_ENABLED:'false',MEMORY_WRITE_ENABLED:'false',
    BARK_ENABLED:'false',NTFY_ENABLED:'false',SELF_SIGNAL_ENABLED:'false',BRIDGE_ENABLED:'false',DAYTIME_EMERGENCE_ENABLED:'false',SETTLE_INTERVAL_MINUTES:'1440'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',(d)=>output+=d);child.stderr.on('data',(d)=>output+=d);
  t.after(async()=>{if(child.exitCode==null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}});
  let ready=false;for(let i=0;i<200;i++){assert.equal(child.exitCode,null,output);try{if(output.includes('"event":"service_started"') && (await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise((r)=>setTimeout(r,30));}assert.ok(ready);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1',
    '-keyout',join(dir,'tls.key'),'-out',join(dir,'tls.crt')],{stdio:'ignore'});
  const cert=await readFile(join(dir,'tls.crt'),'utf8');
  const proxy=httpsServer({key:await readFile(join(dir,'tls.key')),cert},(req,res)=>{
    const upstream=request(base+req.url,{method:req.method,headers:req.headers},(reply)=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    upstream.on('error',()=>{res.writeHead(503);res.end();});req.pipe(upstream);
  });proxy.listen(0,'127.0.0.1');await once(proxy,'listening');t.after(()=>new Promise((r)=>proxy.close(r)));
  const mf=new Miniflare({modules:true,modulesRoot:join(resolve(workerRoot),'worker/cloudflare'),scriptPath:join(resolve(workerRoot),'worker/cloudflare/xiaowo-worker.mjs'),compatibilityDate:'2026-07-01',host:'127.0.0.1',port:0,
    bindings:{API_TOKEN:owner,XINCHAO_BASE_URL:`https://127.0.0.1:${proxy.address().port}`,XINCHAO_SERVICE_TOKEN:service,
      SHADOW_CONFIRMATIONS_ENABLED:'1',SHADOW_OWNER_INGRESS_TOKEN:channel,SHADOW_OWNER_EVIDENCE_KEY:key},
    outboundService:{network:{allow:['127.0.0.1/32'],tlsOptions:{trustedCertificates:[cert],trustBrowserCas:false}}}});
  t.after(()=>mf.dispose());const url=(await mf.ready).toString().replace(/\/$/,'');
  const submit=async(input,token=owner)=>fetch(url+'/api/mind-v2/confirmations',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(input)});
  const e={request_id:randomUUID(),choice:'reassurance',subject_id:randomUUID(),incident_id:randomUUID(),occurred_at:new Date().toISOString(),closeness:'her',confirmed:true};
  assert.equal((await submit(e,'wrong-owner')).status,401);
  const replies=await Promise.all(Array.from({length:8},()=>submit(e)));for(const r of replies)assert.equal(r.status,200);
  const state=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));assert.equal(state.coreAxesV4.sourceCount,1);
  assert.ok(state.coreAxesV4.security>.62&&state.coreAxesV4.security<=.645);assert.equal(state.emotionV4,undefined);assert.equal(state.favoredShadow,undefined);
  assert.equal((await submit({...e,choice:'chosen'})).status,409);assert.equal((await submit({...e,text:'p2-private-sentinel'})).status,422);
  const dash=await(await fetch(url+'/api/mind-v2/snapshot',{headers:{authorization:`Bearer ${owner}`}})).json();assert.equal(dash.schemaVersion,1);
  assert.equal(dash.affectV4.version,1);assert.equal(dash.affectV4.coreAxes.sourceCount,1);assert.equal(dash.affectV4.mood.status,'insufficient_data');
  for(const secret of [key,channel,e.request_id,e.subject_id,e.incident_id,'p2-private-sentinel','signature','receipts']){
    assert.ok(!JSON.stringify(dash.affectV4).includes(secret));assert.ok(!output.includes(secret));
  }
});
