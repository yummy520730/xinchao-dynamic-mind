import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactProjection, newState, sessionOverlayProjection, settleAndApplyConversationEvent, settleState } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp-protocol.js';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverPath = join(projectDir, 'src', 'server.js');
const presenceHook = join(projectDir, 'scripts', 'xinchao-presence-hook.sh');

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
      return compactProjection(applied.state, {
        duplicate: applied.duplicate,
        sessionId: applied.sessionId,
        now: box.now,
      });
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

async function freePort() {
  const probe = createNetServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`心潮测试服务提前退出：${output.value}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // still binding
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待心潮测试服务启动超时：${output.value}`);
}

async function runHook(env, hookInput) {
  const childEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    ...env,
  };
  const child = spawn('sh', [presenceHook], {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
  child.stdin.end(JSON.stringify(hookInput));
  const [code] = await once(child, 'close');
  return {
    code,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
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
  assert.deepEqual(projection.session, sessionOverlayProjection(box.state, 'mcp-session-1', now));
  assert.deepEqual(projection.session, {
    tone: 'neutral',
    warmth: 0.5,
    tension: 0,
    attention: 0.5,
    confidence: 0.5,
  });
  assert.equal(box.lastApplied.interaction.applied, false);
  assert.equal(box.lastApplied.interaction.reasonCode, 'no_interaction_outcome');
});

test('mind_presence projection reuses current session overlay values', async () => {
  const now = new Date('2026-09-03T02:20:00Z');
  const state = newState(now);
  state.sessionOverlays['mcp-session-1'] = {
    sessionId: 'mcp-session-1',
    tone: 'warm',
    warmth: 0.78,
    tension: 0.08,
    attention: 0.91,
    confidence: 0.74,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 240 * 60_000).toISOString(),
    lastConversationAt: now.toISOString(),
  };
  const box = { state, now };
  const result = await callPresence(box, { event_id: 'presence-session-1' });
  assert.deepEqual(result.body.result.structuredContent.session, {
    tone: 'warm',
    warmth: 0.78,
    tension: 0.08,
    attention: 0.91,
    confidence: 0.74,
  });
});

test('compact projection session is null when overlay is missing or expired', () => {
  const now = new Date('2026-09-03T05:00:00Z');
  const state = newState(now);
  assert.equal(compactProjection(state, { sessionId: 'missing', now }).session, null);
  assert.equal(compactProjection(state, { duplicate: false }).session, null);
  state.sessionOverlays.old = {
    sessionId: 'old',
    tone: 'warm',
    warmth: 0.9,
    tension: 0.1,
    attention: 0.8,
    confidence: 0.7,
    expiresAt: '2026-09-03T04:00:00.000Z',
  };
  assert.equal(compactProjection(state, { sessionId: 'old', now }).session, null);
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
  assert.deepEqual(second.body.result.structuredContent.session, first.body.result.structuredContent.session);
  assert.equal(second.body.result.structuredContent.consciousness, box.state.consciousness);
});

test('mind_presence returns the projection after this presence apply', async () => {
  const now = new Date('2026-09-03T05:00:00Z');
  const sleeping = settleState(newState(now), new Date('2026-09-03T07:00:00Z'), 90).state;
  const applyAt = new Date('2026-09-03T07:01:00Z');
  const box = { state: sleeping, now: applyAt };
  const result = await callPresence(box, { event_id: 'presence-turn-4' });
  const projection = result.body.result.structuredContent;
  assert.deepEqual(projection, compactProjection(box.state, {
    duplicate: false,
    sessionId: 'mcp-session-1',
    now: applyAt,
  }));
  assert.equal(projection.consciousness, 'awake');
  assert.equal(JSON.parse(result.body.result.content[0].text).consciousness, 'awake');
  assert.equal(projection.session.tone, 'neutral');
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
  assert.deepEqual(sessionOverlayProjection(first.state, 'window-1', now), {
    tone: 'neutral',
    warmth: 0.5,
    tension: 0,
    attention: 0.5,
    confidence: 0.5,
  });

  const retry = settleAndApplyConversationEvent(first.state, {
    sessionId: 'window-1',
    eventId: 'presence-http-1',
  }, now, { sleepAfterMinutes: 90, presenceOnly: false });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.state.revision, first.state.revision);
  assert.equal(retry.state.lastConversationAt, first.state.lastConversationAt);
  assert.equal(retry.state.drives.share, 0.8);
});

