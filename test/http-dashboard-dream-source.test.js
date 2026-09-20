import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { newState } from '../src/engine.js';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverPath = join(projectDir, 'src', 'server.js');

async function freePort() {
  const probe = createTcpServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`心潮测试服务提前退出：${output.value}`);
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

function nightDream(overrides = {}) {
  return {
    id: 'night_dream_settled',
    createdAt: '2026-07-12T20:00:00.000Z',
    source: 'night_model',
    kind: 'night',
    source_date: '2026-07-12',
    source_start_at: '2026-07-12T06:20:00.000Z',
    source_end_at: '2026-07-12T08:03:00.000Z',
    source_event_ids: Array.from({ length: 84 }, (_, index) => 1000 + index),
    dream: '雨停以后，走廊还亮着。',
    residue: '手掌还张着，像在等什么东西落下来。',
    ...overrides,
  };
}

async function startMockLmc(handler) {
  const port = await freePort();
  const calls = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      calls.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: raw ? JSON.parse(raw) : {},
      });
      handler(request, response, calls.at(-1));
    });
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    calls,
    url: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

async function startXinchao(t, { directory, lmcUrl, extraEnv = {} }) {
  const port = await freePort();
  const token = 'http-api-test-token-0123456789abcdef';
  const dashboardToken = 'dashboard-http-test-token-32-characters';
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
      OMBRE_HEARTBEAT_FILE: join(directory, 'missing-heartbeat.json'),
      SETTLE_INTERVAL_MINUTES: '1440',
      SHADOW_MODE: 'true',
      MODEL_ENABLED: 'false',
      BARK_ENABLED: 'false',
      DAYTIME_EMERGENCE_ENABLED: 'false',
      CONTEXT_OMBRE_ENABLED: 'false',
      MCP_ENABLED: 'false',
      OAUTH_ENABLED: 'false',
      DASHBOARD_ENABLED: 'true',
      DASHBOARD_ACCESS_TOKEN: dashboardToken,
      DASHBOARD_PUBLIC_BASE_URL: baseUrl,
      MEMORY_TRANSPORT: 'lmc5_bridge',
      MEMORY_READ_ENABLED: 'true',
      MEMORY_BRIDGE_URL: lmcUrl,
      MEMORY_BRIDGE_TOKEN: 'lmc-bridge-token-32-characters-aa',
      ...extraEnv,
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
  });
  await waitForHealth(baseUrl, child, output);
  return { baseUrl, token, output };
}

test('GET /v1/dashboard/dreams/:id/source returns exact LMC history without event ids', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-dream-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = newState();
  state.revision = 7;
  state.recentDreams.push(nightDream());
  state.recentDreams.push({
    id: 'ordinary-dream',
    kind: 'doodle',
    dream: '白天的一笔',
  });
  state.recentDreams.push({
    id: 'night-without-ids',
    kind: 'night',
    source_date: '2026-07-12',
    dream: '没有原料编号的夜梦',
  });
  await writeFile(join(directory, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);

  const lmc = await startMockLmc((_request, response, call) => {
    if (call.url !== '/bridge/xinchao/historical-events') {
      response.writeHead(404);
      response.end('{}');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      status: 'partial',
      source_date: '2026-07-12',
      start_at: '2026-07-12T06:20:00+00:00',
      end_at: '2026-07-12T08:03:00+00:00',
      requested_count: 84,
      returned_count: 82,
      missing_count: 2,
      messages: [
        { role: 'user', content: '门口还挂着风铃。', created_at: '2026-07-12T06:20:00+00:00', id: 1000 },
      ],
    }));
  });
  t.after(() => lmc.close());

  const { baseUrl, token } = await startXinchao(t, { directory, lmcUrl: lmc.url });
  const headers = { authorization: `Bearer ${token}` };
  const before = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));

  const unknown = await fetch(`${baseUrl}/v1/dashboard/dreams/missing-dream/source`, { headers });
  assert.equal(unknown.status, 404);

  const ordinary = await fetch(`${baseUrl}/v1/dashboard/dreams/ordinary-dream/source`, { headers });
  assert.equal(ordinary.status, 409);
  assert.equal((await ordinary.json()).error, 'dream source unavailable');

  const noIds = await fetch(`${baseUrl}/v1/dashboard/dreams/night-without-ids/source`, { headers });
  assert.equal(noIds.status, 409);

  const source = await fetch(`${baseUrl}/v1/dashboard/dreams/night_dream_settled/source`, { headers });
  assert.equal(source.status, 200);
  const payload = await source.json();
  const raw = JSON.stringify(payload);
  assert.equal(payload.status, 'partial');
  assert.equal(payload.dreamId, 'night_dream_settled');
  assert.equal(payload.sourceEventCount, 84);
  assert.equal(payload.returnedEventCount, 82);
  assert.equal(payload.missingEventCount, 2);
  assert.equal(payload.messages[0].content, '门口还挂着风铃。');
  assert.equal('id' in payload.messages[0], false);
  assert.doesNotMatch(raw, /source_event_ids/);
  assert.doesNotMatch(raw, /event_ids/);
  assert.equal(lmc.calls.length, 1);
  assert.deepEqual(lmc.calls[0].body.event_ids.length, 84);
  assert.equal(lmc.calls[0].body.source_date, '2026-07-12');
  assert.equal(lmc.calls[0].authorization, 'Bearer lmc-bridge-token-32-characters-aa');

  const after = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(after.revision, before.revision);
  assert.equal(after.recentDreams.length, before.recentDreams.length);
  assert.equal(after.recentDreams[0].dream, '雨停以后，走廊还亮着。');
});

test('GET dream source is 503 when LMC is down and does not mutate dreams', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-dream-source-down-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = newState();
  state.revision = 4;
  state.recentDreams.push(nightDream());
  await writeFile(join(directory, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  const closed = await freePort();
  const { baseUrl, token } = await startXinchao(t, {
    directory,
    lmcUrl: `http://127.0.0.1:${closed}`,
  });
  const before = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  const response = await fetch(`${baseUrl}/v1/dashboard/dreams/night_dream_settled/source`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'historical source unavailable');
  const after = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(after.revision, before.revision);
  assert.equal(after.recentDreams[0].id, 'night_dream_settled');
});
