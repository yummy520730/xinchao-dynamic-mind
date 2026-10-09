import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StateStore } from '../src/state-store.js';
import { RelationshipShadowService } from '../src/relationship-shadow-service.js';
import { CLOSENESS_WEIGHTS, EMPATHY_DAILY_CAPS, SHADOW_POLICY, validateShadowEvent } from '../src/relationship-shadow.js';
import { buildDashboardSnapshot } from '../src/dashboard-projection.js';
import { loadConfig } from '../src/config.js';
import { DIMENSIONS, DRIVE_KEYS } from '../src/dimensions.js';
import { newState, settleState, settleAndApplyConversationEvent, applyMemoryResonance } from '../src/engine.js';
import { recordXiaowoHugAwareness } from '../src/xiaowo-hug-awareness.js';

const start = new Date('2026-10-09T02:00:00.000Z');
const at = (hours = 0) => new Date(start.getTime() + hours * 3_600_000);
const id = (s) => createHash('sha256').update(s).digest('hex');
const flags = { favoredEnabled: true, empathyEnabled: true, timeZone: 'Asia/Shanghai', maxEffectsPerDay: 96 };
function event(n, extra = {}, now = start) {
  return { schema_version: 1, event_id: id(`event-${n}`), event_type: 'empathy', occurred_at: now.toISOString(),
    source: 'owner_confirmation', evidence_ref: id('evidence'), subject_ref: id('subject'), incident_ref: id(`incident-${n}`),
    empathy_type: 'care', closeness: 'her', relationship_ref: id('relationship'), ...extra };
}
function favored(n, reason = 'explicit_slight', now = start) {
  const e = event(n, { event_type: 'favored_hurt', reason }, now);
  delete e.empathy_type; delete e.closeness; delete e.relationship_ref;
  return e;
}
const context = { principal: 'owner', proof: 'confirmed' };
async function fixture(t, options = flags, initial = newState(start)) {
  const dir = await mkdtemp(join(tmpdir(), 'xinchao-p1-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  const store = new StateStore(path, () => initial);
  await store.write(initial);
  const svc = new RelationshipShadowService({ store, options,
    authorize: (ctx) => ctx?.principal === 'owner', verify: (_e, ctx) => ctx?.proof === 'confirmed' });
  return { store, svc, path };
}
async function ingest(svc, e, now = start) { return svc.ingest(e, context, now); }
function oldOnly(s) { const copy = structuredClone(s); delete copy.favoredShadow; delete copy.empathyShadow; return copy; }

test('flags default OFF, disabled service writes nothing and legacy output is identical', async (t) => {
  for (const key of ['FAVORED_SHADOW_ENABLED', 'EMPATHY_SHADOW_ENABLED', 'EMOTION_V4_ENABLED']) {
    const before = process.env[key]; delete process.env[key];
    t.after(() => before === undefined ? delete process.env[key] : process.env[key] = before);
  }
  const config = loadConfig();
  assert.equal(config.relationshipShadow.favoredEnabled, false);
  assert.equal(config.relationshipShadow.empathyEnabled, false);
  assert.equal(config.interaction.emotionV4Enabled, false);
  const { svc, store, path } = await fixture(t, config.relationshipShadow);
  const before = await readFile(path, 'utf8');
  assert.equal((await ingest(svc, event('off'))).reason, 'disabled');
  assert.equal((await ingest(svc, favored('off'))).reason, 'disabled');
  assert.equal(await readFile(path, 'utf8'), before);
  assert.deepEqual(await store.read(), newState(start));
  assert.deepEqual(buildDashboardSnapshot(await store.read(), config, start), buildDashboardSnapshot(newState(start), config, start));
});

test('authenticated identity and independently verified evidence are both required', async (t) => {
  const { svc, store } = await fixture(t);
  await assert.rejects(svc.ingest(event('x'), {}, start), /unauthorized/);
  await assert.rejects(svc.ingest(event('x'), { principal: 'owner', verified: true }, start), /unverified/);
  const closed = new RelationshipShadowService({ store, options: flags });
  await assert.rejects(closed.ingest(event('x'), context, start), /unauthorized/);
  assert.deepEqual(await store.read(), newState(start));
});

test('no text, jokes, hypotheticals, roleplay, ambiguous conflict or caller numeric delta is accepted', () => {
  for (const change of [{ note: '聊天正文' }, { text: '你是不是不爱我' }, { mode: 'roleplay' },
    { verified: true }, { event_type: 'conflict' }, { reason: 'jealous_of_ai', event_type: 'favored_hurt' },
    { delta: 0.8 }, { closeness: 'mom' }, { relationship_ref: '妈妈' }, { subject_ref: '某某姓名' }]) {
    assert.throws(() => validateShadowEvent({ ...event('bad'), ...change }, start), /invalid/);
  }
  assert.throws(() => validateShadowEvent(event('future', {}, at(1)), start), /invalid/);
  assert.throws(() => validateShadowEvent(event('stale'), at(25)), /invalid/);
});

test('favored grows only on verified explicit hurt, caps .55, relief halves, reads decay without writes', async (t) => {
  const { svc, store } = await fixture(t);
  for (let i = 0; i < 3; i++) await ingest(svc, favored(i));
  let s = await store.read();
  assert.equal(s.favoredShadow.intensity, .55);
  assert.equal(s.favoredShadow.lastEvent.reason, 'explicit_slight');
  const relief = { ...favored('relief'), event_type: 'favored_relief', reason: 'reassurance' };
  await ingest(svc, relief);
  s = await store.read();
  assert.equal(s.favoredShadow.intensity, .275);
  assert.equal(buildDashboardSnapshot(s, { relationshipShadow: flags }, at(12)).favored.intensity, .1375);
  assert.equal(buildDashboardSnapshot(s, { relationshipShadow: flags }, at(12)).favored.trend, 'decaying');
  assert.deepEqual(s, await store.read());
});

test('canonical event retry and concurrent cross-entry delivery settle exactly once, including restart', async (t) => {
  const { svc, store, path } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => ingest(svc, event('same'))));
  assert.equal(results.filter((r) => r.applied).length, 1);
  let s = await store.read();
  assert.equal(s.empathyShadow.loads[0].value, .25);
  assert.equal(s.empathyShadow.stats.duplicate, 19);
  const restarted = new RelationshipShadowService({ store: new StateStore(path, () => { throw Error('not legacy'); }),
    options: flags, authorize: () => true, verify: () => true });
  assert.equal((await ingest(restarted, event('same', { source: 'trusted_adapter' }), at(1))).reason, 'duplicate');
  assert.deepEqual(oldOnly(await store.read()), newState(start));
});