test('presence hook calls public /mcp mind_presence and injects session overlay', async () => {
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
      const projection = {
        revision: 123,
        consciousness: 'awake',
        fatigue: 0.12,
        top_drives: [
          { key: 'share', value: 0.74 },
          { key: 'curiosity', value: 0.69 },
          { key: 'crave', value: 0.66 },
        ],
        session: {
          tone: 'warm',
          warmth: 0.78,
          tension: 0.08,
          attention: 0.91,
          confidence: 0.74,
        },
        duplicate: false,
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify(projection) }],
          structuredContent: projection,
          isError: false,
        },
      }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const result = await runHook({
    XINCHAO_SERVICE_TOKEN: 'presence-hook-test-token-0123456789ab',
    XINCHAO_MCP_URL: `http://127.0.0.1:${port}/mcp`,
  }, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'vps-session-1',
    event_id: 'presence-stable-1',
    prompt: '这段用户原文绝不能离开本机',
  });
  server.close();
  await once(server, 'close');

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, '/mcp');
  assert.equal(captured[0].body.method, 'tools/call');
  assert.equal(captured[0].body.params.name, 'mind_presence');
  assert.deepEqual(captured[0].body.params.arguments, {
    session_id: 'vps-session-1',
    event_id: 'presence-stable-1',
  });
  assert.equal(JSON.stringify(captured[0].body).includes('用户原文'), false);
  assert.equal(JSON.stringify(captured[0].body).includes('conversation-event'), false);
  const injected = JSON.parse(result.stdout);
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
    session: {
      tone: 'warm',
      warmth: 0.78,
      tension: 0.08,
      attention: 0.91,
      confidence: 0.74,
    },
    duplicate: false,
  });
});

test('presence hook does not call the internal conversation-event API', async () => {
  const captured = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      captured.push(request.url);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const result = await runHook({
    XINCHAO_SERVICE_TOKEN: 'presence-hook-test-token-0123456789ab',
    XINCHAO_PRESENCE_URL: `http://127.0.0.1:${port}/v1/conversation-event`,
  }, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'vps-session-1',
    event_id: 'presence-stable-2',
    prompt: '这段用户原文绝不能离开本机',
  });
  server.close();
  await once(server, 'close');
  assert.equal(result.code, 0);
  assert.equal(captured.length, 0);
  assert.equal(result.stdout.trim(), '');
});

test('public /mcp mind_presence returns projection after apply including session', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-mcp-presence-'));
  const port = await freePort();
  const token = 'mcp-presence-test-token-0123456789ab';
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = { value: '' };
  const child = spawn(process.execPath, [serverPath], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(port),
      SERVICE_TOKEN: token,
      STATE_PATH: join(directory, 'state.json'),
      TRANSITION_JOURNAL_PATH: join(directory, 'transitions.jsonl'),
      OAUTH_STATE_PATH: join(directory, 'oauth.json'),
      SETTLE_INTERVAL_MINUTES: '1440',
      SHADOW_MODE: 'true',
      MODEL_ENABLED: 'false',
      BARK_ENABLED: 'false',
      DAYTIME_EMERGENCE_ENABLED: 'false',
      CONTEXT_OMBRE_ENABLED: 'false',
      MCP_ENABLED: 'true',
      OAUTH_ENABLED: 'false',
      DASHBOARD_ENABLED: 'false',
      BRIDGE_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output.value += chunk; });
  child.stderr.on('data', (chunk) => { output.value += chunk; });
  t.after(async () => {
    if (child.exitCode == null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await rm(directory, { recursive: true, force: true });
  });

  await waitForHealth(baseUrl, child, output);

  const call = (eventId) => fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'mind_presence',
        arguments: { session_id: 'vps-window', event_id: eventId },
      },
    }),
  });

  const first = await call('presence-live-1');
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const projection = firstBody.result.structuredContent;
  assert.equal(firstBody.result.isError, false);
  assert.equal(projection.consciousness, 'awake');
  assert.equal(projection.duplicate, false);
  assert.equal(typeof projection.revision, 'number');
  assert.equal(Array.isArray(projection.top_drives), true);
  assert.equal(projection.session.tone, 'neutral');
  assert.equal(typeof projection.session.warmth, 'number');
  assert.equal(typeof projection.session.tension, 'number');
  assert.equal(typeof projection.session.attention, 'number');
  assert.equal(typeof projection.session.confidence, 'number');

  const retry = await call('presence-live-1');
  const retryBody = await retry.json();
  assert.equal(retryBody.result.structuredContent.duplicate, true);
  assert.equal(retryBody.result.structuredContent.consciousness, projection.consciousness);
  assert.deepEqual(retryBody.result.structuredContent.session, projection.session);
  assert.deepEqual(retryBody.result.structuredContent.top_drives, projection.top_drives);
});
