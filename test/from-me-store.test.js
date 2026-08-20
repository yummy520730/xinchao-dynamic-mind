import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FromMeStore } from '../src/from-me-store.js';

test('AI outbox persists, deduplicates and never accepts unsupported kinds', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-from-me-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  const store = new FromMeStore(join(directory, 'from-me.json'));
  const first = await store.add({ eventId:'ai-message-0001', kind:'pending_from_me', message:'等你回来。' });
  const duplicate = await store.add({ eventId:'ai-message-0001', kind:'pending_from_me', message:'不会覆盖。' });
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await store.list())[0].human.message, '等你回来。');
  await assert.rejects(() => store.add({ eventId:'ai-message-0002', kind:'user_note', message:'不允许' }), /not supported/);
});

test('completed action results require and preserve their motivating drive', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-action-result-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  const store = new FromMeStore(join(directory, 'from-me.json'));
  await assert.rejects(
    () => store.add({ eventId:'action-result-0001', kind:'action_result', message:'已经分享。' }),
    /drive_key is required/,
  );
  const first = await store.add({
    eventId:'action-result-0001', kind:'action_result', driveKey:'share', message:'已经分享。',
  });
  const repeated = await store.add({
    eventId:'action-result-0001', kind:'action_result', driveKey:'share', message:'重复结果。',
  });
  assert.equal(first.duplicate, false);
  assert.equal(repeated.duplicate, true);
  assert.equal(first.item.ai.context.drive, 'share');
});
