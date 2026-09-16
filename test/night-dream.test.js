import test from 'node:test';
import assert from 'node:assert/strict';
import { newState } from '../src/engine.js';
import {
  applyNightDreamDriveNudge,
  clearNightDreamMissIfDisabled,
  nightDreamDue,
  nightDreamWriterPrompt,
  projectDreamState,
  recentNightDreamSourceDates,
  recordNightDream,
  recordNightDreamMiss,
  runNightDream,
  validateNightDreamOutput,
} from '../src/night-dream.js';


test('night dream is due once per local day after the hour, including catch-up', () => {
  const state = newState(new Date('2026-09-16T00:00:00Z'));
  const options = { mode: 'apply', hour: 4, timeZone: 'Asia/Shanghai' };
  assert.equal(nightDreamDue(state, new Date('2026-09-15T19:59:00Z'), options), false); // 03:59 CST
  assert.equal(nightDreamDue(state, new Date('2026-09-15T20:00:00Z'), options), true); // 04:00 CST
  assert.equal(nightDreamDue(state, new Date('2026-09-16T02:20:00Z'), options), true); // 10:20 CST catch-up
});


test('successful night dream is durable across restart ticks the same local day', () => {
  const now = new Date('2026-09-15T20:20:00Z');
  let state = newState(now);
  const dream = {
    id: 'n1',
    createdAt: now.toISOString(),
    dream: '旧书店的风铃',
    residue: '想靠近',
    source_date: '2026-08-18',
    source_event_ids: [101, 102],
  };
  state = recordNightDream(state, dream, now, 'Asia/Shanghai');
  assert.equal(state.lastNightDreamLocalDay, '2026-09-16');
  assert.equal(state.lastNightDreamAttemptLocalDay, '2026-09-16');
  assert.equal(state.consecutiveNightDreamMiss, 0);
  const options = { mode: 'apply', hour: 4, timeZone: 'Asia/Shanghai' };
  assert.equal(nightDreamDue(state, now, options), false);
  assert.equal(nightDreamDue(state, new Date('2026-09-16T02:00:00Z'), options), false);
});


test('state projection uses bands, not raw internals', () => {
  const state = newState();
  state.drives.possess = 0.82;
  state.drives.curiosity = 0.4;
  state.fatigue = 0.1;
  const projection = projectDreamState(state);
  assert.equal(projection.attachment, 'high');
  assert.equal(projection.curiosity, 'medium');
  assert.equal(projection.fatigue, 'low');
  assert.equal(Object.values(projection).every((value) => ['low', 'medium', 'high'].includes(value)), true);
});


test('writer prompt forbids facts, memory extraction and analysis', () => {
  const prompt = nightDreamWriterPrompt({
    episode: {
      source_date: '2026-08-18',
      event_ids: [101, 102],
      messages: [{ role: 'user', content: '旧书店' }],
    },
    stateProjection: { attachment: 'high', warmth: 'medium' },
  });
  assert.match(prompt, /这是梦，不是事实总结/);
  assert.match(prompt, /不创建 canonical memory/);
  assert.doesNotMatch(prompt, /请总结今天/);
});


