import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_TRANSITIONS,
  applyConversationEvent,
  newState,
  sessionOverlayProjection,
  settleAndApplyConversationEvent,
} from '../src/engine.js';

const options = {
  interaction: { timeZone: 'Asia/Shanghai', maxInteractionEffectsPerDay: 24 },
};

function event(sessionId, eventId, interactionType, interactionId, extra = {}) {
  return {
    sessionId,
    eventId,
    interactionType,
    interactionId,
    ...extra,
  };
}

test('interaction type moves the same CC session and the next presence reads it back', () => {
  const start = new Date('2026-09-23T00:00:00Z');
  const presence = settleAndApplyConversationEvent(newState(start), {
    sessionId: 'cc-session-A',
    eventId: 'presence-A-1',
  }, start, options);
  assert.deepEqual(sessionOverlayProjection(presence.state, 'cc-session-A', start), {
    tone: 'neutral',
    warmth: 0.5,
    tension: 0,
    attention: 0.5,
    confidence: 0.5,
  });
  assert.equal(presence.interaction.applied, false);

  const before = presence.state.drives.possess;
  const affection = settleAndApplyConversationEvent(presence.state, event(
    'cc-session-A',
    'interaction:auto:affection',
    'affection',
    'cc:cc-session-A:prompt-1',
  ), new Date('2026-09-23T00:05:00Z'), options);
  assert.equal(affection.interaction.applied, true);
  assert.equal(affection.interaction.reasonCode, 'applied');
  assert.ok(affection.state.drives.possess < before);
  const at = new Date('2026-09-23T00:05:00Z');
  const overlay = sessionOverlayProjection(affection.state, 'cc-session-A', at);
  assert.equal(overlay.tone, 'warm');
  assert.equal(overlay.warmth, 0.58);
  assert.equal(overlay.tension, 0);

  const next = settleAndApplyConversationEvent(affection.state, {
    sessionId: 'cc-session-A',
    eventId: 'presence-A-2',
  }, new Date('2026-09-23T00:06:00Z'), options);
  assert.deepEqual(
    sessionOverlayProjection(next.state, 'cc-session-A', new Date('2026-09-23T00:06:00Z')),
    overlay,
  );
});

test('task_progress relieves duty and raises attention and confidence', () => {
  const now = new Date('2026-09-23T01:00:00Z');
  const initial = newState(now);
  const result = applyConversationEvent(initial, event(
    'cc-session-A',
    'interaction:auto:task',
    'task_progress',
    'cc:cc-session-A:prompt-2',
  ), now, options.interaction);
  assert.equal(result.interaction.applied, true);
  assert.ok(result.state.drives.duty < initial.drives.duty);
  const overlay = sessionOverlayProjection(result.state, 'cc-session-A', now);
  assert.equal(overlay.attention, 0.54);
  assert.equal(overlay.confidence, 0.58);
  assert.equal(overlay.tone, 'focused');
});

test('conflict then reconciliation moves tension without resetting the session', () => {
  const now = new Date('2026-09-23T02:00:00Z');
  const conflict = applyConversationEvent(newState(now), event(
    'cc-session-A',
    'interaction:auto:conflict',
    'conflict',
    'cc:cc-session-A:prompt-3',
  ), now, options.interaction);
  const conflicted = sessionOverlayProjection(conflict.state, 'cc-session-A', now);
  assert.equal(conflicted.tone, 'conflicted');
  assert.equal(conflicted.tension, 0.1);
  assert.equal(conflicted.warmth, 0.46);

  const later = new Date('2026-09-23T02:10:00Z');
  const reconciled = applyConversationEvent(conflict.state, event(
    'cc-session-A',
    'interaction:auto:reconcile',
    'reconciliation',
    'cc:cc-session-A:prompt-4',
  ), later, options.interaction);
  const overlay = sessionOverlayProjection(reconciled.state, 'cc-session-A', later);
  assert.equal(overlay.tone, 'warm');
  assert.equal(overlay.tension, 0.02);
  assert.equal(overlay.warmth, 0.54);
  assert.notDeepEqual(overlay, {
    tone: 'neutral',
    warmth: 0.5,
    tension: 0,
    attention: 0.5,
    confidence: 0.5,
  });
  assert.ok(reconciled.state.drives.anger < conflict.state.drives.anger);
});

