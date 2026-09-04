import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactProjection, newState, settleAndApplyConversationEvent, settleState } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp-protocol.js';

function livePresenceHandlers(box) {
  return {
    defaultSessionId: 'mcp-session-1',
    context: async () => {
      throw new Error('mind_context/xinchao_context contract must stay unused here');
    },
    event: async () => {
      throw new Error('mind_event/xinchao_event contract must stay unused here');
    },
    presence: async (event) => {
      const applied = settleAndApplyConversationEvent(box.state, event, box.now, {
        sleepAfterMinutes: 90,
        recordArrival: false,
        presenceOnly: false,
      });
      box.state = applied.state;
      box.lastApplied = applied;
      return compactProjection(applied.state, { duplicate: applied.duplicate });
    },
    stateSignal: async () => {
      throw new Error('state signal must stay unused here');
    },
    handoffNote: async () => {
      throw new Error('handoff note must stay unused here');
    },
    fromMe: async () => {
      throw new Error('from-me must stay unused here');
    },
  };
}

async function callPresence(box, args) {
  return handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'mind_presence', arguments: args },
  }, livePresenceHandlers(box));
}

test('sleeping plus mind_presence wakes and refreshes conversation presence anchors', async () => {
  const start = new Date('2026-09-03T00:00:00Z');
  const sleeping = settleState(newState(start), new Date('2026-09-03T02:00:00Z'), 90).state;
  sleeping.drives.share = 0.74;
  sleeping.drives.curiosity = 0.69;
  sleeping.drives.crave = 0.66;
  sleeping.fatigue = 0.12;
  assert.equal(sleeping.consciousness, 'sleeping');

  const now = new Date('2026-09-03T02:05:00Z');
  const box = { state: sleeping, now };
  const result = await callPresence(box, { event_id: 'presence-turn-1' });
  const projection = result.body.result.structuredContent;

  assert.equal(box.state.consciousness, 'awake');
  assert.equal(box.state.lastConversationAt, '2026-09-03T02:05:00.000Z');
  assert.equal(box.state.lastHeartbeatAt, '2026-09-03T02:05:00.000Z');
  assert.equal(box.state.sessionOverlays['mcp-session-1'].lastConversationAt, '2026-09-03T02:05:00.000Z');
  assert.equal(projection.revision, box.state.revision);
  assert.equal(projection.consciousness, 'awake');
  assert.equal(projection.fatigue, 0.12);
  assert.equal(projection.duplicate, false);
  assert.deepEqual(projection.top_drives, [
    { key: 'share', value: 0.74 },
    { key: 'curiosity', value: 0.69 },
    { key: 'crave', value: 0.66 },
  ]);
  assert.equal(box.lastApplied.interaction.applied, false);
  assert.equal(box.lastApplied.interaction.reasonCode, 'no_interaction_outcome');
});

test('mind_presence does not apply interaction effects or satisfaction', async () => {
  const now = new Date('2026-09-03T03:00:00Z');
  const state = newState(now);
  state.drives.share = 0.8;
  state.drives.crave = 0.7;
  const before = structuredClone(state.drives);
  const box = { state, now };
  await callPresence(box, {
    event_id: 'presence-turn-2',
    interaction_type: 'sharing',
    prompt: '用户原文',
  });
  assert.deepEqual(box.state.drives, before);
  assert.equal(box.state.recentActions.length, 0);
  assert.equal(box.lastApplied.interaction.applied, false);
  assert.equal(box.lastApplied.interaction.reasonCode, 'no_interaction_outcome');
  assert.equal(box.lastApplied.interaction.affectedDrives.length, 0);
});

test('mind_presence retries with the same event_id are idempotent', async () => {
  const now = new Date('2026-09-03T04:00:00Z');
  const box = { state: newState(now), now };
  const first = await callPresence(box, { event_id: 'presence-turn-3' });
  const afterFirst = structuredClone(box.state);
  const second = await callPresence(box, { event_id: 'presence-turn-3' });

  assert.equal(first.body.result.structuredContent.duplicate, false);
  assert.equal(second.body.result.structuredContent.duplicate, true);
  assert.equal(second.body.result.structuredContent.revision, afterFirst.revision);
  assert.equal(box.state.revision, afterFirst.revision);
  assert.equal(box.state.lastConversationAt, afterFirst.lastConversationAt);
  assert.deepEqual(box.state.drives, afterFirst.drives);
  assert.equal(second.body.result.structuredContent.consciousness, box.state.consciousness);
});

