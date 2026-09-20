import assert from 'node:assert/strict';
import test from 'node:test';
import { newState } from '../src/engine.js';
import {
  dreamHasHistoricalProvenance,
  findRecentDream,
  historicalSourceUnavailable,
  mapDreamSourceResponse,
} from '../src/dashboard-dream-source.js';

function nightDream(overrides = {}) {
  return {
    id: 'night_dream_settled',
    kind: 'night',
    source_date: '2026-07-12',
    source_start_at: '2026-07-12T06:20:00.000Z',
    source_end_at: '2026-07-12T08:03:00.000Z',
    source_event_ids: Array.from({ length: 84 }, (_, index) => 1000 + index),
    dream: '不能通过 provenance 泄露的梦境原文',
    residue: '手掌还张着，像在等什么东西落下来。',
    ...overrides,
  };
}

test('finds a night dream by exact id', () => {
  const state = newState();
  state.recentDreams.push(nightDream());
  const found = findRecentDream(state, 'night_dream_settled');
  assert.equal(found.id, 'night_dream_settled');
  assert.equal(findRecentDream(state, 'missing'), null);
});

test('ordinary and provenance-less dreams are unavailable', () => {
  assert.equal(dreamHasHistoricalProvenance({ kind: 'doodle', source_date: '2026-07-12', source_event_ids: [1, 2] }), false);
  assert.equal(dreamHasHistoricalProvenance({ kind: 'night', source_date: '2026-07-12' }), false);
  assert.equal(dreamHasHistoricalProvenance(nightDream()), true);
});

test('maps LMC partial source without event ids', () => {
  const payload = mapDreamSourceResponse({
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
  }, nightDream());
  const raw = JSON.stringify(payload);
  assert.equal(payload.status, 'partial');
  assert.equal(payload.dreamId, 'night_dream_settled');
  assert.equal(payload.sourceEventCount, 84);
  assert.equal(payload.returnedEventCount, 82);
  assert.equal(payload.missingEventCount, 2);
  assert.equal(payload.messages[0].role, 'user');
  assert.equal(payload.messages[0].content, '门口还挂着风铃。');
  assert.equal('id' in payload.messages[0], false);
  assert.doesNotMatch(raw, /source_event_ids/);
  assert.doesNotMatch(raw, /event_ids/);
  assert.doesNotMatch(raw, /1000/);
});

test('LMC 409 maps to dream source unavailable; network maps to 503', () => {
  assert.deepEqual(
    historicalSourceUnavailable(new Error('LMC-5 bridge failed: HTTP 409 source_date mismatch')),
    { status: 409, error: 'dream source unavailable' },
  );
  assert.deepEqual(
    historicalSourceUnavailable(new Error('fetch failed')),
    { status: 503, error: 'historical source unavailable' },
  );
});
