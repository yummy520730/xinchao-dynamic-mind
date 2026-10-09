import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newState, settleState, settleAndApplyConversationEvent, applyMemoryResonance } from '../src/engine.js';
import { loadConfig } from '../src/config.js';
import { StateStore } from '../src/state-store.js';
import { createOwnerShadowIngress } from '../src/owner-shadow-ingress.js';
import { signEvidence } from '../src/owner-evidence.js';
import { buildDashboardSnapshot } from '../src/dashboard-projection.js';
import { buildContextEnvelope } from '../src/context-envelope.js';
import { projectCoreAxesV4, reduceVerifiedCoreAxesV4, CORE_AXES_POLICY } from '../src/core-axes-v4.js';
import { recordMoodV4, projectMoodV4 } from '../src/mood-v4.js';
import { recordMixedFeelingsV4, projectMixedFeelingsV4 } from '../src/mixed-feelings-v4.js';
import { recordEmotionV4, projectEmotionV4 } from '../src/emotion-v4.js';
import { redactAffectAudit, pruneAffectAudit } from '../src/affect-v4.js';
import { shadowReceiptRef } from '../src/relationship-shadow.js';
const start = new Date('2026-10-09T02:00:00.000Z');
const at = (hours) => new Date(start.getTime() + hours * 3_600_000);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const opts = { coreAxesEnabled: true, moodEnabled: true, mixedFeelingsEnabled: true, timeZone: 'Asia/Shanghai' };
const key = 'b'.repeat(64), token = 'p2-owner-channel-independent-test-token';
function event(id = 'first', reason = 'reassurance', occurred = start) {
  return { schema_version: 1, event_id: hash(id), evidence_ref: hash('proof:' + id), event_type: 'favored_relief',
    source: 'owner_confirmation', occurred_at: occurred.toISOString(), subject_ref: hash('owner'), incident_ref: hash(id), reason };
}
function reduce(state, e, now = start, options = opts) { return reduceVerifiedCoreAxesV4(state,e,now,options); }
async function fixture(t, shadow = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'p2-unit-')); t.after(() => rm(dir, { recursive:true,force:true }));
  const path = join(dir,'state.json'), store = new StateStore(path, () => newState(start)); await store.write(newState(start));
  const config = { store, enabled:true, token, evidenceKey:key, serviceToken:'other-service-token-at-least-32-chars',
    options: { favoredEnabled:false, empathyEnabled:false,timeZone:'Asia/Shanghai', ...shadow }, affectOptions:opts };
  const handle = createOwnerShadowIngress(config);
  const send = async(e, now = start, purpose = 'event') => handle(purpose, await signEvidence(e,purpose,key,now),token,now);
  return { store, send, path, config };
}
function tension(kind = 'conflict', time = start) {
  return { drives: { possess:.8, monitor:.7, grieve:.4 }, emotionV4:recordEmotionV4(null,kind,time) };
}

test('three flags default OFF, legacy state and snapshots remain byte-equivalent', () => {
  const names = ['CORE_AXES_V4_ENABLED','MOOD_V4_ENABLED','MIXED_FEELINGS_V4_ENABLED'];
  const saved = names.map((n) => process.env[n]); names.forEach((n) => delete process.env[n]);
  try { assert.deepEqual(loadConfig().affectV4, { coreAxesEnabled:false,moodEnabled:false,mixedFeelingsEnabled:false }); }
  finally { names.forEach((n,i) => saved[i] === undefined ? delete process.env[n] : process.env[n] = saved[i]); }
  const s = newState(start), before = structuredClone(s);
  assert.equal(reduce(s,event(),start,{}).reason,'disabled'); assert.deepEqual(s,before);
  assert.equal(buildDashboardSnapshot(s,{},start).affectV4,undefined);
  assert.equal(Object.keys(s.drives).length,12);
});

