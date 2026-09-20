import test from 'node:test';
import assert from 'node:assert/strict';
import { newState } from '../src/engine.js';
import { buildConnectionManifest, buildDashboardSnapshot } from '../src/dashboard-projection.js';

function config(overrides = {}) {
  return {
    identity: { agentName: '顾川', notificationRecipient: '派派' },
    shadowMode: false,
    context: { enabled: true },
    mcp: { enabled: true },
    oauth: { enabled: true, publicBaseUrl: 'https://xinchao.example.com' },
    ombre: { readEnabled: true, writeEnabled: false },
    bark: { enabled: true },
    dashboard: {
      enabled: true,
      publicBaseUrl: 'https://xinchao.example.com',
      includePrivateText: false,
      dreamLimit: 12,
      ...(overrides.dashboard ?? {}),
    },
  };
}

test('dashboard snapshot is stable and private by default', () => {
  const now = new Date('2026-08-03T08:00:00.000Z');
  const state = newState(new Date('2026-08-03T07:00:00.000Z'));
  state.drives.possess = 0.82;
  state.thoughtPool.flash.push({
    key: 'possess',
    text: '不能泄露的思绪正文',
    intensity: 0.91,
    age: 0,
  });
  state.recentDreams.push({
    id: 'dream-private',
    createdAt: '2026-08-03T07:30:00.000Z',
    source: 'model',
    dream: '不能泄露的梦境原文',
    summary: '不能泄露的梦境摘要',
    residue: '不能泄露的梦境余韵',
    awareness: '不能泄露的醒后意识',
    lucidity: 0.72,
  });
  const snapshot = buildDashboardSnapshot(state, config(), now);
  const raw = JSON.stringify(snapshot);

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.drives.length, 12);
  assert.equal(snapshot.topDrives[0].key, 'possess');
  assert.equal(snapshot.topDrives[0].level, 'surging');
  assert.equal(snapshot.thoughts.flashCount, 1);
  assert.equal(snapshot.thoughts.signals[0].intensity, 0.91);
  assert.equal(snapshot.dreams[0].hasResidue, true);
  assert.equal(snapshot.dreams[0].hasDream, true);
  assert.equal(snapshot.dreams[0].lucidity, 0.72);
  assert.equal(snapshot.dreams[0].dream, undefined);
  assert.equal(snapshot.dreams[0].residue, undefined);
  assert.doesNotMatch(raw, /不能泄露/);
});

test('private dream text is an explicit bounded opt-in', () => {
  const state = newState();
  state.recentDreams.push({
    id: 'dream-visible',
    createdAt: new Date().toISOString(),
    source: 'model',
    dream: '我在云层里看见一扇门\n\n门缝里还有风',
    awareness: '醒来仍记得门上的光',
    residue: '留下的余韵',
    lucidity: 0.81,
  });
  const snapshot = buildDashboardSnapshot(state, config({
    dashboard: { includePrivateText: true },
  }));
  assert.equal(snapshot.dreams[0].dream, '我在云层里看见一扇门\n\n门缝里还有风');
  assert.equal(snapshot.dreams[0].summary, '醒来仍记得门上的光');
  assert.equal(snapshot.dreams[0].residue, '留下的余韵');
  assert.equal(snapshot.dreams[0].lucidity, 0.81);
  assert.equal(snapshot.dreams[0].kind, null);
  assert.equal(snapshot.dreams[0].sourceDate, null);
  assert.equal(snapshot.dreams[0].sourceEventCount, null);
});

