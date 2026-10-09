import { projectEmotionV4 } from './emotion-v4.js';
const MIN = 60_000, H = 60 * MIN;
export const MIXED_POLICY = Object.freeze({ version: 1, negativeDeviation: .12, grieveThreshold: .30,
  approachThreshold: .60, holdMinutes: 20, maxHours: 6, confirmationGapMinutes: 30 });
const NAMES = Object.freeze({ unease_approach: '不安，也想靠近', unease_concern: '不安，仍有牵挂',
  loss_approach: '失落，也想靠近', loss_concern: '失落，仍有牵挂' });
function basis(state, now) {
  const emotion = projectEmotionV4(state.emotionV4, now);
  if (!emotion) return null;
  const relevant = emotion.marks.filter((m) => ['conflict','loss','reconciliation','reassurance'].includes(m.why))
    .sort((a,b) => Date.parse(b.lastAt ?? b.at) - Date.parse(a.lastAt ?? a.at));
  const mark = relevant[0];
  if (!mark || !['conflict','loss'].includes(mark.why)) return null;
  if (Math.max(Number(state.drives?.possess) || 0, Number(state.drives?.monitor) || 0) < MIXED_POLICY.approachThreshold) return null;
  if (mark.why === 'conflict' && .55 - emotion.valence < MIXED_POLICY.negativeDeviation - 1e-6) return null;
  if (mark.why === 'loss' && (Number(state.drives?.grieve) || 0) < MIXED_POLICY.grieveThreshold) return null;
  const direction = (Number(state.drives?.possess) || 0) >= MIXED_POLICY.approachThreshold ? 'approach' : 'concern';
  return { code: `${mark.why === 'conflict' ? 'unease' : 'loss'}_${direction}`, at: mark.lastAt ?? mark.at };
}
/** Observe ONLY successfully settled P0 interactions; never heartbeat/read/Shadow. */
export function recordMixedFeelingsV4(previous, state, now = new Date()) {
  const ms = now.getTime();
  if (!Number.isFinite(ms) || (previous && (previous.version !== 1 || ms <= Date.parse(previous.lastObservedAt)))) return previous ?? null;
  const s = previous ? structuredClone(previous) : { version: 1, episode: null, clearedAt: null };
  const candidate = basis(state, now), e = s.episode;
  s.lastObservedAt = now.toISOString();
  if (!candidate) {
    if (e && !e.endedAt) { e.endedAt = now.toISOString(); e.status = 'relieved'; }
    s.clearedAt = now.toISOString();
    return s;
  }
  if (e && !e.endedAt) {
    if (ms - Date.parse(e.since) >= MIXED_POLICY.maxHours * H) { e.status = 'timed_out'; e.endedAt = now.toISOString(); }
    else if (ms - Date.parse(e.lastConfirmedAt) > MIXED_POLICY.confirmationGapMinutes * MIN) { e.status = 'stale'; e.endedAt = now.toISOString(); }
    else {
      // A different synonym/negative source cannot restart the same coexistence.
      e.code = candidate.code;
      e.lastConfirmedAt = now.toISOString();
      if (ms - Date.parse(e.since) >= MIXED_POLICY.holdMinutes * MIN) e.confirmed = true;
    }
    return s;
  }
  // Terminal episode is locked until an actual below-threshold observation,
  // followed by a NEW negative mark. Elapsed time/reads cannot rearm it.
  if (e && (!s.clearedAt || Date.parse(s.clearedAt) <= Date.parse(e.since) || Date.parse(candidate.at) <= Date.parse(s.clearedAt))) return s;
  s.episode = { code: candidate.code, since: now.toISOString(), lastConfirmedAt: now.toISOString(),
    confirmed: false, status: 'candidate', endedAt: null };
  return s;
}
export function projectMixedFeelingsV4(s, state, now = new Date()) {
  const empty = { active: false, status: 'none', code: null, name: null, durationMinutes: 0, basis: 'p0_runtime_tension' };
  if (!s) return empty;
  if (s.version !== 1) return { ...empty, status: 'unsupported_state' };
  const ms = now.getTime(), e = s.episode;
  if (!Number.isFinite(ms) || ms < Date.parse(s.lastObservedAt)) return { ...empty, status: 'clock_regression' };
  if (!e || !Object.hasOwn(NAMES, e.code)) return empty;
  const duration = Math.max(0, Math.floor(((e.endedAt ? Math.min(ms, Date.parse(e.endedAt)) : ms) - Date.parse(e.since)) / MIN));
  let status = e.status;
  if (!e.endedAt) {
    if (ms - Date.parse(e.since) >= MIXED_POLICY.maxHours * H) status = 'timed_out';
    else if (!basis(state, now)) status = 'relieved';
    else if (ms - Date.parse(e.lastConfirmedAt) > MIXED_POLICY.confirmationGapMinutes * MIN) status = 'stale';
    else status = e.confirmed && basis(state, now).code === e.code ? 'active' : 'candidate';
  }
  // Name only after two fresh observations spanning hold, not time alone.
  const active = status === 'active';
  return { ...empty, active, status, code: active ? e.code : null, name: active ? NAMES[e.code] : null,
    durationMinutes: Math.min(MIXED_POLICY.maxHours * 60, duration) };
}