test('axes baseline is independent, bounded and modeled provenance explicit', () => {
  const p = projectCoreAxesV4(undefined,start); assert.equal(p.security.value,.62);assert.equal(p.confidence.value,.60);
  assert.equal(p.status,'baseline'); assert.equal(p.lastUpdatedAt,null);
  const s = newState(start);reduce(s,event());
  assert.equal(projectCoreAxesV4(s.coreAxesV4,start).status,'owner_report_model');
  assert.equal(s.coreAxesV4.security,.645);assert.equal(s.coreAxesV4.confidence,.6);
  assert.equal(CORE_AXES_POLICY.min,.05);assert.equal(CORE_AXES_POLICY.max,.95);
  const high = { ...s.coreAxesV4,security:.949 };s.coreAxesV4=high;reduce(s,event('two','chosen'));
  assert.equal(s.coreAxesV4.security,.95);
});

test('signed facts change axes with Shadow OFF, never drives/emotion/P1/sleep', async(t) => {
  const {store,send}=await fixture(t);let s=await store.read();s.consciousness='sleeping';await store.write(s);const before=await store.read();
  const r=await send(event());assert.equal(r.body.shadow_settled,false);assert.equal(r.body.affect_settled,true);
  s=await store.read();delete s.coreAxesV4;assert.deepEqual(s,before);
});

test('Owner authentication and bound evidence are mandatory even for P2', async(t) => {
  const {config,store}=await fixture(t);const handle=createOwnerShadowIngress(config),proof=await signEvidence(event(),'event',key,start);
  assert.equal((await handle('event',proof,'generic-service',start)).status,401);
  assert.equal((await handle('event',{...proof,data:{...proof.data,reason:'chosen'}},token,start)).status,422);
  assert.equal((await handle('event',{...proof,signature:'f'.repeat(64)},token,start)).status,422);
  assert.equal((await handle('event',proof,token,at(1))).status,422);
  assert.equal((await store.read()).coreAxesV4,undefined);
});

test('completed helping report is confidence input; empathy intention is not success', () => {
  const s=newState(start),base=event();delete base.reason;Object.assign(base,{event_type:'helped',empathy_type:'care',closeness:'unknown'});
  assert.equal(reduce(s,base).applied,true);assert.equal(s.coreAxesV4.confidence,.62);
  const e={...base,event_id:hash('intent'),event_type:'empathy',incident_ref:hash('intent')};
  assert.equal(reduce(s,e).reason,'unsupported_event');assert.equal(s.coreAxesV4.confidence,.62);
});

test('explicit harm lowers security without interpreting generic conflict/anger as harm', () => {
  const s=newState(start);assert.equal(reduce(s,{...event(),'event_type':'favored_hurt',reason:'broken_promise'}).applied,true);
  assert.equal(s.coreAxesV4.security,.59);assert.equal(s.coreAxesV4.confidence,.60);
  const old=structuredClone(s.coreAxesV4);const next=settleAndApplyConversationEvent(s,{eventId:'conflict',interactionType:'conflict'},at(1),{interaction:{emotionV4Enabled:true,affectV4:opts}}).state;
  assert.deepEqual(next.coreAxesV4,old);
});

test('canonical/semantic retry never reapplies, refreshes timestamp or collects next-day budget', () => {
  const s=newState(start),e=event();reduce(s,e);const before=structuredClone(s);
  assert.equal(reduce(s,e,at(1)).reason,'duplicate');assert.deepEqual(s,before);
  assert.equal(reduce(s,{...e,event_id:hash('alias')},at(2)).reason,'duplicate');
  assert.equal(s.coreAxesV4.sourceCount,1);assert.equal(s.coreAxesV4.lastEffectiveAt,start.toISOString());
  assert.equal(reduce(s,e,at(20)).reason,'duplicate');assert.equal(s.coreAxesV4.daily.events,1);
  assert.equal(reduce(s,{...e,subject_ref:hash('different')},at(2)).reason,'event_mismatch');
});

