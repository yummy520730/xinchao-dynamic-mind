import assert from 'node:assert/strict';
import test from 'node:test';

import { applyConversationEvent, applyDriveFeedback, newState } from '../src/engine.js';
import {
  consumePendingAwareness,
  ensureSelfSignalState,
  evaluateSelfSignal,
  markSelfSignalQueued,
  selfSignalDeliveryId,
  selfSignalEventId,
} from '../src/self-signal.js';

test('wall clock settlement never manufactures a self signal', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  const before = newState(now);
  const after = structuredClone(before);
  after.drives.possess = 0.89;
  const evaluated = evaluateSelfSignal(
    before,
    after,
    { type: 'settle', source: 'timer', at: new Date('2026-09-24T04:00:00Z') },
    new Date('2026-09-24T04:00:00Z'),
  );
  assert.equal(evaluated.signal, null);
});

test('drive crossing emits once, disarms, and only rearms below hysteresis', () => {
  const now = new Date('2026-09-24T01:00:00Z');
  const before = newState(now);
  before.drives.possess = 0.60;
  const after = structuredClone(before);
  after.drives.possess = 0.68;

  const first = evaluateSelfSignal(
    before,
    after,
    { type: 'conversation_event', eventId: 'interaction-0001' },
    now,
    { thresholdRatio: 0.72, rearmRatio: 0.52, minDelta: 0.025 },
  );
  assert.equal(first.signal.kind, 'drive_transition');
  assert.equal(first.signal.driveKey, 'possess');
  assert.equal(first.signal.deliveryId, selfSignalDeliveryId(first.signal.eventId));

  const latched = markSelfSignalQueued(first.state, first.signal, now);
  const secondAfter = structuredClone(latched);
  secondAfter.drives.possess = 0.74;
  const second = evaluateSelfSignal(
    latched,
    secondAfter,
    { type: 'conversation_event', eventId: 'interaction-0002' },
    new Date('2026-09-24T01:10:00Z'),
  );
  assert.equal(second.signal, null);

  const low = structuredClone(second.state);
  low.drives.possess = 0.40;
  const rearmed = evaluateSelfSignal(
    second.state,
    low,
    { type: 'action_satisfied', eventId: 'action-0001' },
    new Date('2026-09-24T01:20:00Z'),
  );
  assert.equal(rearmed.signal, null);
  assert.equal(rearmed.state.selfSignalState.driveArmed.possess, true);

  const crossedAgain = structuredClone(rearmed.state);
  crossedAgain.drives.possess = 0.70;
  const third = evaluateSelfSignal(
    rearmed.state,
    crossedAgain,
    { type: 'memory_resonance', eventId: 'memory-0001' },
    new Date('2026-09-24T01:30:00Z'),
  );
  assert.equal(third.signal.driveKey, 'possess');
});

test('pending awareness has stable self-signal id and moves into consumed history', () => {
  const start = new Date('2026-09-24T02:00:00Z');
  let sleeping = newState(start);
  sleeping.consciousness = 'sleeping';
  sleeping.sleepStartedAt = '2026-09-24T01:00:00.000Z';
  sleeping.recentDreams.push({
    id: 'dream-20260924',
    createdAt: '2026-09-24T01:30:00.000Z',
    residue: '醒来还记得窗边那盏灯。',
  });

  const before = structuredClone(sleeping);
  const result = applyConversationEvent(
    sleeping,
    { sessionId: 'cc-A', eventId: 'presence-0001' },
    new Date('2026-09-24T02:01:00Z'),
  );
  const pending = result.state.pendingAwareness;
  assert.ok(pending.id);
  assert.equal(pending.dreamId, 'dream-20260924');

  const evaluated = evaluateSelfSignal(
    before,
    result.state,
    { type: 'conversation_event', eventId: 'presence-0001' },
    new Date('2026-09-24T02:01:00Z'),
  );
  assert.equal(evaluated.signal.kind, 'pending_awareness');
  assert.equal(
    evaluated.signal.eventId,
    selfSignalEventId('awareness', pending.id),
  );

  const consumed = consumePendingAwareness(
    evaluated.state,
    pending.id,
    new Date('2026-09-24T02:02:00Z'),
    'mind_presence',
  );
  assert.equal(consumed.consumed, true);
  assert.equal(consumed.state.pendingAwareness, null);
  assert.equal(consumed.state.awarenessHistory.at(-1).id, pending.id);
  assert.equal(consumed.state.awarenessHistory.at(-1).via, 'mind_presence');
});

test('ordinary drive feedback below threshold does not signal', () => {
  const now = new Date('2026-09-24T03:00:00Z');
  const before = ensureSelfSignalState(newState(now));
  const after = applyDriveFeedback(before, { curiosity: 0.01 }, now);
  const evaluated = evaluateSelfSignal(
    before,
    after,
    { type: 'memory_resonance', eventId: 'memory-small-1' },
    now,
  );
  assert.equal(evaluated.signal, null);
});


test('legacy pending awareness without id is migrated deterministically', () => {
  const now = new Date('2026-09-24T05:00:00Z');
  const legacy = newState(now);
  legacy.schemaVersion = 14;
  legacy.pendingAwareness = {
    createdAt: '2026-09-22T20:00:00.000Z',
    dreamId: 'dream-legacy-0922',
    residue: '旧梦余韵',
  };
  const migrated = applyDriveFeedback(legacy, {}, now);
  assert.equal(migrated.schemaVersion, 15);
  assert.match(migrated.pendingAwareness.id, /^awareness-/);

  const again = applyDriveFeedback(migrated, {}, new Date('2026-09-24T05:01:00Z'));
  assert.equal(again.pendingAwareness.id, migrated.pendingAwareness.id);
});


test('new wake archives an older unconsumed awareness instead of silently overwriting it', () => {
  const firstWakeAt = new Date('2026-09-22T20:00:00Z');
  const state = newState(firstWakeAt);
  state.pendingAwareness = {
    id: 'awareness-old-0922',
    createdAt: '2026-09-22T20:00:00.000Z',
    dreamId: 'dream-old-0922',
    residue: '旧余韵',
  };
  state.consciousness = 'sleeping';
  state.sleepStartedAt = '2026-09-24T00:00:00.000Z';
  state.recentDreams.push({
    id: 'dream-new-0924',
    createdAt: '2026-09-24T01:00:00.000Z',
    residue: '新余韵',
  });

  const result = applyConversationEvent(
    state,
    { sessionId: 'cc-B', eventId: 'presence-new-wake' },
    new Date('2026-09-24T02:00:00Z'),
  );

  assert.equal(result.state.pendingAwareness.dreamId, 'dream-new-0924');
  const archived = result.state.awarenessHistory.at(-1);
  assert.equal(archived.id, 'awareness-old-0922');
  assert.equal(archived.status, 'superseded');
  assert.equal(archived.via, 'superseded_by_new_awareness');
  assert.equal(archived.supersededBy, result.state.pendingAwareness.id);
});
