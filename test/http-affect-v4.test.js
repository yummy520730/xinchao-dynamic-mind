import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { signEvidence } from '../src/owner-evidence.js';
const hash=(s)=>createHash('sha256').update(s).digest('hex');

// Real HTTP + runtime + disk/restart. Proof is a labeled Owner-wire fixture,
// not a real human confirmation or deployed Cloudflare/production test.
test('P2 real HTTP: signed admission, retries, privacy, read purity, P0 and restart/rollback', async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),'p2-http-'));
  const service='p2-http-generic-service-independent-token',channel='p2-http-owner-channel-independent-token',key='c'.repeat(64);
  let child,output='';
  const stop=async()=>{if(child&&child.exitCode==null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}};
  t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
  async function launch(enabled=true){
    const outputStart=output.length;
    const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;
    await new Promise((resolve)=>probe.close(resolve));
    child=spawn(process.execPath,['src/server.js'],{env:{PATH:process.env.PATH,PORT:String(port),SERVICE_TOKEN:service,
      STATE_PATH:join(dir,'state.json'),TRANSITION_JOURNAL_PATH:join(dir,'transitions.jsonl'),OAUTH_STATE_PATH:join(dir,'oauth.json'),AI_OUTBOX_PATH:join(dir,'outbox.json'),
      MEMORY_HEARTBEAT_FILE:join(dir,'missing.json'),CORE_AXES_V4_ENABLED:String(enabled),MOOD_V4_ENABLED:String(enabled),MIXED_FEELINGS_V4_ENABLED:String(enabled),
      SHADOW_OWNER_INGRESS_ENABLED:'true',SHADOW_OWNER_INGRESS_TOKEN:channel,SHADOW_OWNER_EVIDENCE_KEY:key,
      FAVORED_SHADOW_ENABLED:'false',EMPATHY_SHADOW_ENABLED:'false',EMOTION_V4_ENABLED:'true',DASHBOARD_INCLUDE_PRIVATE_TEXT:'true',
      MODEL_ENABLED:'false',MEMORY_READ_ENABLED:'false',MEMORY_WRITE_ENABLED:'false',SELF_SIGNAL_ENABLED:'false',BARK_ENABLED:'false',NTFY_ENABLED:'false',
      BRIDGE_ENABLED:'false',MCP_ENABLED:'false',OAUTH_ENABLED:'false',DAYTIME_EMERGENCE_ENABLED:'false',DREAM_NIGHT_MODE:'off',SETTLE_INTERVAL_MINUTES:'1440'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',(d)=>output+=d);child.stderr.on('data',(d)=>output+=d);
    const url=`http://127.0.0.1:${port}`;const deadline=Date.now()+10000;
    while(Date.now()<deadline){assert.equal(child.exitCode,null,output);try{if(output.slice(outputStart).includes('"event":"service_started"') && (await fetch(url+'/health')).ok)return url;}catch{}
      await new Promise((r)=>setTimeout(r,30));}
    throw Error('test runtime did not become ready');
  }
  let url=await launch();const now=new Date();
  const e={schema_version:1,event_id:hash('p2-http-event'),evidence_ref:hash('p2-http-proof'),event_type:'favored_relief',source:'owner_confirmation',
    occurred_at:now.toISOString(),subject_ref:hash('owner'),incident_ref:hash('incident'),reason:'reassurance'};
  const request=async(path,body,token=service)=>fetch(url+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const saved=async()=>JSON.parse(await readFile(join(dir,'state.json'),'utf8'));
  const proof=await signEvidence(e,'event',key,now),original=await saved();
  assert.equal((await request('/v1/owner-shadow/events',proof,service)).status,401);
  assert.equal((await request('/v1/owner-shadow/events',{...proof,data:{...e,reason:'chosen'}},channel)).status,422);
  assert.deepEqual(await saved(),original);
  const admitted=await Promise.all(Array.from({length:8},async()=>{const r=await request('/v1/owner-shadow/events',proof,channel);assert.equal(r.status,200);return r.json();}));
  assert.equal(admitted.filter((r)=>r.affect_settled).length,1);let s=await saved();assert.equal(s.coreAxesV4.sourceCount,1);
  assert.deepEqual(s.drives,original.drives);assert.equal(s.emotionV4,undefined);assert.equal(s.favoredShadow,undefined);
  const afterAxis=structuredClone(s.coreAxesV4);
  for(const [i,type]of ['conflict','companionship','reconciliation'].entries()){
    const r=await request('/v1/conversation-event',{event_id:'p2-p0-'+i,interaction_type:type});assert.equal(r.status,200);
    const dash=await(await request('/v1/dashboard/snapshot')).json();assert.equal(dash.emotion.shown,['不安','不安','释然'][i]);
  }
  s=await saved();assert.deepEqual(s.coreAxesV4,afterAxis);assert.equal(s.moodV4.buckets.length,1);assert.equal(Object.keys(s.drives).length,12);
  const beforeReads=await readFile(join(dir,'state.json'),'utf8');
  for(let i=0;i<3;i++){
    const dash=await(await request('/v1/dashboard/snapshot')).json();assert.equal(dash.schemaVersion,1);assert.equal(dash.affectV4.version,1);
    assert.equal(dash.affectV4.mood.status,'insufficient_data');assert.ok(dash.emotion.marks.some((m)=>m.why==='conflict'));
    const state=await(await request('/v1/state')).json();assert.equal(state.coreAxesV4.receipts,undefined);
    const context=await request('/v1/context?mode=inspect&session_id=p2-test');assert.equal(context.status,200);
    for(const body of [JSON.stringify(dash.affectV4),JSON.stringify(state.coreAxesV4),await context.text()])for(const secret of [key,channel,e.event_id,e.evidence_ref,e.subject_ref,e.incident_ref])assert.ok(!body.includes(secret));
  }
  assert.equal(await readFile(join(dir,'state.json'),'utf8'),beforeReads);
  const p2before=await saved();await request('/v1/heartbeat',{event_id:'p2-heartbeat',session_id:'cc'});const heartbeat=await saved();
  for(const field of ['coreAxesV4','moodV4','mixedFeelingsV4'])assert.deepEqual(heartbeat[field],p2before[field]);
  await stop();url=await launch();const retry=await(await request('/v1/owner-shadow/events',await signEvidence(e,'event',key),channel)).json();
  assert.equal(retry.affect_settled,false);assert.equal(retry.affect_reason,'duplicate');assert.equal((await saved()).coreAxesV4.sourceCount,1);
  await stop();url=await launch(false);const rollback=await(await request('/v1/dashboard/snapshot')).json();assert.equal(rollback.affectV4,undefined);
  const off=await(await request('/v1/owner-shadow/events',await signEvidence(e,'event',key),channel)).json();assert.equal(off.reason,'disabled');
  assert.equal((await saved()).coreAxesV4.sourceCount,1);assert.doesNotMatch(output,new RegExp(key+'|'+channel+'|'+e.evidence_ref));
});