test('same person different incidents settle; paraphrases of one incident do not; aliases keep receipts', async (t) => {
  const { svc, store } = await fixture(t);
  const first = event('first');
  await ingest(svc, first);
  assert.equal((await ingest(svc, { ...first, event_id: id('alias') }, at(1))).reason, 'duplicate');
  assert.equal((await ingest(svc, event('different'), at(1))).applied, true);
  // Even after semantic dedupe expires the alias canonical ID stays consumed.
  assert.equal((await ingest(svc, { ...first, event_id: id('alias') }, at(7))).reason, 'duplicate');
  assert.equal((await store.read()).empathyShadow.loads.length, 2);
});

test('six-hour semantic boundary can settle a new verified observation of the same incident', async (t) => {
  const { svc } = await fixture(t);
  const first = event('boundary');
  await ingest(svc, first);
  assert.equal((await ingest(svc, { ...first, event_id: id('before') }, at(5.999))).reason, 'duplicate');
  assert.equal((await ingest(svc, { ...first, event_id: id('after') }, at(6))).applied, true);
});

test('four categories and four explicit closeness tiers compute correct independent deltas', async (t) => {
  for (const [near, weight] of Object.entries(CLOSENESS_WEIGHTS).filter(([key]) => key !== 'unknown')) {
    for (const [kind, target] of [['care', 'grieve'], ['injustice', 'anger'], ['help_intent', 'share'], ['joy', null]]) {
      const { svc, store } = await fixture(t);
      const result = await ingest(svc, event(`${near}-${kind}`, { closeness: near, empathy_type: kind }));
      assert.deepEqual(result.expectedDelta, target ? { [target]: .25 * weight } : {});
      if (!target) assert.deepEqual(result.emotionDelta, { valence: Number((.12 * weight).toFixed(8)), arousal: Number((.10 * weight).toFixed(8)) });
      assert.deepEqual((await store.read()).drives, newState(start).drives);
      assert.equal('emotionV4' in (await store.read()), false);
    }
  }
});

test('unknown stays unknown with zero candidate delta; known tiers require relationship evidence', async (t) => {
  const { svc, store } = await fixture(t);
  const e = event('unknown', { closeness: 'unknown' }); delete e.relationship_ref;
  assert.equal((await ingest(svc, e)).reason, 'unknown_closeness');
  const projection = buildDashboardSnapshot(await store.read(), { relationshipShadow: flags }, start).empathy;
  assert.equal(projection.lastCloseness, 'unknown');
  assert.deepEqual(projection.lastCandidate.expectedDelta, {});
  const missing = event('missing'); delete missing.relationship_ref;
  await assert.rejects(ingest(svc, missing), /invalid/);
});

