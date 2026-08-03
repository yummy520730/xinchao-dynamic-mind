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

test('LMC bridge dream ids are stable content fingerprints', async () => {
  const client = new OmbreClient({
    transport: 'lmc5_bridge',
    writeEnabled: true,
    readEnabled: true,
    bridgeUrl: 'https://lmc.example',
    bridgeToken: 'bridge-token',
    breathMaxResults: 3,
    breathMaxTokens: 800,
  });
  const payloads = [];
  client.bridgePost = async (path, payload) => {
    payloads.push({ path, payload });
    return { candidate_id: 12 };
  };
  const dream = {
    createdAt: '2026-07-29T00:00:00.000Z',
    dream: '一盏灯',
    residue: '安静',
    awareness: '记得回来',
    fingerprint: 'same-content-fingerprint',
    source: 'rules',
  };

  await client.storeDream(dream);
  await client.storeDream({ ...dream, createdAt: '2026-07-29T06:00:00.000Z' });

  assert.equal(payloads[0].path, '/bridge/xinchao/candidates');
  assert.equal(payloads[0].payload.external_id, 'dream:same-content-fingerprint');
  assert.equal(payloads[1].payload.external_id, payloads[0].payload.external_id);
  assert.equal(payloads[0].payload.importance, 5.5);
});