test('session overlays stay isolated across CC sessions', () => {
  const now = new Date('2026-09-23T03:00:00Z');
  let state = newState(now);
  state = applyConversationEvent(state, event(
    'cc-session-A',
    'interaction:auto:a',
    'affection',
    'cc:cc-session-A:prompt-5',
  ), now, options.interaction).state;
  const other = applyConversationEvent(state, {
    sessionId: 'cc-session-B',
    eventId: 'presence-B',
  }, new Date('2026-09-23T03:01:00Z'), options.interaction);
  assert.equal(sessionOverlayProjection(other.state, 'cc-session-A', now).warmth, 0.58);
  assert.equal(sessionOverlayProjection(other.state, 'cc-session-B', now).warmth, 0.5);
  assert.equal(sessionOverlayProjection(other.state, 'cc-session-B', now).tone, 'neutral');
});

test('auto and manual events with one interaction id settle once', () => {
  const now = new Date('2026-09-23T04:00:00Z');
  const interactionId = 'cc:cc-session-A:prompt-6';
  const first = settleAndApplyConversationEvent(newState(now), event(
    'cc-session-A',
    'interaction:auto:task6',
    'task_progress',
    interactionId,
  ), now, options);
  const second = settleAndApplyConversationEvent(first.state, event(
    'cc-session-A',
    'interaction:manual:task6',
    'task_progress',
    interactionId,
  ), new Date('2026-09-23T04:01:00Z'), options);
  assert.equal(first.interaction.applied, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.interaction.applied, false);
  assert.equal(second.interaction.reasonCode, 'duplicate_interaction');
  assert.equal(second.state.drives.duty, first.state.drives.duty);
  assert.equal(second.state.interactionUsage['2026-09-23'], 1);
  assert.equal(
    sessionOverlayProjection(second.state, 'cc-session-A', now).confidence,
    sessionOverlayProjection(first.state, 'cc-session-A', now).confidence,
  );
});

test('a disagreed manual type does not apply a second drive or session effect', () => {
  const now = new Date('2026-09-23T05:00:00Z');
  const interactionId = 'cc:cc-session-A:prompt-7';
  const auto = applyConversationEvent(newState(now), event(
    'cc-session-A',
    'interaction:auto:comp',
    'companionship',
    interactionId,
  ), now, options.interaction);
  const manual = applyConversationEvent(auto.state, event(
    'cc-session-A',
    'interaction:manual:aff',
    'affection',
    interactionId,
  ), new Date('2026-09-23T05:01:00Z'), options.interaction);
  assert.equal(manual.duplicate, true);
  assert.equal(manual.interaction.applied, false);
  assert.equal(manual.interaction.reasonCode, 'already_settled');
  assert.equal(manual.interaction.disagreement, true);
  assert.equal(manual.interaction.priorType, 'companionship');
  assert.deepEqual(manual.state.drives, auto.state.drives);
  assert.equal(
    sessionOverlayProjection(manual.state, 'cc-session-A', now).warmth,
    sessionOverlayProjection(auto.state, 'cc-session-A', now).warmth,
  );
});

test('session transitions are bounded and use only legal tones', () => {
  const legal = new Set(['neutral', 'calm', 'warm', 'guarded', 'conflicted', 'focused', 'playful', 'tired']);
  for (const [type, transition] of Object.entries(SESSION_TRANSITIONS)) {
    if (transition.tone) assert.equal(legal.has(transition.tone), true, type);
    for (const key of ['warmth', 'tension', 'attention', 'confidence']) {
      if (transition[key] == null) continue;
      assert.ok(Math.abs(transition[key]) <= 0.12, `${type}.${key}`);
    }
  }
  const now = new Date('2026-09-23T06:00:00Z');
  let state = newState(now);
  state.sessionOverlays['cc-session-A'] = {
    sessionId: 'cc-session-A',
    tone: 'warm',
    warmth: 0.99,
    tension: 0.01,
    attention: 0.99,
    confidence: 0.99,
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  };
  const capped = applyConversationEvent(state, event(
    'cc-session-A',
    'interaction:auto:cap',
    'affection',
    'cc:cc-session-A:prompt-cap',
  ), now, options.interaction);
  assert.equal(sessionOverlayProjection(capped.state, 'cc-session-A', now).warmth, 1);
  assert.equal(sessionOverlayProjection(capped.state, 'cc-session-A', now).tension, 0);
});

test('expired session overlays still expire on the existing TTL', () => {
  const start = new Date('2026-09-23T07:00:00Z');
  const state = applyConversationEvent(newState(start), {
    sessionId: 'cc-session-A',
    eventId: 'interaction:auto:ttl',
    interactionType: 'sharing',
    interactionId: 'cc:cc-session-A:prompt-ttl',
    sessionTtlMinutes: 15,
  }, start, options.interaction).state;
  assert.equal(sessionOverlayProjection(state, 'cc-session-A', start).attention, 0.54);
  const later = new Date('2026-09-23T07:16:00Z');
  assert.equal(sessionOverlayProjection(state, 'cc-session-A', later), null);
});