test('each daily tier quota clips increments, including joy, and resets on Shanghai day boundary', async (t) => {
  for (const near of ['her', 'family', 'known', 'stranger']) {
    const { svc, store } = await fixture(t);
    for (let i = 0; i < 12; i++) await ingest(svc, event(`${near}-${i}`, { closeness: near, empathy_type: 'joy' }));
    let s = await store.read();
    assert.equal(s.empathyShadow.daily[near], EMPATHY_DAILY_CAPS[near]);
    assert.ok(s.empathyShadow.stats.limited > 0);
    const tomorrow = at(14); // 00:00 Shanghai
    assert.equal((await ingest(svc, event(`${near}-tomorrow`, { closeness: near, empathy_type: 'joy' }, tomorrow), tomorrow)).applied, true);
    s = await store.read();
    assert.equal(s.empathyShadow.daily.day, '2026-10-10');
    assert.ok(s.empathyShadow.daily[near] <= EMPATHY_DAILY_CAPS[near]);
  }
});

test('others and strangers have independent per-target load ceilings, including all others combined', async (t) => {
  const { svc, store } = await fixture(t);
  const seed = event('seed'); await ingest(svc, seed);
  const s = await store.read();
  s.empathyShadow.loads = [
    { key: id('stranger-load'), type: 'care', closeness: 'stranger', target: 'grieve', value: .29, at: start.toISOString() },
    { key: id('known-load'), type: 'care', closeness: 'known', target: 'grieve', value: .15, at: start.toISOString() },
    { key: id('her-load'), type: 'care', closeness: 'her', target: 'grieve', value: .70, at: start.toISOString() },
  ];
  await store.write(s);
  assert.equal((await ingest(svc, event('stranger', { closeness: 'stranger' }))).expectedDelta.grieve, .01);
  assert.equal((await ingest(svc, event('known', { closeness: 'known' }))).reason, 'load_or_daily_limit');
  assert.equal((await ingest(svc, event('her'))).expectedDelta.grieve, .05);
  const final = await store.read();
  assert.ok(Math.abs(final.empathyShadow.loads.filter((l) => l.closeness !== 'her').reduce((v, l) => v + l.value, 0) - .45) < 1e-8);
});

test('helped reduces only the exact subject, incident and empathy kind; her and unrelated events survive', async (t) => {
  const { svc, store } = await fixture(t);
  const her = event('her-help'); const stranger = event('stranger-help', { closeness: 'stranger', subject_ref: id('other') });
  const unrelated = event('stranger-other', { closeness: 'stranger', subject_ref: id('other') });
  await ingest(svc, her); await ingest(svc, stranger); await ingest(svc, unrelated);
  const before = await store.read();
  const help = { ...stranger, event_id: id('completed-help'), event_type: 'helped' };
  assert.deepEqual((await ingest(svc, help)).expectedDelta, { grieve: -.0375 });
  const after = await store.read();
  assert.equal(after.empathyShadow.loads[0].value, before.empathyShadow.loads[0].value);
  assert.equal(after.empathyShadow.loads[1].value, .025);
  assert.equal(after.empathyShadow.loads[2].value, before.empathyShadow.loads[2].value);
  assert.equal((await ingest(svc, { ...help, event_id: id('badhelp'), incident_ref: id('no-such-case') })).reason, 'no_matching_load');
  assert.equal((await ingest(svc, { ...help, event_id: id('wrongkind'), empathy_type: 'injustice' })).reason, 'no_matching_load');
  assert.deepEqual(after.drives, before.drives);
});

test('limits preserve receipts, no retry after day reset; storage is bounded and clock rollback fails closed', async (t) => {
  const { svc, store } = await fixture(t, { ...flags, maxEffectsPerDay: 1 });
  await ingest(svc, favored('one'));
  const rejected = favored('rejected');
  assert.equal((await ingest(svc, rejected)).reason, 'daily_limit');
  assert.equal((await ingest(svc, rejected, at(14))).reason, 'duplicate');
  const past = favored('past');
  assert.equal((await ingest(svc, past, at(1))).reason, 'clock_regression');
  const s = await store.read();
  s.favoredShadow.receipts = Array.from({ length: SHADOW_POLICY.maxReceipts }, (_, i) => ({ key: id(`full${i}`), at: at(14).toISOString() }));
  await store.write(s);
  assert.equal((await ingest(svc, favored('full', 'explicit_slight', at(14)), at(14))).reason, 'ledger_full');
  assert.equal((await store.read()).favoredShadow.receipts.length, SHADOW_POLICY.maxReceipts);
});

