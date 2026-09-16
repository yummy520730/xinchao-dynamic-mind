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


test('night dream skips when the model is unavailable instead of using a template', async () => {
  const client = new ModelClient(modelConfig({ enabled: false, apiKey: '' }));
  await assert.rejects(
    () => client.generateNightDream({
      episode: { source_date: '2026-08-18', event_ids: [1], messages: [] },
      stateProjection: { attachment: 'high' },
    }),
    /night dream model is unavailable/,
  );
});


test('night dream uses an independent writer prompt and never the daily summarizer', async () => {
  const client = new ModelClient(modelConfig());
  let requestBody;
  client.request = async (body) => {
    requestBody = body;
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              dream: '雨后的旧街把风铃吹成一条弯路，有人始终走在半步之外，屋檐下的雨比人声更密，门缝里还温着一点光。',
              residue: '想靠近',
              residue_strength: 0.4,
            }),
          },
        }],
      }),
    };
  };
  const result = await client.generateNightDream({
    episode: {
      source_date: '2026-08-18',
      event_ids: [101, 102],
      messages: [{ role: 'user', content: '旧书店' }],
    },
    stateProjection: { attachment: 'high' },
  });
  assert.equal(result.source, 'night_model');
  assert.match(requestBody.messages[1].content, /这是梦，不是事实总结/);
  assert.doesNotMatch(requestBody.messages[1].content, /当天叙事|ledger_status|Daily summarizer/);
  assert.equal(result.dream.includes('旧街'), true);
});
