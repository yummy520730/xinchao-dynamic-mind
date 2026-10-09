import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, settleState, settleAndApplyConversationEvent } from '../src/engine.js';
import { buildDashboardSnapshot } from '../src/dashboard-projection.js';
import { projectEmotionV4, recordEmotionV4 } from '../src/emotion-v4.js';

const start = new Date('2026-10-09T02:00:00.000Z');
const at = (minutes) => new Date(start.getTime() + minutes * 60_000);
const event = (id, interactionType, extra = {}) => ({
  eventId: id, interactionType, sessionId: 'test-session', ...extra,
});
const v4 = { interaction: { emotionV4Enabled: true, timeZone: 'Asia/Shanghai' } };

test('preview off by default leaves twelve drives and no emotion projection', () => {
  const off = settleAndApplyConversationEvent(newState(start), event('first', 'affection'), at(1));
  assert.equal('emotionV4' in off.state, false);
  assert.equal(Object.keys(off.state.drives).length, 12);
  assert.ok('crave' in off.state.drives && 'social' in off.state.drives);
  assert.equal(buildDashboardSnapshot(off.state, {}, at(1)).emotion, undefined);
});

test('enabled emotion has a base and a cause, with no raw conversation text', () => {
  const before = newState(start);
  const expected = settleAndApplyConversationEvent(before, event('intro', 'affection'), at(1));
  const actual = settleAndApplyConversationEvent(before, event('intro', 'affection', {
    note: '绝不应该保存的对话原文和密钥', valence: 0, arousal: 1,
  }), at(1), v4);
  assert.deepEqual(actual.state.drives, expected.state.drives);
  assert.equal(actual.state.emotionV4.valence, 0.67);
  const projection = projectEmotionV4(actual.state.emotionV4, at(1));
  assert.equal(projection.label, '平静');
  assert.equal(projection.shown, '温暖');
  assert.equal(projection.marks[0].why, 'affection');
  assert.doesNotMatch(JSON.stringify(actual.state.emotionV4), /绝不应该|密钥/);
});

test('base inertia requires a sustained candidate', () => {
  const first = recordEmotionV4(null, 'affection', at(0));
  assert.equal(first.base.label, '平静');
  assert.equal(first.base.pending.label, '安心');
  const another = recordEmotionV4(first, 'affection', at(11));
  assert.equal(another.base.label, '安心');
});

test('reconciliation can supersede conflict but a mild affection cannot', () => {
  const conflict = recordEmotionV4(null, 'conflict', at(0));
  assert.equal(projectEmotionV4(conflict, at(0)).shown, '生气');
  const hug = recordEmotionV4(conflict, 'affection', at(2));
  assert.equal(projectEmotionV4(hug, at(2)).shown, '生气');
  const repaired = recordEmotionV4(conflict, 'reconciliation', at(2));
  assert.equal(projectEmotionV4(repaired, at(2)).shown, '释然');
  assert.equal(projectEmotionV4(repaired, at(19)).shown, repaired.base.label);
});

test('same emotion within two hours merges its marks', () => {
  const first = recordEmotionV4(null, 'affection', at(0));
  const second = recordEmotionV4(first, 'affection', at(20));
  assert.equal(second.marks.length, 1);
  assert.equal(second.marks[0].n, 2);
  assert.equal(second.marks[0].at, at(0).toISOString());
  assert.equal(second.marks[0].lastAt, at(20).toISOString());
});

test('wall clock and dashboard reads cannot mutate the saved emotion', () => {
  const awake = settleAndApplyConversationEvent(newState(start), event('love', 'affection'), at(1), v4).state;
  const original = structuredClone(awake.emotionV4);
  const sleeping = settleState(awake, at(200), 90).state;
  assert.deepEqual(sleeping.emotionV4, original);
  assert.equal(sleeping.consciousness, 'sleeping');
  const projection = projectEmotionV4(sleeping.emotionV4, at(400));
  assert.deepEqual(sleeping.emotionV4, original);
  assert.equal(projection.shown, projection.label);
});

test('duplicate event id and presence-only heartbeat never replay emotion', () => {
  const first = settleAndApplyConversationEvent(newState(start), event('same', 'affection'), at(1), v4);
  const retry = settleAndApplyConversationEvent(first.state, event('same', 'affection'), at(2), v4);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.state.emotionV4, first.state.emotionV4);
  const heartbeat = settleAndApplyConversationEvent(first.state,
    { eventId: 'heartbeat-1', sessionId: 'test-session' }, at(3),
    { ...v4, presenceOnly: true });
  assert.deepEqual(heartbeat.state.emotionV4, first.state.emotionV4);
});

test('dashboard opt-in exposes a private-safe structured projection', () => {
  const state = settleAndApplyConversationEvent(newState(start), event('self', 'sharing', {
    note: '私人聊天正文绝对不进快照',
  }), at(1), v4).state;
  const original = structuredClone(state);
  const enabled = buildDashboardSnapshot(state, { interaction: { emotionV4Enabled: true } }, at(2));
  assert.equal(enabled.schemaVersion, 1);
  assert.equal(enabled.drives.length, 12);
  assert.equal(enabled.emotion.shown, '雀跃');
  assert.equal(enabled.emotion.marks[0].why, 'sharing');
  assert.doesNotMatch(JSON.stringify(enabled), /私人聊天正文/);
  assert.equal(buildDashboardSnapshot(state, {}, at(2)).emotion, undefined);
  assert.deepEqual(state, original);
});

test('legacy states and unknown event types remain valid', () => {
  assert.equal(recordEmotionV4(null, 'unknown', start), null);
  assert.equal(projectEmotionV4(undefined, start), null);
  const old = newState(start);
  delete old.emotionV4;
  const next = settleAndApplyConversationEvent(old, event('old-migrate', 'reassurance'), at(1), v4);
  assert.equal(next.state.emotionV4.cause.word, '安心');
});
