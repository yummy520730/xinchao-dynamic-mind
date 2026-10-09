import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../src/state-store.js';
import { newState } from '../src/engine.js';
import { signEvidence, verifyEvidence } from '../src/owner-evidence.js';
import { createOwnerShadowIngress } from '../src/owner-shadow-ingress.js';
import { shadowReceiptRef } from '../src/relationship-shadow.js';
import { buildDashboardSnapshot } from '../src/dashboard-projection.js';
const key = 'a'.repeat(64), token = 'owner-ingress-test-token-independent-32';
const start = new Date('2026-10-09T02:00:00.000Z');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const at = (hours) => new Date(start.getTime() + hours * 3_600_000);
function event(id = 'a', extra = {}, occurred = start) {
  return { schema_version: 1, event_id: hash(id), evidence_ref: hash(`e:${id}`), event_type: 'empathy',
    source: 'owner_confirmation', occurred_at: occurred.toISOString(), subject_ref: hash('subject'),
    incident_ref: hash(id), empathy_type: 'care', closeness: 'unknown', ...extra };
}
function revision(e, closeness = 'family', id = 'revision') {
  return { schema_version: 1, revision_id: hash(id), receipt_ref: shadowReceiptRef(e.event_id), closeness, relationship_ref: hash(`rel:${closeness}`) };
}
async function fixture(t, options = {}, initial = newState(start)) {
  const dir = await mkdtemp(join(tmpdir(), 'p15-unit-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json'), store = new StateStore(path, () => initial); await store.write(initial);
  const config = { store, options: { favoredEnabled: true, empathyEnabled: true, maxEffectsPerDay: 24, timeZone: 'Asia/Shanghai', ...options },
    enabled: true, token, evidenceKey: key, serviceToken: 'generic-service-test-token-independent' };
  return { store, config, handle: createOwnerShadowIngress(config), path };
}
async function send(handle, data, purpose = 'event', now = start, supplied = token) {
  return handle(purpose, await signEvidence(data, purpose, key, now), supplied, now);
}

test('proof binds every field, exact purpose/issuer/audience, fixed short TTL and independent authorization', async (t) => {
  const { handle, store } = await fixture(t);
  const proof = await signEvidence(event(), 'event', key, start);
  for (const edit of [{ event_type: 'helped' }, { subject_ref: hash('other') }, { incident_ref: hash('other') },
    { closeness: 'her', relationship_ref: hash('rel') }, { evidence_ref: hash('fake') }, { occurred_at: at(-1).toISOString() }]) {
    assert.equal((await handle('event', { ...proof, data: { ...proof.data, ...edit } }, token, start)).status, 422);
  }
  for (const edit of [{ issuer: 'model' }, { authorization: 'verified=true' }, { audience: 'elsewhere' }, { purpose: 'closeness' }, { signature: 'f'.repeat(64) }, { verified: true }]) {
    assert.equal((await handle('event', { ...proof, ...edit }, token, start)).status, 422);
  }
  assert.equal(await verifyEvidence(proof, 'event', key, new Date(start.getTime() + 299999)), true);
  assert.equal(await verifyEvidence(proof, 'event', key, new Date(start.getTime() + 300000)), false);
  assert.equal((await handle('event', proof, 'generic-service-test-token-independent', start)).status, 401);
  assert.equal((await handle('event', proof, 'é'.repeat(token.length), start)).status, 401);
  assert.deepEqual(await store.read(), newState(start));
});

test('flags stay OFF, evidence is still checked, P0 and legacy state are unchanged', async (t) => {
  const { handle, store } = await fixture(t, { favoredEnabled: false, empathyEnabled: false });
  assert.equal((await send(handle, event())).body.reason, 'disabled');
  assert.deepEqual(await store.read(), newState(start));
  assert.equal((await handle('event', { verified: true }, token, start)).status, 422);
});

test('unknown explicitly amends the original receipt once, under concurrency and after restart', async (t) => {
  const { handle, config, store, path } = await fixture(t); const e = event();
  assert.equal((await send(handle, e)).body.reason, 'unknown_closeness');
  const r = revision(e);
  const results = await Promise.all(Array.from({ length: 12 }, () => send(handle, r, 'closeness', at(1))));
  assert.equal(results.filter((r) => r.body.shadow_settled).length, 1);
  let s = await store.read(); assert.equal(s.empathyShadow.daily.events, 1); assert.equal(s.empathyShadow.daily.family, .2);
  assert.equal(s.empathyShadow.loads[0].closeness, 'family');
  const restarted = createOwnerShadowIngress({ ...config, store: new StateStore(path, () => { throw Error(); }) });
  assert.equal((await send(restarted, r, 'closeness', at(2))).body.reason, 'duplicate_revision');
  assert.equal((await send(handle, revision(e, 'her', 'different'), 'closeness', at(2))).body.reason, 'relationship_conflict');
  s = await store.read(); const plain = structuredClone(s); delete plain.empathyShadow;
  assert.deepEqual(plain, newState(start)); assert.equal(s.empathyShadow.receipts[0].at, start.toISOString());
});

test('canonical retries do not refresh effective time; changing identity content or type fails closed', async (t) => {
  const { handle, store } = await fixture(t); const e = event('known', { closeness: 'her', relationship_ref: hash('rel') });
  const results = await Promise.all(Array.from({ length: 10 }, () => send(handle, e)));
  assert.equal(results.filter((r) => r.body.shadow_settled).length, 1);
  assert.equal((await send(handle, e, 'event', at(1))).body.reason, 'duplicate');
  assert.equal((await store.read()).empathyShadow.lastEffectiveAt, start.toISOString());
  for (const edit of [{ incident_ref: hash('other') }, { subject_ref: hash('other') }, { closeness: 'stranger' }]) {
    assert.equal((await send(handle, { ...e, ...edit }, 'event', at(1))).body.reason, 'event_mismatch');
  }
  const favored = { ...e, event_type: 'favored_hurt', reason: 'explicit_slight' };
  delete favored.empathy_type; delete favored.closeness; delete favored.relationship_ref;
  assert.equal((await send(handle, favored, 'event', at(1))).body.reason, 'event_mismatch');
});

test('different subjects and incidents remain independent; semantic aliases cannot acquire revision eligibility', async (t) => {
  const { handle, store } = await fixture(t); const a = event('a'), b = event('b'), c = event('c', { subject_ref: hash('subject-c') });
  for (const e of [a,b,c]) await send(handle, e);
  const alias = { ...a, event_id: hash('alias') };
  assert.equal((await send(handle, alias)).body.reason, 'duplicate');
  assert.equal((await send(handle, revision(alias), 'closeness')).body.reason, 'unsupported_receipt');
  for (const e of [a,b,c]) assert.equal((await send(handle, revision(e, 'known', e.event_id), 'closeness')).body.shadow_settled, true);
  assert.equal((await store.read()).empathyShadow.loads.length, 3);
});

test('revision never overwrites an existing nonzero load and later semantic records conflict', async (t) => {
  const { handle, store } = await fixture(t); const e = event('a'); await send(handle, e);
  const later = { ...e, event_id: hash('later'), occurred_at: at(6).toISOString(), closeness: 'her', relationship_ref: hash('her') };
  await send(handle, later, 'event', at(6)); const before = await store.read();
  assert.equal((await send(handle, revision(e), 'closeness', at(7))).body.reason, 'existing_load_requires_migration');
  assert.deepEqual(await store.read(), before);
  const other = await fixture(t); await send(other.handle, e);
  await send(other.handle, { ...e, event_id: hash('later2'), occurred_at: at(6).toISOString() }, 'event', at(6));
  assert.equal((await send(other.handle, revision(e), 'closeness', at(7))).body.reason, 'semantic_conflict');
});

test('limits consume a single amendment slot; no retries collect later capacity', async (t) => {
  const { handle, store } = await fixture(t, { maxEffectsPerDay: 1 }); const e = event('unknown'); await send(handle, e);
  await send(handle, event('full', { closeness: 'her', relationship_ref: hash('rel') }));
  assert.equal((await send(handle, revision(e), 'closeness')).body.reason, 'daily_limit');
  assert.equal((await send(handle, revision(e, 'family', 'try2'), 'closeness', at(1))).body.reason, 'duplicate_revision');
  assert.equal((await store.read()).empathyShadow.daily.events, 1);
});

test('midnight: original-day-only budget, no historical resettlement; successful retries stay idempotent', async (t) => {
  const late = at(13.8); // 23:48 Shanghai
  const { handle, store } = await fixture(t); const e = event('late', {}, late); await send(handle, e, 'event', late);
  assert.equal((await send(handle, revision(e), 'closeness', at(14))).body.reason, 'budget_day_closed');
  assert.equal((await store.read()).empathyShadow.daily.events, 0);
  const f = event('before-midnight', {}, late); await send(handle, f, 'event', late);
  const r = revision(f); assert.equal((await send(handle, r, 'closeness', at(13.9))).body.reason, 'closeness_revised');
  const before = await store.read();
  assert.equal((await send(handle, r, 'closeness', at(14.1))).body.reason, 'duplicate_revision');
  assert.deepEqual(await store.read(), before);
});

test('24h event age and revision window, exact 48h receipt retention, 6h semantic boundary', async (t) => {
  const { handle, store } = await fixture(t); const e = event('boundary'); await send(handle, e);
  assert.equal((await send(handle, event('stale'), 'event', at(24.0001))).status, 422);
  assert.equal((await send(handle, revision(e), 'closeness', at(24.0001))).body.reason, 'revision_window_expired');
  assert.equal((await send(handle, revision(e), 'closeness', at(48))).body.reason, 'receipt_missing_or_expired');
  const known = event('known', { closeness: 'her', relationship_ref: hash('rel') }); const other = await fixture(t); await send(other.handle, known);
  assert.equal((await send(other.handle, { ...known, event_id: hash('alias') }, 'event', at(5.999))).body.reason, 'duplicate');
  assert.equal((await send(other.handle, { ...known, event_id: hash('six') }, 'event', at(6))).body.shadow_settled, true);
  // Receipts are retained at <48h and retired at exactly 48h by the next trusted write.
  await send(handle, event('fresh', {}, at(48)), 'event', at(48));
  assert.equal((await store.read()).empathyShadow.receipts.some((r) => r.key === shadowReceiptRef(e.event_id)), false);
  const exact = await fixture(t); assert.equal((await send(exact.handle, event('24h'), 'event', at(24))).status, 200);
});

test('bad future state / old receipt versions reject, Dashboard never exposes proofs even with private text enabled', async (t) => {
  const { handle, store } = await fixture(t); const e = event(); await send(handle, e);
  let s = await store.read(); delete s.empathyShadow.receipts[0].pending; await store.write(s);
  assert.equal((await send(handle, revision(e), 'closeness')).body.reason, 'unsupported_receipt');
  s.empathyShadow.policyVersion = 2; await store.write(s);
  assert.equal((await send(handle, revision(e), 'closeness')).body.reason, 'unsupported_state');
  const dash = JSON.stringify(buildDashboardSnapshot(s, { relationshipShadow: { empathyEnabled: true }, dashboard: { includePrivateText: true } }, start));
  for (const secret of [key, token, e.event_id, e.subject_ref, e.evidence_ref, 'evidence_ref', 'signature']) assert.ok(!dash.includes(secret));
});

test('revision IDs cannot be repointed, timezone changes cannot redefine the original budget day', async (t) => {
  const { handle, store, config } = await fixture(t); const a = event('a'), b = event('b');
  await send(handle, a); await send(handle, b);
  assert.equal((await send(handle, revision(a, 'family', 'same-revision'), 'closeness')).body.reason, 'closeness_revised');
  assert.equal((await send(handle, revision(b, 'family', 'same-revision'), 'closeness')).body.reason, 'revision_mismatch');
  const changedZone = createOwnerShadowIngress({ ...config, options: { ...config.options, timeZone: 'UTC' } });
  assert.equal((await send(changedZone, revision(b, 'family', 'fresh-revision'), 'closeness')).body.reason, 'budget_policy_changed');
  assert.equal((await store.read()).empathyShadow.daily.events, 1);
});

test('private audit is redacted on generic state reads and physically pruned without changing P0 or budgets', async (t) => {
  const { redactRelationshipAudit, pruneRelationshipAudit } = await import('../src/relationship-shadow.js');
  const { handle, store } = await fixture(t); const e = event(); await send(handle, e);
  const state = await store.read(); const plain = redactRelationshipAudit(state, start);
  assert.equal(plain.empathyShadow.summary.lastStatus, 'unknown_closeness');
  assert.doesNotMatch(JSON.stringify(plain.empathyShadow), /receipts|binding|pending|subject|incident|evidence|signature|relationship/);
  const pruned = pruneRelationshipAudit(structuredClone(state), at(48));
  assert.equal(pruned.empathyShadow.receipts.length, 0); assert.equal(pruned.empathyShadow.seen.length, 0);
  assert.equal(pruned.empathyShadow.lastEvent.evidence, undefined);
  assert.deepEqual(pruned.drives, state.drives); assert.deepEqual(pruned.empathyShadow.daily, state.empathyShadow.daily);
  assert.equal(pruned.empathyShadow.lastEffectiveAt, state.empathyShadow.lastEffectiveAt);
});
