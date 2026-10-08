import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, applyConversationEvent } from '../src/engine.js';
import { recordXiaowoHugAwareness } from '../src/xiaowo-hug-awareness.js';
import { evaluateSelfSignal } from '../src/self-signal.js';

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
  assert.deepEqual(result.state.pendingAwareness, state.pendingAwareness);
  assert.equal(result.state.consciousness, 'awake');
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