test('concurrent retries and restart share runtime StateStore exactly once', async(t) => {
  const {send,store,path,config}=await fixture(t);const e=event();
  const replies=await Promise.all(Array.from({length:12},()=>send(e)));
  assert.equal(replies.filter((r)=>r.body.affect_settled).length,1);assert.equal((await store.read()).coreAxesV4.sourceCount,1);
  const restart=createOwnerShadowIngress({...config,store:new StateStore(path,()=>{throw Error('no factory');})});
  assert.equal((await restart('event',await signEvidence(e,'event',key,at(1)),token,at(1))).body.affect_reason,'duplicate');
});

test('72h decay is read-only, delay-discounted and independent of sampling frequency', () => {
  const s=newState(start);reduce(s,event());const before=structuredClone(s);
  assert.equal(projectCoreAxesV4(s.coreAxesV4,at(72)).security.value,.6325);
  for(let h=1;h<72;h++)projectCoreAxesV4(s.coreAxesV4,at(h));assert.deepEqual(s,before);
  const delayed=newState(start);reduce(delayed,event(),at(24));
  assert.equal(projectCoreAxesV4(delayed.coreAxesV4,at(72)).security.value,.6325);
  const direct=newState(start),split=newState(start);reduce(direct,event());reduce(split,event());
  reduce(direct,event('later','chosen',at(12)),at(12));
  for(let h=1;h<12;h++)reduce(split,{...event('noop'+h,'chosen',at(h)),event_type:'empathy',empathy_type:'joy',closeness:'unknown',reason:undefined},at(h));
  reduce(split,event('later','chosen',at(12)),at(12));
  assert.equal(projectCoreAxesV4(direct.coreAxesV4,at(72)).security.value,projectCoreAxesV4(split.coreAxesV4,at(72)).security.value);
});

test('future, stale, rollback and unsupported versions cannot pollute axes', () => {
  const s=newState(start);reduce(s,event());const before=structuredClone(s);
  assert.equal(reduce(s,event('future','chosen',at(2)),at(1)).reason,'event_time_invalid');
  assert.equal(reduce(s,event('stale'),at(25)).reason,'event_time_invalid');
  assert.equal(reduce(s,event('clock','chosen',at(-1)),at(-1)).reason,'clock_regression');assert.deepEqual(s,before);
  assert.equal(projectCoreAxesV4(s.coreAxesV4,at(-1)).status,'clock_regression');
  s.coreAxesV4.version=2;assert.equal(reduce(s,event('new')).reason,'unsupported_state');
});

test('out-of-order occurrences accepted at current admission with delay decay; no historical rewrite', () => {
  const s=newState(start);reduce(s,event('now','chosen',at(2)),at(2));
  reduce(s,event('delayed','reassurance',at(1)),at(3));
  assert.equal(s.coreAxesV4.lastEffectiveAt,at(3).toISOString());
  const expected=.62+.025*2**(-1/72)+.025*2**(-2/72);
  assert.ok(Math.abs(s.coreAxesV4.security-expected)<1e-12);
});

test('absolute daily budget cannot be offset by opposite signs or semantic retries across midnight', () => {
  const s=newState(start);for(let i=0;i<4;i++)assert.equal(reduce(s,event('r'+i,'reconciliation')).applied,true);
  const denied={...event('denied'),event_type:'favored_hurt',reason:'broken_promise'};assert.equal(reduce(s,denied).reason,'daily_limit');
  assert.equal(reduce(s,denied,at(14)).reason,'duplicate');assert.equal(s.coreAxesV4.sourceCount,4);
  assert.equal(reduce(s,event('fresh','reassurance',at(14)),at(14)).applied,true);assert.equal(s.coreAxesV4.daily.events,1);
  assert.equal(reduce(s,event('zone','chosen',at(14)),at(14),{...opts,timeZone:'UTC'}).reason,'budget_policy_changed');
});