test('exact twelve drive definitions, calculations, P0 and awareness remain unchanged with P1 fields', async (t) => {
  assert.deepEqual(DRIVE_KEYS, ['possess', 'monitor', 'crave', 'share', 'libido', 'curiosity', 'boredom', 'social', 'duty', 'reflection', 'grieve', 'anger']);
  assert.deepEqual(DRIVE_KEYS.map((k) => DIMENSIONS[k].ceiling ?? null), [.9, .84, .8, .76, .62, .72, .66, .7, .64, .6, null, null]);
  const { svc, store } = await fixture(t);
  await ingest(svc, favored('isolated')); await ingest(svc, event('isolated'));
  const before = await store.read();
  assert.deepEqual(oldOnly(before), newState(start));
  for (const kind of ['conflict', 'companionship', 'reconciliation']) {
    const e = { eventId: kind, sessionId: 'cc', interactionType: kind };
    const opts = { interaction: { emotionV4Enabled: true } };
    const plain = settleAndApplyConversationEvent(newState(start), e, at(1), opts).state;
    const shadow = settleAndApplyConversationEvent(before, e, at(1), opts).state;
    assert.deepEqual(oldOnly(shadow), plain);
    assert.deepEqual(shadow.favoredShadow, before.favoredShadow);
    assert.deepEqual(shadow.empathyShadow, before.empathyShadow);
  }
});

test('silence, heartbeat, memory resonance and Dashboard cannot manufacture P1 events', async (t) => {
  const { svc, store } = await fixture(t);
  await ingest(svc, event('quiet')); await ingest(svc, favored('quiet'));
  const s = await store.read();
  const settled = settleState(s, at(12), 90).state;
  const heartbeat = settleAndApplyConversationEvent(s, { eventId: 'hb', sessionId: 'cc' }, at(1), { presenceOnly: true }).state;
  const recalled = applyMemoryResonance(s, [], at(1)).state;
  for (const next of [settled, heartbeat, recalled]) {
    assert.deepEqual(next.empathyShadow, s.empathyShadow); assert.deepEqual(next.favoredShadow, s.favoredShadow);
  }
  const legacy = settleState(newState(start), at(12), 90).state;
  assert.equal('favoredShadow' in legacy, false); assert.equal('empathyShadow' in legacy, false);
});

test('sleeping P1 events never wake; hug then normal wake keeps dream AND hug', async (t) => {
  const initial = newState(start); initial.consciousness = 'sleeping'; initial.sleepStartedAt = start.toISOString();
  const { svc, store } = await fixture(t, flags, initial);
  await ingest(svc, event('asleep')); await ingest(svc, favored('asleep'));
  const s = await store.read();
  assert.deepEqual(oldOnly(s), initial);
  recordXiaowoHugAwareness(s, { interactionType: 'affection', eventId: 'xiaowo-hug-p1' }, at(.01));
  s.recentDreams.push({ id: 'sleep-dream', createdAt: at(.02).toISOString(), residue: '窗边那盏灯' });
  const wake = settleAndApplyConversationEvent(s, { eventId: 'normal-wake', sessionId: 'cc' }, at(.03)).state;
  assert.equal(wake.consciousness, 'awake');
  assert.equal(wake.pendingAwareness.dreamId, 'sleep-dream');
  assert.match(wake.pendingAwareness.residue, /拥抱.*窗边那盏灯/);
});

test('Dashboard is schema 1, aggregate-only, no IDs/text leak and repeated reads never persist', async (t) => {
  const { svc, store, path } = await fixture(t);
  await ingest(svc, event('private')); await ingest(svc, favored('private'));
  const s = await store.read(); const saved = await readFile(path, 'utf8');
  const cfg = { relationshipShadow: flags, dashboard: { includePrivateText: true } };
  const snapshot = buildDashboardSnapshot(s, cfg, at(1));
  assert.equal(snapshot.schemaVersion, 1); assert.equal(snapshot.drives.length, 12);
  const p1 = JSON.stringify({ favored: snapshot.favored, empathy: snapshot.empathy });
  for (const key of ['evidence_ref', 'subject_ref', 'incident_ref', 'relationship_ref', 'receipts', 'seen', id('evidence'), id('subject')]) assert.ok(!p1.includes(key));
  buildDashboardSnapshot(s, cfg, at(12)); buildDashboardSnapshot(s, cfg, at(48));
  assert.equal(await readFile(path, 'utf8'), saved);
  assert.deepEqual(s, await store.read());
  assert.equal(buildDashboardSnapshot(s, {}, at(1)).favored, undefined);
  assert.equal(buildDashboardSnapshot(s, {}, at(1)).empathy, undefined);
});

