// Opt-in 4.0-style emotion projection. Independent of the 12 existing drives.
// The only writer is a successfully settled semantic conversation event.
// Heartbeats, wall-clock settlement, memory recall and retries never write this layer.
// No raw conversation text or user-provided emotion/delta is accepted.
const HOUR = 3_600_000;
const MINUTE = 60_000;
const BASELINE = Object.freeze({ valence: 0.55, arousal: 0.30 });
const INERTIA = Object.freeze({ baseHoldMinutes: 10, causeHoldMinutes: 15, baseMargin: 0.10 });
const KEEP_MARKS_MS = 24 * HOUR;
const MERGE_MARKS_MS = 2 * HOUR;

const EVENTS = Object.freeze({
  companionship:  { dv:  0.03, da:  0.01, word: null,    priority: 0 },
  affection:      { dv:  0.12, da:  0.08, word: '温暖',  priority: 1 },
  intimacy:       { dv:  0.15, da:  0.18, word: '亲近',  priority: 2 },
  sharing:        { dv:  0.07, da:  0.05, word: '雀跃',  priority: 1 },
  discovery:      { dv:  0.05, da:  0.10, word: '好奇',  priority: 1 },
  task_progress:  { dv:  0.05, da:  0.00, word: '踏实',  priority: 1 },
  reflection:     { dv:  0.00, da: -0.08, word: null,    priority: 0 },
  conflict:       { dv: -0.18, da:  0.18, word: '生气',  priority: 2 },
  loss:           { dv: -0.16, da: -0.05, word: '失落',  priority: 2 },
  reconciliation: { dv:  0.14, da: -0.06, word: '释然',  priority: 3 },
  reassurance:    { dv:  0.09, da: -0.05, word: '安心',  priority: 3 },
});

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function validTime(value, fallback) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : fallback;
}

function round(value) {
  return Number(clamp(value).toFixed(4));
}

function afterDecay(state, nowMs) {
  const elapsed = Math.max(0, (nowMs - validTime(state.updatedAt, nowMs)) / HOUR);
  return {
    valence: BASELINE.valence + (clamp(state.valence) - BASELINE.valence) * Math.pow(0.5, elapsed / 6),
    arousal: BASELINE.arousal + (clamp(state.arousal) - BASELINE.arousal) * Math.pow(0.5, elapsed / 3),
  };
}

function baseCandidate(valence, arousal) {
  if (valence <= 0.43) return arousal >= 0.50 ? '烦躁' : '低落';
  if (valence >= 0.63) return arousal >= 0.65 ? '雀跃' : '安心';
  return '平静';
}

function applyBaseInertia(old, valence, arousal, nowMs) {
  const previous = old?.base && typeof old.base === 'object' ? old.base : { label: '平静' };
  const label = ['平静', '低落', '烦躁', '安心', '雀跃'].includes(previous.label)
    ? previous.label : '平静';
  const candidate = baseCandidate(valence, arousal);
  const since = new Date(nowMs).toISOString();
  if (candidate === label) return { label, since: previous.since ?? since, pending: null };
  // Minor fluctuations should not flip the durable base label.
  const distance = Math.max(Math.abs(valence - BASELINE.valence), Math.abs(arousal - BASELINE.arousal));
  if (distance < INERTIA.baseMargin) return { label, since: previous.since ?? since, pending: null };
  const pending = previous.pending;
  if (pending?.label === candidate &&
      nowMs - validTime(pending.since, nowMs) >= INERTIA.baseHoldMinutes * MINUTE) {
    return { label: candidate, since, pending: null };
  }
  return { label, since: previous.since ?? since, pending: { label: candidate, since: pending?.label === candidate ? pending.since : since } };
}

function addMark(marks, word, type, nowMs) {
  const entries = (Array.isArray(marks) ? marks : []).filter((mark) => {
    const at = validTime(mark.lastAt ?? mark.at, 0);
    return at > nowMs - KEEP_MARKS_MS && at <= nowMs;
  }).slice(-35).map((m) => ({ ...m }));
  if (!word) return entries;
  const last = [...entries].reverse().find((mark) => mark.word === word &&
    nowMs - validTime(mark.lastAt ?? mark.at, 0) <= MERGE_MARKS_MS);
  const at = new Date(nowMs).toISOString();
  if (last) {
    last.n = Math.min(999, Math.max(1, Number(last.n) || 1) + 1);
    last.lastAt = at;
    return entries;
  }
  entries.push({ at, word, weight: 1, why: type });
  return entries.slice(-36);
}

/**
 * An applied interaction produces one bounded emotion impulse.
 * The caller is responsible for event_id / interaction_id deduplication.
 */
export function recordEmotionV4(previous, interactionType, now = new Date()) {
  const kind = String(interactionType ?? '');
  const effect = EVENTS[kind];
  if (!effect || !Number.isFinite(now.getTime())) return previous ?? null;
  const nowMs = now.getTime();
  const old = previous && typeof previous === 'object' ? previous : null;
  const current = old ? afterDecay(old, nowMs) : BASELINE;
  const valence = round(current.valence + effect.dv);
  const arousal = round(current.arousal + effect.da);
  const activeCause = old?.cause && nowMs - validTime(old.cause.at, 0) < INERTIA.causeHoldMinutes * MINUTE
    ? old.cause : null;
  const replacesCause = Boolean(effect.word) && (!activeCause || effect.priority >= (Number(activeCause.priority) || 0));
  const cause = replacesCause
    ? { word: effect.word, priority: effect.priority, at: now.toISOString(), why: kind }
    : activeCause;
  const journal = (Array.isArray(old?.journal) ? old.journal : []).slice(-47);
  journal.push({ at: now.toISOString(), valence, arousal, type: kind });
  return {
    valence,
    arousal,
    updatedAt: now.toISOString(),
    base: applyBaseInertia(old, valence, arousal, nowMs),
    cause,
    marks: addMark(old?.marks, replacesCause ? effect.word : null, kind, nowMs),
    journal,
  };
}

/** Read-only projection: safe to call during sleep or dashboard refresh. */
export function projectEmotionV4(state, now = new Date()) {
  if (!state || !Number.isFinite(now.getTime())) return null;
  const { valence, arousal } = afterDecay(state, now.getTime());
  const base = typeof state.base?.label === 'string' ? state.base.label : '平静';
  const activeCause = state.cause &&
    now.getTime() - validTime(state.cause.at, 0) >= 0 &&
    now.getTime() - validTime(state.cause.at, 0) < INERTIA.causeHoldMinutes * MINUTE
    ? state.cause : null;
  const marks = addMark(state.marks, null, null, now.getTime());
  const journal = (Array.isArray(state.journal) ? state.journal : []).slice(-48).map((entry) => ({
    at: entry.at,
    valence: round(entry.valence),
    arousal: round(entry.arousal),
    type: entry.type,
  }));
  return {
    label: base,
    shown: activeCause?.word ?? base,
    valence: round(valence),
    arousal: round(arousal),
    cause: activeCause ? { word: activeCause.word, why: activeCause.why } : null,
    marks,
    journal,
  };
}
