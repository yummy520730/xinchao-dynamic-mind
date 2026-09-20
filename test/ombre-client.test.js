import test from 'node:test';
import assert from 'node:assert/strict';
import { OmbreClient } from '../src/ombre-client.js';

test('dream records stay inside Xinchao and are never queued as LMC candidates', async () => {
  const client = new OmbreClient({
    writeEnabled: true,
    readEnabled: false,
    transport: 'lmc5_bridge',
    bridgeUrl: 'https://memory.example.com',
    bridgeToken: 'token',
  });
  let called = 0;
  client.bridgePost = async () => {
    called += 1;
    return { candidate_id: 'should-not-exist' };
  };
  client.call = async () => {
    called += 1;
    return { result: { content: [{ type: 'text', text: '已保存 abcdef123456' }] } };
  };

  const stored = await client.storeDream({
    dream: '一盏灯',
    residue: '安静',
    awareness: '记得回来',
  });

  assert.equal(stored, null);
  assert.equal(called, 0);
});

test('completed action experience uses a stable LMC candidate id across retries', async () => {
  const client = new OmbreClient({
    writeEnabled: true,
    readEnabled: false,
    transport: 'lmc5_bridge',
    bridgeUrl: 'https://memory.example.com',
    bridgeToken: 'token',
  });
  const captured = [];
  client.bridgePost = async (path, payload) => {
    captured.push({ path, payload });
    return { candidate_id: 'candidate-1' };
  };
  const action = {
    eventId: 'action-result-stable-0001', kind: 'action_result', driveKey: 'share', message: '已经分享。',
  };
  await client.storeActionExperience(action);
  await client.storeActionExperience(action);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].path, '/bridge/xinchao/candidates');
  assert.equal(captured[0].payload.external_id, captured[1].payload.external_id);
  assert.match(captured[0].payload.external_id, /^action:/);
  assert.equal(captured[0].payload.category, 'episode');
  assert.match(captured[0].payload.content, /已经发生的行动结果/);
});


test('historical episode requests contiguous LMC source with weak state projection only', async () => {
  const client = new OmbreClient({
    writeEnabled: false,
    readEnabled: true,
    transport: 'lmc5_bridge',
    bridgeUrl: 'https://memory.example.com',
    bridgeToken: 'token',
  });
  let captured;
  client.bridgePost = async (path, payload) => {
    captured = { path, payload };
    return { status: 'ok', event_ids: [101, 102], source_date: '2026-08-18' };
  };
  const result = await client.fetchHistoricalEpisode({
    stateProjection: { attachment: 'high', warmth: 'medium' },
    recentSourceDates: ['2026-08-01'],
    minChars: 2000,
    maxChars: 6000,
  });
  assert.equal(captured.path, '/bridge/xinchao/historical-episode');
  assert.deepEqual(captured.payload.state_projection, { attachment: 'high', warmth: 'medium' });
  assert.deepEqual(captured.payload.recent_source_dates, ['2026-08-01']);
  assert.equal(result.status, 'ok');
});

test('historical events request exact LMC ids and date without search fallback', async () => {
  const client = new OmbreClient({
    writeEnabled: false,
    readEnabled: true,
    transport: 'lmc5_bridge',
    bridgeUrl: 'https://memory.example.com',
    bridgeToken: 'token',
  });
  let captured;
  client.bridgePost = async (path, payload) => {
    captured = { path, payload };
    return {
      status: 'ok',
      source_date: '2026-07-12',
      requested_count: 84,
      returned_count: 84,
      missing_count: 0,
      messages: [{ role: 'user', content: '门口还挂着风铃。', created_at: '2026-07-12T06:20:00+00:00' }],
    };
  };
  const result = await client.fetchHistoricalEvents({
    eventIds: [1000, 1001],
    sourceDate: '2026-07-12',
  });
  assert.equal(captured.path, '/bridge/xinchao/historical-events');
  assert.deepEqual(captured.payload, { event_ids: [1000, 1001], source_date: '2026-07-12' });
  assert.equal(result.status, 'ok');
  assert.equal(result.returned_count, 84);
});

test('historical events refuse non-bridge transports instead of searching', async () => {
  const client = new OmbreClient({
    writeEnabled: false,
    readEnabled: true,
    transport: 'mcp',
    url: 'https://memory.example.com/mcp',
    token: 'token',
  });
  client.call = async () => {
    throw new Error('must not fall back to recall');
  };
  await assert.rejects(
    () => client.fetchHistoricalEvents({ eventIds: [1, 2], sourceDate: '2026-07-12' }),
    /lmc5_bridge/,
  );
});
