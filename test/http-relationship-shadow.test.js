import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real runtime boundary: enabling preview flags does not expose event ingress.
test('P1 flags expose no HTTP write path and legacy conflict/presence cannot create P1 state', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'xinchao-p1-http-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const token = 'p1-test-service-token-32-characters';
  const child = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(port), SERVICE_TOKEN: token,
      STATE_PATH: join(dir, 'state.json'), TRANSITION_JOURNAL_PATH: join(dir, 'transitions.jsonl'),
      OAUTH_STATE_PATH: join(dir, 'oauth.json'), AI_OUTBOX_PATH: join(dir, 'from-me.json'),
      MEMORY_HEARTBEAT_FILE: join(dir, 'missing-heartbeat.json'),
      FAVORED_SHADOW_ENABLED: 'true', EMPATHY_SHADOW_ENABLED: 'true', EMOTION_V4_ENABLED: 'false',
      SHADOW_MODE: 'true', SELF_SIGNAL_ENABLED: 'false', SYNC_EVENTS_ENABLED: 'false',
      MODEL_ENABLED: 'false', MEMORY_READ_ENABLED: 'false', MEMORY_WRITE_ENABLED: 'false',
      OMBRE_READ_ENABLED: 'false', OMBRE_WRITE_ENABLED: 'false', BARK_ENABLED: 'false', NTFY_ENABLED: 'false',
      BRIDGE_ENABLED: 'false', OAUTH_ENABLED: 'false', MCP_ENABLED: 'false', DASHBOARD_ENABLED: 'false',
      DAYTIME_EMERGENCE_ENABLED: 'false', DREAM_NIGHT_MODE: 'off', SETTLE_INTERVAL_MINUTES: '1440' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', (data) => { output += data; }); child.stderr.on('data', (data) => { output += data; });
  t.after(async () => {
    if (child.exitCode == null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(dir, { recursive: true, force: true });
  });
  const deadline = Date.now() + 10_000;
  let ready = false;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, output);
    try { if ((await fetch(`${url}/health`)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, output);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  for (const path of ['/v1/relationship-shadow', '/v1/favored', '/v1/empathy']) {
    const response = await fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify({ verified: true, event_type: 'favored_hurt' }) });
    assert.equal(response.status, 404);
  }
  const conflict = await fetch(`${url}/v1/dashboard/interactions`, {
    method: 'POST', headers, body: JSON.stringify({ event_id: 'legacy-conflict', interaction_type: 'conflict' }),
  });
  assert.equal(conflict.status, 200);
  const presence = await fetch(`${url}/v1/heartbeat`, { method: 'POST', headers, body: JSON.stringify({ event_id: 'legacy-heartbeat', session_id: 'cc' }) });
  assert.equal(presence.status, 200);
  const saved = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.equal('favoredShadow' in saved, false);
  assert.equal('empathyShadow' in saved, false);
  assert.equal('emotionV4' in saved, false);
  assert.equal(Object.keys(saved.drives).length, 12);
});
