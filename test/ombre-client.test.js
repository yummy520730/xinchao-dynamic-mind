import test from 'node:test';
import assert from 'node:assert/strict';
import { OmbreClient } from '../src/ombre-client.js';

test('automatic dream writes identify themselves and never impersonate manual memory', async () => {
  const client = new OmbreClient({
    writeEnabled: true,
    readEnabled: false,
    url: 'http://unused.invalid/mcp',
    token: '',
    breathMaxResults: 3,
    breathMaxTokens: 800,
  });
  let captured;
  client.call = async (name, args) => {
    captured = { name, args };
    return { result: { content: [{ type: 'text', text: '已保存 abcdef123456' }] } };
  };

  await client.storeDream({
    dream: '一盏灯',
    residue: '安静',
    awareness: '记得回来',
  });

  assert.equal(captured.name, 'hold');
  assert.equal(captured.args.auto, true);
  assert.equal(captured.args.source, 'xinchao-dream');
  assert.equal(captured.args.importance, 7);
  assert.equal(captured.args.tags, 'dream');
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
