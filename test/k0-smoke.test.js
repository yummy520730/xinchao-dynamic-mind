import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueueK0Smoke } from '../scripts/enqueue-k0-smoke.mjs';

test('k0 smoke enqueue is local, bounded, and not chat memory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-k0-'));
  try {
    const queuePath = join(directory, 'bridge-queue.json');
    const statePath = join(directory, 'state.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(statePath, `${JSON.stringify({ pendingAwareness: { id: 'keep-me' } })}\n`);
    const queued = await enqueueK0Smoke(queuePath, {
      label: 'recent human!',
      now: new Date('2026-09-24T03:00:00Z'),
    });
    assert.equal(queued.duplicate, false);
    assert.equal(queued.delivery.reason, 'self_signal');
    assert.equal(queued.delivery.wake.audience, 'ai');
    assert.equal(queued.delivery.wake.ai.context.evidence_type, 'k0_smoke');
    assert.equal(queued.delivery.message.includes('Not memory'), true);
    const raw = await readFile(queuePath, 'utf8');
    assert.equal(raw.includes('session_id'), false);
    assert.equal(raw.includes('prompt'), false);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.pendingAwareness.id, 'keep-me');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