test('6h semantic and 24h input / 48h receipt boundaries; no stale replay', () => {
  const s=newState(start),e=event();reduce(s,e);
  assert.equal(reduce(s,{...e,event_id:hash('early')},at(5.999)).reason,'duplicate');
  assert.equal(reduce(s,{...e,event_id:hash('boundary'),occurred_at:at(6).toISOString()},at(6)).applied,true);
  assert.equal(reduce(s,event('exact'),at(24)).applied,true);
  const keyFirst=s.coreAxesV4.receipts[0].key;
  reduce(s,event('retire','chosen',at(48)),at(48));assert.ok(!s.coreAxesV4.receipts.some((r)=>r.key===keyFirst));
  assert.equal(reduce(s,e,at(48)).reason,'event_time_invalid');
});

test('P1.5 unknown revision does not replay axes or mutate P0; independent ledger not overwritten', async(t) => {
  const {send,store}=await fixture(t,{empathyEnabled:true});const e=event('empathy');delete e.reason;
  Object.assign(e,{event_type:'empathy',empathy_type:'care',closeness:'unknown'});await send(e);
  const before=await store.read();const revision={schema_version:1,revision_id:hash('revision'),receipt_ref:shadowReceiptRef(e.event_id),closeness:'family',relationship_ref:hash('family')};
  assert.equal((await send(revision,at(1),'closeness')).body.reason,'closeness_revised');
  const after=await store.read();assert.deepEqual(after.coreAxesV4,before.coreAxesV4);assert.deepEqual(after.drives,before.drives);
  assert.equal((await send(revision,at(2),'closeness')).body.reason,'duplicate_revision');
});

test('P1 identity conflicts atomically prevent P2 admissions', async(t) => {
  const {send,store}=await fixture(t,{favoredEnabled:true});const e=event();const admission=await send(e);assert.equal(admission.body.affect_settled,true);
  const before=await store.read();const wrong={...e,reason:'chosen'};assert.equal((await send(wrong,at(1))).body.reason,'event_mismatch');
  assert.deepEqual(await store.read(),before);
});

test('mood insufficient samples remain null; reads do not create coverage', () => {
  let s=recordMoodV4(null,{valence:.8},start);const before=structuredClone(s);
  for(let i=0;i<10;i++){const p=projectMoodV4(s,at(1));assert.equal(p.value,null);assert.equal(p.status,'insufficient_data');}
  assert.deepEqual(s,before);assert.equal(projectMoodV4(undefined,start).value,null);
});

test('hour sampling resists chat density; equal rolling-day weights across midnight', () => {
  let s;for(let h=0;h<72;h++){
    const v=h<24?.2:h<48?.6:.8;s=recordMoodV4(s,{valence:v},at(h));
    for(let i=1;i<10;i++)s=recordMoodV4(s,{valence:1},new Date(at(h).getTime()+i*1000));
  }
  const p=projectMoodV4(s,at(71.003));assert.equal(s.buckets.length,72);assert.equal(p.status,'available');
  assert.ok(Math.abs(p.value-(.2+.6+.8)/3)<1e-6);assert.equal(p.trend,'brightening');assert.equal(p.coverage,1);
  assert.deepEqual(p.periods.map((r)=>r.sampledHours),[24,24,24]);
  s=recordMoodV4(s,{valence:.4},at(72));assert.equal(s.buckets.length,72);assert.equal(s.buckets[0].hour,at(1).getTime());
});

test('a dense single day or clustered sparse hours cannot masquerade as three complete days', () => {
  let s;for(let h=48;h<72;h++)s=recordMoodV4(s,{valence:.9},at(h));assert.equal(projectMoodV4(s,at(71)).value,null);
  let sparse;for(let h=0;h<72;h+=12)sparse=recordMoodV4(sparse,{valence:.9},at(h));assert.equal(projectMoodV4(sparse,at(71)).status,'insufficient_data');
  assert.equal(projectMoodV4(s,at(144)).sampledHours,0);
});

