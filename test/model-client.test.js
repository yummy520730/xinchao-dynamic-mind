import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelClient } from '../src/model-client.js';
import { newState, topDrives } from '../src/engine.js';

function modelConfig(overrides = {}) {
  return {
    enabled: true,
    apiKey: 'test-key',
    baseUrl: 'https://model.example.com/v1',
    name: 'test-model',
    timeoutMs: 1000,
    maxInputChars: 10000,
    maxOutputTokens: 650,
    agentName: '心潮',
    notificationRecipient: '用户',
    ...overrides,
  };
}

test('wake without an expression model does not become a fixed message', async () => {
  const client = new ModelClient(modelConfig({ enabled: false, apiKey: '' }));
  const state = newState(new Date('2026-07-28T00:00:00Z'));
  const result = await client.generateThought({ state, topDrives: topDrives(state) });
  assert.deepEqual(result, { send: false, message: '', source: 'unavailable' });
  assert.deepEqual(
    await client.generateDreamPush({ dream: { residue: '想你了' } }),
    { send: false, message: '', source: 'unavailable' },
  );
});

test('official model owns both final wording and the choice to stay quiet', async () => {
  const client = new ModelClient(modelConfig());
  let requestBody;
  client.request = async (body) => {
    requestBody = body;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"send":false,"message":""}' } }] }),
    };
  };
  const state = newState(new Date('2026-07-28T00:00:00Z'));
  const result = await client.generateThought({ state, topDrives: topDrives(state) });
  assert.equal(result.send, false);
  assert.equal(requestBody.messages.length, 2);
  assert.match(requestBody.messages[1].content, /保持安静、做自己的事或休息/);
  assert.match(requestBody.messages[1].content, /由你决定最终语言/);
});

test('dream wake also lets the official model choose silence', async () => {
  const client = new ModelClient(modelConfig());
  client.request = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"send":false,"message":""}' } }] }),
  });
  const result = await client.generateDreamPush({
    dream: { dream: '一扇门', residue: '安静', awareness: '只是梦' },
  });
  assert.deepEqual(result, { send: false, message: '', source: 'model' });
});
