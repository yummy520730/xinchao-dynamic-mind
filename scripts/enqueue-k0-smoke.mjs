import { fileURLToPath } from 'node:url';
import { BridgeQueue, SELF_SIGNAL_REASON } from '../src/bridge-queue.js';
import { selfSignalDeliveryId, selfSignalEventId } from '../src/self-signal.js';
import { createWakeBridgeEnvelope } from '../src/wake-bridge-protocol.js';

export async function enqueueK0Smoke(queuePath, { label = 'k0', now = new Date() } = {}) {
  const safeLabel = String(label).replace(/[^\w.-]/g, '').slice(0, 24) || 'k0';
  const eventId = selfSignalEventId('smoke', `${safeLabel}\n${now.toISOString()}`);
  const wake = createWakeBridgeEnvelope({
    kind: 'drive_transition',
    audience: 'ai',
    aiContext: {
      drive: 'curiosity',
      evidence_type: 'k0_smoke',
      smoke_label: safeLabel,
    },
    source: 'xinchao-k0-smoke',
    dedupeKey: eventId,
    ttlHours: 2,
    now,
  });
  const queue = new BridgeQueue(queuePath, { selfSignalsEnabled: true, ttlHours: 2 });
  return queue.enqueue({
    eventId,
    reason: SELF_SIGNAL_REASON,
    message: 'K0 smoke self_signal. Not memory.',
    deliveryId: selfSignalDeliveryId(eventId),
    coalesceKey: `smoke:${safeLabel}:${now.toISOString()}`,
    wake,
  }, now);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes('--confirm-local-queue')) {
    console.error('refusing: this helper writes only a local bridge queue file');
    process.exit(2);
  }
  const queuePath = process.env.BRIDGE_STATE_PATH;
  if (!queuePath) {
    console.error('BRIDGE_STATE_PATH is required');
    process.exit(2);
  }
  const label = process.argv.includes('--idle') ? 'k0-idle' : 'k0-recent-human';
  const queued = await enqueueK0Smoke(queuePath, { label });
  console.log(JSON.stringify({
    queued: true,
    duplicate: queued.duplicate,
    deliveryId: queued.delivery.id,
    kind: 'drive_transition',
    evidence_type: 'k0_smoke',
  }));
}
