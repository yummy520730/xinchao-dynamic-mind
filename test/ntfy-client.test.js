import test from 'node:test';
import assert from 'node:assert/strict';
import { NtfyClient } from '../src/ntfy-client.js';

test('ntfy publishes a JSON notification with optional bearer auth', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true };
  };
  try {
    const client = new NtfyClient({
      enabled: true,
      server: 'https://ntfy.sh',
      topic: 'private-random-topic',
      token: 'test-token',
      title: '心潮',
      tags: ['thought_balloon'],
      priority: 4,
    });
    const result = await client.send('测试余韵');
    assert.equal(result.sent, true);
    assert.equal(request.url, 'https://ntfy.sh/');
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(request.options.body), {
      topic: 'private-random-topic',
      title: '心潮',
      message: '测试余韵',
      tags: ['thought_balloon'],
      priority: 4,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ntfy stays disabled until a topic is configured', async () => {
  const client = new NtfyClient({ enabled: true, topic: '' });
  assert.deepEqual(await client.send('x'), { sent: false, reason: 'disabled' });
});