test('mood preserves bounded data on backward clocks and rejects future state versions', () => {
  const s=recordMoodV4(null,{valence:.4},at(1));assert.deepEqual(recordMoodV4(s,{valence:.8},start),s);
  assert.equal(projectMoodV4(s,start).status,'clock_regression');assert.equal(projectMoodV4({...s,version:2},at(2)).status,'unsupported_state');
});

test('mixed conditions need real P0 negative basis and positive drive; Shadow and anger alone are excluded', () => {
  for(const state of [{drives:{possess:.9,anger:.8},favoredShadow:{candidate:.9}},
    {...tension(),drives:{possess:.2,monitor:.2}}, {...tension(),emotionV4:recordEmotionV4(null,'companionship',start)}]) {
    const s=recordMixedFeelingsV4(null,state,start);assert.equal(projectMixedFeelingsV4(s,state,at(1)).active,false);assert.equal(s.episode,null);
  }
});

test('two observations spanning 20min confirm mixed; repeated reads cannot start/confirm/reset it', () => {
  const state=tension(),s=recordMixedFeelingsV4(null,state,start),before=structuredClone(s);
  assert.equal(projectMixedFeelingsV4(s,state,at(.34)).status,'candidate');assert.deepEqual(s,before);
  const early=recordMixedFeelingsV4(s,state,at(19/60));assert.equal(early.episode.confirmed,false);
  const confirmed=recordMixedFeelingsV4(early,state,at(20/60));const p=projectMixedFeelingsV4(confirmed,state,at(20/60));
  assert.equal(p.active,true);assert.equal(p.name,'不安，也想靠近');assert.equal(confirmed.episode.since,start.toISOString());
  assert.equal(projectMixedFeelingsV4(confirmed,state,at(1)).active,false);
});

test('reconciliation ends mixed without deleting conflict marks; only new negative basis may rearm', () => {
  let state=tension(),s=recordMixedFeelingsV4(null,state,start);s=recordMixedFeelingsV4(s,state,at(.34));
  state={...state,emotionV4:recordEmotionV4(state.emotionV4,'reconciliation',at(.4))};s=recordMixedFeelingsV4(s,state,at(.4));
  assert.equal(projectMixedFeelingsV4(s,state,at(.4)).status,'relieved');assert.equal(projectEmotionV4(state.emotionV4,at(.4)).shown,'释然');
  assert.ok(projectEmotionV4(state.emotionV4,at(23)).marks.some((m)=>m.why==='conflict'));
  state=tension('conflict',at(.5));s=recordMixedFeelingsV4(s,state,at(.5));assert.equal(s.episode.since,at(.5).toISOString());
});

test('six-hour episode ceiling survives code changes, periodic calculations and restart', () => {
  let state=tension(),s=recordMixedFeelingsV4(null,state,start);
  for(let i=1;i<=18;i++) { const now=at(i/3);state={...state,emotionV4:recordEmotionV4(state.emotionV4,i%2?'loss':'conflict',now)};s=recordMixedFeelingsV4(s,state,now); }
  assert.equal(s.episode.status,'timed_out');assert.equal(s.episode.since,start.toISOString());
  s=JSON.parse(JSON.stringify(s));state=tension('loss',at(7));s=recordMixedFeelingsV4(s,state,at(7));
  assert.equal(s.episode.since,start.toISOString());assert.equal(projectMixedFeelingsV4(s,state,at(7)).active,false);
});

test('grieve/loss tension has distinct semantics; no stale or backward confirmation', () => {
  const state=tension('loss'),s=recordMixedFeelingsV4(null,state,start);
  const active=recordMixedFeelingsV4(s,state,at(.34));assert.equal(projectMixedFeelingsV4(active,state,at(.34)).name,'失落，也想靠近');
  const stale=recordMixedFeelingsV4(s,state,at(1));assert.equal(stale.episode.status,'stale');
  assert.deepEqual(recordMixedFeelingsV4(active,state,at(.2)),active);
  assert.equal(projectMixedFeelingsV4(active,state,start).status,'clock_regression');
});

