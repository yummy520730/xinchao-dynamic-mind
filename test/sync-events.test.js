import assert from 'node:assert/strict';
import test from 'node:test';

import { buildXinchaoSourceEvent, canonicalXinchaoIdentity, XinchaoSyncEvents } from '../src/sync-events.js';

class MemoryJournal {
  constructor() { this.items = []; }
  async append(item) { this.items.push(structuredClone(item)); return item; }
  async list({ types = [] } = {}) { return this.items.filter((item) => !types.length || types.includes(item.type)).slice().reverse(); }
}

const config = {
  enabled: true,
  url: 'http://127.0.0.1:8791/events',
  token: 'sync-engine-secret-token-32-characters',
  timeoutMs: 1000,
};

test('same xinchao event id retry reuses source identity, occurred_at and body', async () => {
  const journal = new MemoryJournal();
  const bodies = [];
  const adapter = new XinchaoSyncEvents({
    config,
    journal,
    fetchImpl: async (_url, init) => { bodies.push(init.body); return { status: 503 }; },
  });
  const event = { eventId: 'presence-turn-1', sessionId: 'session-1' };
  await adapter.recordConversation(event, 'presence', new Date('2026-09-08T01:00:00Z'));
  await adapter.recordConversation(event, 'presence', new Date('2026-09-08T02:00:00Z'));
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(canonicalXinchaoIdentity(event.eventId), canonicalXinchaoIdentity(event.eventId));
});

test('presence drops prompt text and interaction retains optional causal evidence', () => {
  const presence = buildXinchaoSourceEvent({
    eventId: 'presence-turn-2',
    sessionId: 'session-2',
    prompt: 'private prompt text',
    text: 'private user text',
  }, 'presence', new Date('2026-09-08T01:00:00Z'));
  assert.deepEqual(presence.payload, { event_kind: 'presence' });
  assert.doesNotMatch(JSON.stringify(presence), /private prompt text|private user text/);

  const interaction = buildXinchaoSourceEvent({
    eventId: 'interaction-turn-1',
    interactionType: 'affection',
    sessionId: 'session-2',
    turnId: 'turn-2',
    triggerEventId: 'trigger-1',
    causalParentId: 'parent-1',
    interactionId: 'interaction-1',
    occurredAt: '2026-09-08T01:02:03Z',
  }, 'interaction');
  assert.equal(interaction.type, 'mind.interaction');
  assert.equal(interaction.payload.interaction_type, 'affection');
  assert.deepEqual(interaction.correlation_hint, {
    session_id: 'session-2',
    turn_id: 'turn-2',
    trigger_event_id: 'trigger-1',
    causal_parent_id: 'parent-1',
    interaction_id: 'interaction-1',
  });
});

test('sync failure is logged safely and resolves without rolling back the completed mutation', async () => {
  const journal = new MemoryJournal();
  const logs = [];
  const adapter = new XinchaoSyncEvents({
    config,
    journal,
    fetchImpl: async () => {
      const error = new Error('token=sync-engine-secret-token-32-characters prompt=private-text');
      error.code = 'ECONNRESET';
      throw error;
    },
    log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
  });
  const mind = { revision: 1 };
  mind.revision = 2;
  const result = await adapter.recordConversation({ eventId: 'interaction-turn-2', interactionType: 'sharing' }, 'interaction');
  assert.equal(result.ok, false);
  assert.equal(mind.revision, 2);
  assert.match(logs.join('\n'), /ECONNRESET/);
  assert.doesNotMatch(logs.join('\n'), /sync-engine-secret|private-text|prompt=/);
  assert.ok(journal.items.some((item) => item.type === 'sync_event_pending'));
});

test('successful replay writes an ack and a later retry makes no network call', async () => {
  const journal = new MemoryJournal();
  let calls = 0;
  const adapter = new XinchaoSyncEvents({
    config,
    journal,
    fetchImpl: async () => { calls += 1; return { status: calls === 1 ? 503 : 200 }; },
  });
  const event = { eventId: 'presence-turn-3', sessionId: 'session-3' };
  await adapter.recordConversation(event, 'presence');
  await adapter.replayPending();
  await adapter.recordConversation(event, 'presence');
  assert.equal(calls, 2);
  assert.ok(journal.items.some((item) => item.type === 'sync_event_ack'));
});