test('night dream provenance projects a count without event ids', () => {
  const ids = Array.from({ length: 84 }, (_, index) => 1000 + index);
  const state = newState();
  state.recentDreams.push({
    id: 'night_dream_settled',
    createdAt: '2026-07-12T20:00:00.000Z',
    source: 'night_model',
    kind: 'night',
    source_date: '2026-07-12',
    source_start_at: '2026-07-12T06:20:00.000Z',
    source_end_at: '2026-07-12T08:03:00.000Z',
    source_event_ids: ids,
    dream: '不能通过 provenance 泄露的梦境原文',
    residue: '手掌还张着，像在等什么东西落下来。',
  });
  const snapshot = buildDashboardSnapshot(state, config({
    dashboard: { includePrivateText: true },
  }));
  const projected = snapshot.dreams[0];
  const raw = JSON.stringify(projected);

  assert.equal(projected.kind, 'night');
  assert.equal(projected.sourceDate, '2026-07-12');
  assert.equal(projected.sourceStartAt, '2026-07-12T06:20:00.000Z');
  assert.equal(projected.sourceEndAt, '2026-07-12T08:03:00.000Z');
  assert.equal(projected.sourceEventCount, 84);
  assert.equal(projected.residue, '手掌还张着，像在等什么东西落下来。');
  assert.equal('source_event_ids' in projected, false);
  assert.doesNotMatch(raw, /source_event_ids/);
  assert.doesNotMatch(raw, /1000/);
});

test('legacy dreams omit night provenance without error', () => {
  const state = newState();
  state.recentDreams.push({
    id: 'legacy-residue',
    createdAt: '2026-06-01T10:00:00.000Z',
    source: 'model',
    residue: '旧梦只留下余韵',
  });
  const snapshot = buildDashboardSnapshot(state, config({
    dashboard: { includePrivateText: true },
  }));
  const projected = snapshot.dreams[0];
  assert.equal(projected.kind, null);
  assert.equal(projected.sourceDate, null);
  assert.equal(projected.sourceStartAt, null);
  assert.equal(projected.sourceEndAt, null);
  assert.equal(projected.sourceEventCount, null);
  assert.equal(projected.residue, '旧梦只留下余韵');
  assert.equal(projected.dream, null);
});

test('private text stays off even when night provenance is projected', () => {
  const ids = Array.from({ length: 84 }, (_, index) => 2000 + index);
  const state = newState();
  state.recentDreams.push({
    id: 'night-private',
    createdAt: '2026-07-12T20:00:00.000Z',
    source: 'night_model',
    kind: 'night',
    source_date: '2026-07-12',
    source_start_at: '2026-07-12T06:20:00.000Z',
    source_end_at: '2026-07-12T08:03:00.000Z',
    source_event_ids: ids,
    dream: '不能泄露的梦境原文',
    summary: '不能泄露的梦境摘要',
    residue: '不能泄露的梦境余韵',
    awareness: '不能泄露的醒后意识',
  });
  const snapshot = buildDashboardSnapshot(state, config());
  const projected = snapshot.dreams[0];
  const raw = JSON.stringify(snapshot);

  assert.equal(projected.kind, 'night');
  assert.equal(projected.sourceDate, '2026-07-12');
  assert.equal(projected.sourceEventCount, 84);
  assert.equal(projected.hasDream, true);
  assert.equal(projected.hasResidue, true);
  assert.equal(projected.dream, undefined);
  assert.equal(projected.residue, undefined);
  assert.equal(projected.summary, undefined);
  assert.equal(projected.awareness, undefined);
  assert.equal('source_event_ids' in projected, false);
  assert.doesNotMatch(raw, /不能泄露/);
  assert.doesNotMatch(raw, /source_event_ids/);
});


test('connection manifest supports different clients without returning secrets', () => {
  const manifest = buildConnectionManifest(config());
  const raw = JSON.stringify(manifest);
  assert.deepEqual(
    manifest.profiles.map((profile) => profile.id),
    ['web-dashboard', 'remote-mcp-oauth', 'remote-mcp-bearer', 'http-api', 'runtime-bridge'],
  );
  assert.equal(manifest.profiles[0].auth, 'http-only-session-cookie');
  assert.equal(manifest.secrets.included, false);
  assert.doesNotMatch(raw, /SERVICE_TOKEN":"|accessToken|approvalToken/);
});
