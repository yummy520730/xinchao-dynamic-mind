import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BridgeQueue } from '../src/bridge-queue.js';

test('Bridge queue persists, deduplicates and acknowledges user interactions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-bridge-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const queue = new BridgeQueue(join(directory, 'queue.json'));
  const now = new Date('2026-08-03T09:00:00.000Z');
  const first = await queue.enqueue({
    eventId: 'user-action-0001',
    reason: 'user_interaction',
    message: '用户给了你一个拥抱。',
  }, now);
  const repeated = await queue.enqueue({
    eventId: 'user-action-0001',
    reason: 'user_interaction',
    message: '不能覆盖首次投递。',
  }, now);
  assert.equal(first.duplicate, false);
  assert.equal(repeated.duplicate, true);
  assert.equal((await queue.ready(now)).length, 1);
  const envelope = await queue.get(first.delivery.id, now);
  assert.equal(envelope.protocol, 'xinchao-runtime-wake/1');
  assert.equal(envelope.reason, 'user_interaction');
  assert.equal(envelope.message, '用户给了你一个拥抱。');
  const acknowledged = await queue.acknowledge(first.delivery.id, 'delivered', '', now);
  assert.equal(acknowledged.status, 'delivered');
  assert.equal((await queue.ready(now)).length, 0);
});

test('Bridge queue rejects autonomous AI content', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-bridge-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const queue = new BridgeQueue(join(directory, 'queue.json'));
  await assert.rejects(() => queue.enqueue({
    eventId: 'autonomous-dream-1',
    reason: 'dream_residue',
    message: '梦境不允许自动注入。',
  }), /user interactions only/);
});


test('Bridge queue gates, deduplicates, coalesces and defers self signals', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-bridge-self-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'queue.json');
  const now = new Date('2026-09-24T04:00:00.000Z');

  const disabled = new BridgeQueue(path, { selfSignalsEnabled: false });
  await assert.rejects(() => disabled.enqueue({
    eventId: 'self-signal-0001',
    reason: 'self_signal',
    message: 'drive crossing',
  }, now), /self_signal is disabled/);

  const queue = new BridgeQueue(path, { selfSignalsEnabled: true });
  const first = await queue.enqueue({
    eventId: 'self-signal-0001',
    deliveryId: 'delivery-self-00000000000000000000000000000001',
    reason: 'self_signal',
    coalesceKey: 'drive:possess',
    message: 'possess crossing',
    wake: {
      protocol: 'xinchao-wake-bridge/1',
      kind: 'drive_transition',
      audience: 'ai',
      ai: { context: { drive: 'possess', value: 0.7 } },
    },
  }, now);
  assert.equal(first.duplicate, false);
  assert.equal(first.delivery.id, 'delivery-self-00000000000000000000000000000001');

  const duplicate = await queue.enqueue({
    eventId: 'self-signal-0001',
    reason: 'self_signal',
    coalesceKey: 'drive:possess',
    message: 'must not replace exact retry',
  }, now);
  assert.equal(duplicate.duplicate, true);

  const coalesced = await queue.enqueue({
    eventId: 'self-signal-0002',
    reason: 'self_signal',
    coalesceKey: 'drive:possess',
    message: 'newer possess crossing',
    wake: {
      protocol: 'xinchao-wake-bridge/1',
      kind: 'drive_transition',
      audience: 'ai',
      ai: { context: { drive: 'possess', value: 0.75 } },
    },
  }, new Date('2026-09-24T04:01:00.000Z'));
  assert.equal(coalesced.coalesced, true);
  assert.equal(coalesced.delivery.id, first.delivery.id);
  assert.deepEqual(coalesced.delivery.eventIds, ['self-signal-0001', 'self-signal-0002']);

  const envelope = await queue.get(first.delivery.id, now);
  assert.equal(envelope.reason, 'self_signal');
  assert.equal(envelope.wake.kind, 'drive_transition');
  assert.equal(envelope.wake.ai.context.value, 0.75);

  const failedAt = new Date('2026-09-24T04:02:00.000Z');
  const deferred = await queue.acknowledge(
    first.delivery.id,
    'retryable_failed',
    'global_cooldown',
    failedAt,
    600,
  );
  assert.equal(deferred.status, 'pending');
  assert.equal(deferred.lastFailureCode, 'global_cooldown');
  assert.equal(deferred.deliverAfter, '2026-09-24T04:12:00.000Z');
  assert.equal((await queue.ready(new Date('2026-09-24T04:11:59.000Z'))).length, 0);
  assert.equal((await queue.ready(new Date('2026-09-24T04:12:00.000Z'))).length, 1);

  const byEvent = await queue.acknowledgeEvent(
    'self-signal-0002',
    'delivered',
    'current_session',
    new Date('2026-09-24T04:13:00.000Z'),
  );
  assert.equal(byEvent.status, 'delivered');
  assert.equal((await queue.ready(new Date('2026-09-24T04:13:00.000Z'))).length, 0);
});
