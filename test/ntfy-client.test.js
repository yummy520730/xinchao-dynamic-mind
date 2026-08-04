import test from 'node:test';
import assert from 'node:assert/strict';
import { NtfyClient } from '../src/ntfy-client.js';

test('ntfy publishes JSON with optional bearer authentication', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return { ok: true }; };
  try {
    const client = new NtfyClient({ enabled:true, server:'https://ntfy.sh', topic:'private-topic', token:'test-token', title:'心潮', tags:['thought_balloon'], priority:4 });
    assert.equal((await client.send('测试余韵')).sent, true);
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.equal(JSON.parse(request.options.body).topic, 'private-topic');
  } finally { globalThis.fetch = originalFetch; }
});

test('ntfy stays disabled without a topic', async () => {
  assert.deepEqual(await new NtfyClient({ enabled:true, topic:'' }).send('x'), { sent:false, reason:'disabled' });
});