test('P0 event ingress records P2 once; 12 drive math identical, silence/memory/heartbeat excluded', () => {
  const input=newState(start),ev={eventId:'shared-id',interactionId:'same-interaction',interactionType:'conflict'};
  const config={interaction:{emotionV4Enabled:true,affectV4:opts}};
  const off=settleAndApplyConversationEvent(input,ev,start,{interaction:{emotionV4Enabled:true}});
  const on=settleAndApplyConversationEvent(input,ev,start,config);assert.deepEqual(on.state.drives,off.state.drives);
  assert.equal(on.state.coreAxesV4,undefined);const original=structuredClone(on.state);
  const alias=settleAndApplyConversationEvent(on.state,{...ev,eventId:'alias'},at(.1),config);assert.deepEqual(alias.state.moodV4,original.moodV4);
  const heart=settleAndApplyConversationEvent(on.state,{eventId:'heartbeat'},at(1),{...config,presenceOnly:true});
  assert.deepEqual(heart.state.moodV4,original.moodV4);assert.deepEqual(heart.state.mixedFeelingsV4,original.mixedFeelingsV4);
  const recalled=applyMemoryResonance(on.state,[{category:'relationship',weight:.8}],at(1)).state;
  assert.deepEqual(recalled.moodV4,original.moodV4);assert.deepEqual(recalled.mixedFeelingsV4,original.mixedFeelingsV4);
  const sleeping=settleState(on.state,at(3),90).state;assert.equal(sleeping.consciousness,'sleeping');
  assert.deepEqual(sleeping.moodV4,original.moodV4);assert.deepEqual(sleeping.mixedFeelingsV4,original.mixedFeelingsV4);
});

test('Snapshot whitelist/schema1, old-client fields and Context reads; private option does not reveal ledger', async(t) => {
  const {send,store}=await fixture(t);const e=event();await send(e);const s=await store.read(),before=structuredClone(s);
  const old=buildDashboardSnapshot(s,{},start),p=buildDashboardSnapshot(s,{affectV4:opts,dashboard:{includePrivateText:true}},start);
  assert.equal(p.schemaVersion,1);assert.equal(p.affectV4.version,1);const {affectV4,...rest}=p;
  // Private-text impacts unrelated existing dreams/thoughts; compare same config.
  assert.deepEqual(rest,buildDashboardSnapshot(s,{dashboard:{includePrivateText:true}},start));
  assert.equal(old.drives.length,12);assert.deepEqual(p.drives,old.drives);
  const raw=JSON.stringify(p.affectV4);for(const secret of [key,token,e.event_id,e.subject_ref,e.incident_ref,e.evidence_ref,'binding','receipts','signature'])assert.ok(!raw.includes(secret));
  assert.doesNotMatch(JSON.stringify(redactAffectAudit(s,start).coreAxesV4),/receipts|binding|seen|daily/);
  buildContextEnvelope({state:s,maxTokens:2000,now:start});assert.deepEqual(s,before);
  assert.equal(buildDashboardSnapshot(s,{},start).affectV4,undefined);
});

test('rollback ignores preserved additive state; no automatic journal backfill or revision replay', () => {
  const s=newState(start);s.emotionV4=recordEmotionV4(null,'conflict',start);reduce(s,event());
  assert.equal(buildDashboardSnapshot(s,{affectV4:{moodEnabled:true}},start).affectV4.mood.value,null);
  const off=settleAndApplyConversationEvent(s,{eventId:'rollback',interactionType:'companionship'},at(1));
  assert.deepEqual(off.state.coreAxesV4,s.coreAxesV4);assert.equal(off.state.moodV4,undefined);
  assert.equal(buildDashboardSnapshot(off.state,{},at(1)).affectV4,undefined);
});