test('legacy schema lazily adds only P1 fields; disabling freezes state and old engine tolerates rollback', async (t) => {
  const initial = newState(start); initial.schemaVersion = 8;
  const { svc, store, path } = await fixture(t, flags, initial);
  await ingest(svc, event('migration'));
  assert.deepEqual(oldOnly(await store.read()), initial);
  const off = new RelationshipShadowService({ store, authorize: () => true });
  const saved = await readFile(path, 'utf8');
  assert.equal((await ingest(off, event('offagain'))).reason, 'disabled');
  assert.equal(await readFile(path, 'utf8'), saved);
  const rolled = settleState(await store.read(), at(1)).state;
  const plain = settleState(initial, at(1)).state;
  assert.deepEqual(oldOnly(rolled), plain);
  assert.equal(buildDashboardSnapshot(rolled, {}).empathy, undefined);
  const s = await store.read(); s.empathyShadow.schemaVersion = 2; await store.write(s);
  assert.equal((await ingest(svc, event('future-version'))).reason, 'unsupported_state');
});

test('each switch is independent and favored concurrent delivery also settles once', async (t) => {
  const { svc, store } = await fixture(t, { ...flags, empathyEnabled: false });
  assert.equal((await ingest(svc, event('off-empathy'))).reason, 'disabled');
  const results = await Promise.all(Array.from({ length: 10 }, () => ingest(svc, favored('favored-concurrent'))));
  assert.equal(results.filter((r) => r.applied).length, 1);
  assert.equal((await store.read()).favoredShadow.intensity, .25);
  assert.equal((await store.read()).empathyShadow, undefined);
  const opposite = await fixture(t, { ...flags, favoredEnabled: false });
  assert.equal((await ingest(opposite.svc, favored('off-favored'))).reason, 'disabled');
  assert.equal((await ingest(opposite.svc, event('on-empathy'))).applied, true);
  assert.equal((await opposite.store.read()).favoredShadow, undefined);
});

test('load capacity rejects without evicting unrelated cases; helping retry cannot relieve twice', async (t) => {
  const { svc, store } = await fixture(t);
  const original = event('capacity'); await ingest(svc, original);
  let s = await store.read();
  const realLoad = s.empathyShadow.loads[0];
  s.empathyShadow.loads.push(...Array.from({ length: SHADOW_POLICY.maxLoads - 1 }, (_, i) => ({
    key: id(`capacity-${i}`), type: 'injustice', target: 'anger', closeness: 'her', value: .001, at: start.toISOString(),
  })));
  await store.write(s);
  assert.equal((await ingest(svc, event('new-case', { empathy_type: 'help_intent' }))).reason, 'load_or_daily_limit');
  assert.equal((await store.read()).empathyShadow.loads.length, SHADOW_POLICY.maxLoads);
  const help = { ...original, event_id: id('help-once'), event_type: 'helped' };
  assert.equal((await ingest(svc, help)).applied, true);
  s = await store.read(); const reduced = s.empathyShadow.loads.find((l) => l.key === realLoad.key).value;
  assert.equal((await ingest(svc, help)).reason, 'duplicate');
  assert.equal((await store.read()).empathyShadow.loads.find((l) => l.key === realLoad.key).value, reduced);
});

test('Dashboard never forwards unexpected private fields inside persisted P1 containers', async (t) => {
  const { svc, store } = await fixture(t); await ingest(svc, event('projection-guard'));
  const s = await store.read();
  s.empathyShadow.stats.privateText = 'private-sentinel';
  s.empathyShadow.lastCandidate.privateText = 'private-sentinel';
  s.empathyShadow.lastCandidate.expectedDelta.rawText = 'private-sentinel';
  s.empathyShadow.loads.push({ type: 'private-sentinel', closeness: 'her', target: 'grieve', value: .2, at: start.toISOString() });
  const dashboard = buildDashboardSnapshot(s, { relationshipShadow: flags }, start);
  assert.doesNotMatch(JSON.stringify(dashboard.empathy), /private-sentinel|privateText|rawText/);
});