test('model failure skips instead of using a template dream', async () => {
  const now = new Date('2026-09-15T20:05:00Z');
  const state = newState(now);
  const result = await runNightDream({
    state,
    now,
    config: {
      dreamNight: { mode: 'apply', hour: 4, maxSourceChars: 6000, maxOutputChars: 400 },
      settle: { timeZone: 'Asia/Shanghai' },
    },
    ombre: {
      fetchHistoricalEpisode: async () => ({
        status: 'ok',
        source_date: '2026-08-18',
        start_at: '2026-08-18T13:00:00Z',
        end_at: '2026-08-18T13:10:00Z',
        event_ids: [101, 102, 103],
        messages: [{ role: 'user', content: '旧书店' }],
      }),
    },
    model: {
      generateNightDream: async () => {
        const error = new Error('boom');
        error.code = 'night_dream_skip';
        throw error;
      },
    },
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'model_failed');
  assert.equal(result.dream, undefined);
});


test('generated night dream keeps source event ids and never looks like a template', async () => {
  const now = new Date('2026-09-15T20:05:00Z');
  const state = newState(now);
  const result = await runNightDream({
    state,
    now,
    config: {
      dreamNight: { mode: 'apply', hour: 4, maxSourceChars: 6000, maxOutputChars: 400 },
      settle: { timeZone: 'Asia/Shanghai' },
    },
    ombre: {
      fetchHistoricalEpisode: async () => ({
        status: 'ok',
        source_date: '2026-08-18',
        start_at: '2026-08-18T13:00:00Z',
        end_at: '2026-08-18T13:10:00Z',
        event_ids: [101, 102, 103, 104],
        messages: [{ role: 'user', content: '风铃' }, { role: 'assistant', content: '屋檐' }],
      }),
    },
    model: {
      generateNightDream: async () => ({
        dream: '雨后的旧街把风铃吹成一条弯路，有人始终走在半步之外。',
        residue: '昨夜那段旧聊天留下了一点想靠近的感觉',
        residue_strength: 0.42,
        source: 'night_model',
        model: 'deepseek-chat',
      }),
    },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.dream.source_event_ids, [101, 102, 103, 104]);
  assert.equal(result.dream.source_date, '2026-08-18');
  assert.equal(result.dream.source, 'night_model');
  assert.notEqual(result.dream.source, 'rules');
});


test('same-day scheduler tick after a recorded night dream does not generate again', async () => {
  const now = new Date('2026-09-15T20:05:00Z');
  let state = recordNightDream(newState(now), {
    id: 'already',
    createdAt: now.toISOString(),
    dream: '已经做过',
    source_date: '2026-08-01',
    source_event_ids: [1],
  }, now, 'Asia/Shanghai');
  let fetched = 0;
  const result = await runNightDream({
    state,
    now,
    config: {
      dreamNight: { mode: 'apply', hour: 4, maxSourceChars: 6000, maxOutputChars: 400 },
      settle: { timeZone: 'Asia/Shanghai' },
    },
    ombre: {
      fetchHistoricalEpisode: async () => {
        fetched += 1;
        return { status: 'ok', event_ids: [1, 2] };
      },
    },
    model: {
      generateNightDream: async () => ({ dream: '不应出现', source: 'night_model' }),
    },
  });
  assert.equal(result.status, 'not_due');
  assert.equal(fetched, 0);
});


test('night dream records cannot become the next episode source list', () => {
  const state = newState();
  state.recentDreams = [
    { source_date: '2026-08-18', dream: '梦' },
    { sourceDate: '2026-07-01', dream: '更早' },
  ];
  assert.deepEqual(recentNightDreamSourceDates(state), ['2026-08-18', '2026-07-01']);
});


test('empty model output is rejected', () => {
  assert.equal(validateNightDreamOutput({ dream: '', residue: 'x' }), null);
  const ok = validateNightDreamOutput({
    dream: '风铃在积水里晃出一条没有尽头的走廊，有人把手放在门把上又松开，雨比人声更密。',
    residue: '想靠近',
    residue_strength: 0.4,
  });
  assert.ok(ok);
  assert.equal(ok.residue_strength, 0.4);
});


test('failed night dream is not retried the same local day', async () => {
  const now = new Date('2026-09-15T20:05:00Z');
  const options = { mode: 'apply', hour: 4, timeZone: 'Asia/Shanghai' };
  const failed = await runNightDream({
    state: newState(now),
    now,
    config: {
      dreamNight: { mode: 'apply', hour: 4, maxSourceChars: 6000, maxOutputChars: 400 },
      settle: { timeZone: 'Asia/Shanghai' },
    },
    ombre: {
      fetchHistoricalEpisode: async () => ({
        status: 'ok',
        source_date: '2026-08-18',
        event_ids: [101, 102],
        messages: [{ role: 'user', content: '旧书店' }],
      }),
    },
    model: {
      generateNightDream: async () => {
        throw Object.assign(new Error('boom'), { code: 'night_dream_skip' });
      },
    },
  });
  assert.equal(failed.status, 'skipped');
  const state = recordNightDreamMiss(newState(now), now, 'Asia/Shanghai');
  assert.equal(state.lastNightDreamAttemptLocalDay, '2026-09-16');
  assert.equal(state.lastNightDreamLocalDay, null);
  assert.equal(state.consecutiveNightDreamMiss, 1);
  assert.equal(nightDreamDue(state, now, options), false);
  let fetched = 0;
  const retry = await runNightDream({
    state,
    now,
    config: {
      dreamNight: { mode: 'apply', hour: 4, maxSourceChars: 6000, maxOutputChars: 400 },
      settle: { timeZone: 'Asia/Shanghai' },
    },
    ombre: {
      fetchHistoricalEpisode: async () => {
        fetched += 1;
        return { status: 'ok', event_ids: [1, 2] };
      },
    },
    model: {
      generateNightDream: async () => ({ dream: '不应出现', source: 'night_model' }),
    },
  });
  assert.equal(retry.status, 'not_due');
  assert.equal(fetched, 0);
});


test('consecutive miss resets on success and clears when night dream is off', () => {
  const now = new Date('2026-09-15T20:20:00Z');
  let state = recordNightDreamMiss(newState(now), now, 'Asia/Shanghai');
  state = recordNightDreamMiss(state, new Date('2026-09-16T20:20:00Z'), 'Asia/Shanghai');
  state = recordNightDreamMiss(state, new Date('2026-09-17T20:20:00Z'), 'Asia/Shanghai');
  assert.equal(state.consecutiveNightDreamMiss, 3);
  state = recordNightDream(state, {
    id: 'n-ok',
    createdAt: now.toISOString(),
    dream: '成功的一夜',
    residue: '想靠近',
    residue_strength: 0.4,
    source_date: '2026-08-18',
    source_event_ids: [101, 102],
  }, now, 'Asia/Shanghai');
  assert.equal(state.consecutiveNightDreamMiss, 0);
  state.consecutiveNightDreamMiss = 5;
  const cleared = clearNightDreamMissIfDisabled(state, 'off');
  assert.equal(cleared.consecutiveNightDreamMiss, 0);
  assert.equal(clearNightDreamMissIfDisabled(state, 'apply').consecutiveNightDreamMiss, 5);
});


test('high attachment relieves possess and crave only', () => {
  const before = newState();
  before.drives.possess = 0.80;
  before.drives.crave = 0.70;
  before.drives.curiosity = 0.60;
  before.drives.share = 0.50;
  const after = applyNightDreamDriveNudge(before, {
    residue_strength: 0.42,
    state_projection: { attachment: 'high', curiosity: 'medium', warmth: 'low' },
  });
  assert.ok(after.drives.possess < 0.80);
  assert.ok(after.drives.crave < 0.70);
  assert.equal(after.drives.curiosity, 0.60);
  assert.equal(after.drives.share, 0.50);
  assert.equal(Object.hasOwn(after, 'pendingDreamResidue'), false);
});


test('high curiosity relieves curiosity only', () => {
  const before = newState();
  before.drives.possess = 0.80;
  before.drives.crave = 0.70;
  before.drives.curiosity = 0.60;
  before.drives.share = 0.50;
  const after = applyNightDreamDriveNudge(before, {
    residue_strength: 0.42,
    state_projection: { attachment: 'low', curiosity: 'high' },
  });
  assert.ok(after.drives.curiosity < 0.60);
  assert.equal(after.drives.possess, 0.80);
  assert.equal(after.drives.crave, 0.70);
  assert.equal(after.drives.share, 0.50);
});


test('high attachment and curiosity relieve both mapped groups', () => {
  const before = newState();
  before.drives.possess = 0.80;
  before.drives.crave = 0.70;
  before.drives.curiosity = 0.60;
  before.drives.share = 0.50;
  const after = applyNightDreamDriveNudge(before, {
    residue_strength: 0.42,
    state_projection: { attachment: 'high', curiosity: 'high' },
  });
  assert.ok(after.drives.possess < 0.80);
  assert.ok(after.drives.crave < 0.70);
  assert.ok(after.drives.curiosity < 0.60);
  assert.equal(after.drives.share, 0.50);
});


test('medium and low bands leave drives unchanged', () => {
  const before = newState();
  const snapshot = { ...before.drives };
  const after = applyNightDreamDriveNudge(before, {
    residue_strength: 1,
    state_projection: {
      attachment: 'medium',
      curiosity: 'low',
      warmth: 'high',
      tension: 'high',
      fatigue: 'high',
    },
  });
  assert.deepEqual(after.drives, snapshot);
  assert.equal(after.revision, before.revision);
  assert.equal(after.pendingDreamResidue, undefined);
});


test('residue_strength 1 caps each target relief ratio at 0.04', () => {
  const before = newState();
  before.drives.possess = 0.80;
  before.drives.crave = 0.70;
  before.drives.curiosity = 0.60;
  before.drives.share = 0.50;
  const after = applyNightDreamDriveNudge(before, {
    residue_strength: 1,
    state_projection: { attachment: 'high', curiosity: 'high' },
  });
  assert.ok(after.drives.possess >= 0);
  assert.ok((0.80 - after.drives.possess) / 0.80 <= 0.04 + 1e-9);
  assert.ok((0.70 - after.drives.crave) / 0.70 <= 0.04 + 1e-9);
  assert.ok((0.60 - after.drives.curiosity) / 0.60 <= 0.04 + 1e-9);
  assert.equal(after.drives.share, 0.50);
  assert.equal(Object.hasOwn(after, 'pendingDreamResidue'), false);
});