test('metadata retention expires 6/48/72h without decay, samples, waking or budget edits', () => {
  const s=newState(start);reduce(s,event());s.moodV4=recordMoodV4(null,{valence:.4},start);
  const before=structuredClone(s),off=pruneAffectAudit(structuredClone(s),{},at(73));assert.deepEqual(off,before);
  pruneAffectAudit(s,opts,at(73));assert.equal(s.coreAxesV4.receipts.length,0);assert.equal(s.coreAxesV4.seen.length,0);assert.equal(s.moodV4.buckets.length,0);
  assert.equal(s.coreAxesV4.security,before.coreAxesV4.security);assert.deepEqual(s.coreAxesV4.daily,before.coreAxesV4.daily);
  assert.deepEqual(s.drives,before.drives);assert.equal(s.consciousness,before.consciousness);
});

test('sleeping hug -> normal wake retains dream and hug with P2 ON; P2 alone queues no expression', async () => {
  const { recordXiaowoHugAwareness } = await import('../src/xiaowo-hug-awareness.js');
  const { evaluateSelfSignal } = await import('../src/self-signal.js');
  const state = newState(start);state.consciousness='sleeping';state.sleepStartedAt=start.toISOString();
  const hug={eventId:'xiaowo-hug-p2-fixture',interactionType:'affection',contextType:'petal',contextId:'crave'};
  recordXiaowoHugAwareness(state,hug,at(.01));assert.equal(state.consciousness,'sleeping');
  state.recentDreams.push({id:'p2-this-sleep-dream',createdAt:at(.02).toISOString(),residue:'测试梦境余韵'});
  const axesOnly=structuredClone(state);reduce(axesOnly,event());
  assert.equal(evaluateSelfSignal(state,axesOnly,{type:'owner_confirmation'},start).signal,null);
  assert.equal(axesOnly.consciousness,'sleeping');
  const wake=settleAndApplyConversationEvent(axesOnly,{eventId:'p2-wake',interactionType:'companionship'},at(.05),{interaction:{emotionV4Enabled:true,affectV4:opts}}).state;
  assert.equal(wake.consciousness,'awake');assert.equal(wake.pendingAwareness.dreamId,'p2-this-sleep-dream');
  assert.match(wake.pendingAwareness.residue,/测试梦境余韵/);assert.ok(wake.pendingAwareness.xiaowoHug);
  assert.equal(projectEmotionV4(wake.emotionV4,at(.05)).shown,'安稳');
});


test('monitor-only concern is not labeled approach, switching pair preserves the one episode clock', () => {
  let state=tension();state.drives.possess=.2;
  let s=recordMixedFeelingsV4(null,state,start);s=recordMixedFeelingsV4(s,state,at(.34));
  assert.equal(projectMixedFeelingsV4(s,state,at(.34)).name,'不安，仍有牵挂');
  state.drives.possess=.8;s=recordMixedFeelingsV4(s,state,at(.4));
  assert.equal(projectMixedFeelingsV4(s,state,at(.4)).name,'不安，也想靠近');assert.equal(s.episode.since,start.toISOString());
});


test('queued P2 admission rechecks evidence on the serialized write clock before any ledger mutation', async(t) => {
  const { RelationshipShadowService }=await import('../src/relationship-shadow-service.js');
  const { store }=await fixture(t);let checks=0;
  const service=new RelationshipShadowService({store,affectOptions:opts,authorize:()=>true,
    verify:(_event,ctx)=>{checks++;assert.ok(ctx.now instanceof Date);return checks===1;}});
  const before=await store.read();const result=await service.ingest(event(),{now:start},start);
  assert.equal(result.reason,'evidence_invalid_or_expired');assert.equal(checks,2);assert.deepEqual(await store.read(),before);
});
