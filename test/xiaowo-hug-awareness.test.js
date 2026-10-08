import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, applyConversationEvent } from '../src/engine.js';
import { recordXiaowoHugAwareness } from '../src/xiaowo-hug-awareness.js';
import { evaluateSelfSignal, acknowledgePendingAwareness } from '../src/self-signal.js';

const now = new Date('2026-10-08T01:00:00Z');
const hug = { interactionType: 'affection', eventId: 'xiaowo-hug-test' };

test('hug preserves existing dream residue and unknown petals cannot inject text', () => {
  const state = newState(now);
  state.pendingAwareness = { id: 'dream-awareness', dreamId: 'dream-1', residue: '窗边那盏灯', createdAt: now.toISOString() };
  recordXiaowoHugAwareness(state, { ...hug, contextType: 'petal', contextId: 'arbitrary text' }, now);
  assert.equal(state.pendingAwareness.dreamId, 'dream-1');
  assert.equal(state.pendingAwareness.residue, '芥子从小窝送来一个拥抱。 窗边那盏灯');
  recordXiaowoHugAwareness(state, { ...hug, eventId: 'xiaowo-hug-test-2' }, now);
  assert.equal(state.pendingAwareness.residue, '芥子从小窝送来 2 个拥抱。 窗边那盏灯');
});

test('unacknowledged hugs survive a later sleep/wake presence', () => {
  const state = newState(now);
  recordXiaowoHugAwareness(state, hug, now);
  state.consciousness = 'sleeping';
  state.sleepStartedAt = now.toISOString();
  const result = applyConversationEvent(state, { sessionId: 'cc', eventId: 'next-presence' }, new Date(now.getTime() + 3600000));
  assert.equal(result.state.pendingAwareness.residue, state.pendingAwareness.residue);
  assert.deepEqual(result.state.pendingAwareness.xiaowoHug, state.pendingAwareness.xiaowoHug);
  assert.equal(result.state.consciousness, 'awake');
});

test('sleeping hug then conversation wake retains both current dream residue and hug', () => {
  const state = newState(now);
  state.consciousness = 'sleeping';
  state.sleepStartedAt = now.toISOString();
  recordXiaowoHugAwareness(state, { ...hug, contextType: 'petal', contextId: 'crave' }, new Date(now.getTime() + 60000));
  assert.equal(state.consciousness, 'sleeping');
  const hugId = state.pendingAwareness.id;
  state.recentDreams.push({ id: 'this-sleep-dream', createdAt: new Date(now.getTime() + 120000).toISOString(), residue: '窗边那盏灯' });
  const wakeAt = new Date(now.getTime() + 180000);
  const result = applyConversationEvent(state, { sessionId: 'cc', eventId: 'wake-with-dream' }, wakeAt);
  const pending = result.state.pendingAwareness;
  assert.equal(result.state.consciousness, 'awake');
  assert.equal(pending.dreamId, 'this-sleep-dream');
  assert.equal(pending.residue, '芥子从小窝送来一个拥抱（花瓣：crave）。 窗边那盏灯');
  assert.notEqual(pending.id, hugId);
  assert.equal(acknowledgePendingAwareness(result.state, hugId, wakeAt).consumed, false);
  const replay = applyConversationEvent(result.state, { sessionId: 'cc', eventId: 'wake-replay' }, wakeAt);
  assert.deepEqual(replay.state.pendingAwareness, pending);
  recordXiaowoHugAwareness(replay.state, { ...hug, eventId: 'xiaowo-hug-after-wake' }, wakeAt);
  assert.equal(replay.state.pendingAwareness.residue, '芥子从小窝送来 2 个拥抱（花瓣：crave）。 窗边那盏灯');
  const acked = acknowledgePendingAwareness(replay.state, replay.state.pendingAwareness.id, wakeAt);
  assert.equal(acked.consumed, true);
  assert.equal(acked.state.pendingAwareness, null);
});

test('non-hugs are untouched and hug versions do not add duplicate self-signal wakes', () => {
  const state = newState(now);
  const before = structuredClone(state);
  recordXiaowoHugAwareness(state, { ...hug, interactionType: 'sharing' }, now);
  recordXiaowoHugAwareness(state, { ...hug, eventId: 'dashboard-affection' }, now);
  assert.deepEqual(state, before);
  recordXiaowoHugAwareness(state, hug, now);
  assert.equal(evaluateSelfSignal(before, state, { type: 'conversation_event' }, now).signal, null);
});