test('mind_presence returns the projection after this presence apply', async () => {
  const now = new Date('2026-09-03T05:00:00Z');
  const sleeping = settleState(newState(now), new Date('2026-09-03T07:00:00Z'), 90).state;
  const applyAt = new Date('2026-09-03T07:01:00Z');
  const box = { state: sleeping, now: applyAt };
  const result = await callPresence(box, { event_id: 'presence-turn-4' });
  const projection = result.body.result.structuredContent;
  assert.deepEqual(projection, compactProjection(box.state, { duplicate: false }));
  assert.equal(projection.consciousness, 'awake');
  assert.equal(JSON.parse(result.body.result.content[0].text).consciousness, 'awake');
});

test('conversation event without interaction_type still wakes without drive relief', () => {
  const start = new Date('2026-09-03T00:00:00Z');
  const sleeping = settleState(newState(start), new Date('2026-09-03T02:00:00Z'), 90).state;
  sleeping.drives.share = 0.8;
  const now = new Date('2026-09-03T02:10:00Z');
  const first = settleAndApplyConversationEvent(sleeping, {
    sessionId: 'window-1',
    eventId: 'presence-http-1',
  }, now, { sleepAfterMinutes: 90, presenceOnly: false });
  assert.equal(first.state.consciousness, 'awake');
  assert.equal(first.state.lastConversationAt, now.toISOString());
  assert.equal(first.state.lastHeartbeatAt, now.toISOString());
  assert.equal(first.state.drives.share, 0.8);
  assert.equal(first.interaction.applied, false);

  const retry = settleAndApplyConversationEvent(first.state, {
    sessionId: 'window-1',
    eventId: 'presence-http-1',
  }, now, { sleepAfterMinutes: 90, presenceOnly: false });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.state.revision, first.state.revision);
  assert.equal(retry.state.lastConversationAt, first.state.lastConversationAt);
  assert.equal(retry.state.drives.share, 0.8);
});

test('presence hook never forwards user text and injects the returned projection', async () => {
  const captured = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      captured.push({
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        revision: 123,
        consciousness: 'awake',
        fatigue: 0.12,
        top_drives: [
          { key: 'share', value: 0.74 },
          { key: 'curiosity', value: 0.69 },
          { key: 'crave', value: 0.66 },
        ],
        duplicate: false,
        pendingAwareness: null,
      }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const script = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'xinchao-presence-hook.sh');
  const child = spawn('sh', [script], {
    env: {
      ...process.env,
      XINCHAO_SERVICE_TOKEN: 'presence-hook-test-token-0123456789ab',
      XINCHAO_PRESENCE_URL: `http://127.0.0.1:${port}/v1/conversation-event`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
  child.stdin.end(JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'vps-session-1',
    event_id: 'presence-stable-1',
    prompt: '这段用户原文绝不能离开本机',
  }));
  const [code] = await once(child, 'close');
  server.close();
  await once(server, 'close');

  assert.equal(code, 0);
  assert.equal(Buffer.concat(stderrChunks).toString('utf8'), '');
  const posts = captured.filter((item) => item.body?.event_id);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, {
    session_id: 'vps-session-1',
    event_id: 'presence-stable-1',
  });
  assert.equal(JSON.stringify(posts[0].body).includes('用户原文'), false);
  const injected = JSON.parse(Buffer.concat(stdoutChunks).toString('utf8'));
  assert.equal(injected.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.deepEqual(JSON.parse(injected.hookSpecificOutput.additionalContext), {
    revision: 123,
    consciousness: 'awake',
    fatigue: 0.12,
    top_drives: [
      { key: 'share', value: 0.74 },
      { key: 'curiosity', value: 0.69 },
      { key: 'crave', value: 0.66 },
    ],
    duplicate: false,
  });
});
