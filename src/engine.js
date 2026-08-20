import { createHash } from 'node:crypto';
import { DIMENSIONS, DRIVE_KEYS, MEMORY_AFFINITY, SATURATE_CEIL } from './dimensions.js';
import { newThoughtPool, obsessionBonus } from './thought-pool.js';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const iso = (value) => new Date(value).toISOString();
const SESSION_TONES = new Set(['neutral', 'calm', 'warm', 'guarded', 'conflicted', 'focused', 'playful', 'tired']);
const SESSION_FIELDS = ['warmth', 'tension', 'attention', 'confidence'];
const MAX_RECENT_CONVERSATION_EVENTS = 256;
const MAX_RECENT_STATE_SIGNALS = 256;
const MAX_RECENT_ACTIONS = 256;
const MAX_SILENCE_OBSERVATIONS = 64;
const MAX_RECENT_DREAMS = 20;
const ARRIVAL_DECAY = 0.99;
const RESONANCE_MIN_AFFINITY = 0.5;

export const INTERACTION_TYPES = Object.freeze([
  'companionship',
  'affection',
  'intimacy',
  'sharing',
  'discovery',
  'task_progress',
  'reflection',
  'conflict',
  'loss',
  'reconciliation',
  'reassurance',
]);

export const STATE_SIGNAL_TYPES = Object.freeze(['intimacy_cue']);

// State signals are ignition inputs, not completed interactions.  Clients may
// choose only a semantic type; drive math stays private to the engine.
const STATE_SIGNAL_EFFECTS = Object.freeze({
  intimacy_cue: Object.freeze({ increase: { libido: 0.08, crave: 0.06, possess: 0.02 } }),
});

const INTERACTION_EFFECTS = Object.freeze({
  companionship: { relief: { monitor: 0.06, social: 0.05 } },
  affection: { relief: { possess: 0.08, crave: 0.08, monitor: 0.05 } },
  intimacy: { relief: { possess: 0.12, crave: 0.15, libido: 0.18 } },
  sharing: { relief: { share: 0.14, social: 0.04 } },
  discovery: { relief: { curiosity: 0.15, boredom: 0.12 } },
  task_progress: { relief: { duty: 0.15 } },
  reflection: { relief: { reflection: 0.15 } },
  conflict: { increase: { anger: 0.07, grieve: 0.02 } },
  loss: { increase: { grieve: 0.08, monitor: 0.04 } },
  reconciliation: { relief: { anger: 0.30, grieve: 0.18, monitor: 0.04 } },
  reassurance: { relief: { grieve: 0.20, anger: 0.08, monitor: 0.05 } },
});

function ensureStateShape(state) {
  const previousSchemaVersion = Number(state.schemaVersion) || 0;
  state.sessionOverlays ??= {};
  state.contextDeliveries ??= {};
  state.recentConversationEvents = Array.isArray(state.recentConversationEvents)
    ? state.recentConversationEvents.slice(-MAX_RECENT_CONVERSATION_EVENTS)
    : [];
  if (previousSchemaVersion < 10) {
    state.recentConversationEvents = state.recentConversationEvents.filter(
      (item) => INTERACTION_TYPES.includes(String(item?.interactionType ?? '').trim().toLowerCase()),
    );
  }
  state.interactionUsage ??= {};
  state.recentStateSignals = Array.isArray(state.recentStateSignals)
    ? state.recentStateSignals.slice(-MAX_RECENT_STATE_SIGNALS)
    : [];
  state.stateSignalUsage ??= {};
  state.recentActions = Array.isArray(state.recentActions)
    ? state.recentActions.slice(-MAX_RECENT_ACTIONS)
    : [];
  state.silenceObservations = Array.isArray(state.silenceObservations)
    ? state.silenceObservations.slice(-MAX_SILENCE_OBSERVATIONS)
    : [];
  state.handoffNotes = Array.isArray(state.handoffNotes) ? state.handoffNotes : [];
  state.arrivalHistogram = Array.isArray(state.arrivalHistogram) && state.arrivalHistogram.length === 24
    ? state.arrivalHistogram.map((value) => Number(value) || 0)
    : Array.from({ length: 24 }, () => 0);
  state.lastDreamAttemptAt ??= null;
  state.lastDreamMaterialFingerprint ??= null;
  state.recentDreams = Array.isArray(state.recentDreams) ? state.recentDreams : [];
  if (previousSchemaVersion < 9) {
    state.recentDreams = collapseDuplicateDreamHistory(state.recentDreams);
  }
  state.schemaVersion = Math.max(13, previousSchemaVersion);
  return state;
}

function pruneExpiredSessionOverlays(state, now) {
  let removed = 0;
  const nowMs = now.getTime();
  for (const [sessionId, overlay] of Object.entries(state.sessionOverlays ?? {})) {
    const expiresAt = Date.parse(overlay?.expiresAt ?? '');
    if (Number.isFinite(expiresAt) && expiresAt <= nowMs) {
      delete state.sessionOverlays[sessionId];
      removed += 1;
    }
  }
  return removed;
}

function cleanSessionId(event) {
  return String(event?.sessionId ?? event?.session_id ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function cleanEventId(event) {
  return String(event?.eventId ?? event?.event_id ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function eventFingerprint(eventId) {
  return eventId
    ? createHash('sha256').update(eventId, 'utf8').digest('hex').slice(0, 24)
    : '';
}

function interactionType(event) {
  const value = String(event?.interactionType ?? event?.interaction_type ?? '').trim().toLowerCase();
  return INTERACTION_TYPES.includes(value) ? value : '';
}

function stateSignalType(event) {
  const value = String(event?.signalType ?? event?.signal_type ?? '').trim().toLowerCase();
  return STATE_SIGNAL_TYPES.includes(value) ? value : '';
}

function stateSignalOrigin(event) {
  const value = String(event?.origin ?? '').trim().toLowerCase();
  return value === 'user' ? value : '';
}

function interactionAlreadyProcessed(state, eventId) {
  const fingerprint = eventFingerprint(eventId);
  return Boolean(
    fingerprint
    && state.recentConversationEvents.some((item) => item?.eventFingerprint === fingerprint),
  );
}

function recordConversationEventFingerprint(state, eventId, type, now) {
  const fingerprint = eventFingerprint(eventId);
  if (!fingerprint) return;
  state.recentConversationEvents = [
    ...state.recentConversationEvents,
    {
      eventFingerprint: fingerprint,
      interactionType: type || null,
      processedAt: iso(now),
    },
  ].slice(-MAX_RECENT_CONVERSATION_EVENTS);
}

function stateSignalAlreadyProcessed(state, eventId) {
  const fingerprint = eventFingerprint(eventId);
  return Boolean(
    fingerprint
    && state.recentStateSignals.some((item) => item?.eventFingerprint === fingerprint),
  );
}

function recordStateSignalFingerprint(state, eventId, type, origin, now, reasonCode) {
  const fingerprint = eventFingerprint(eventId);
  if (!fingerprint) return;
  state.recentStateSignals = [
    ...state.recentStateSignals,
    {
      eventFingerprint: fingerprint,
      signalType: type,
      origin,
      processedAt: iso(now),
      reasonCode,
    },
  ].slice(-MAX_RECENT_STATE_SIGNALS);
}

function stateSignalResult(type, origin, applied, reasonCode, affectedDrives = []) {
  return { type: type || null, origin: origin || null, applied, reasonCode, affectedDrives };
}

export function applyStateSignal(input, event = {}, now = new Date(), options = {}) {
  const state = ensureStateShape(structuredClone(input));
  const eventId = cleanEventId(event);
  const type = stateSignalType(event);
  const origin = stateSignalOrigin(event);
  if (!eventId) {
    return { state, changed: false, duplicate: false, signal: stateSignalResult(type, origin, false, 'missing_event_id') };
  }
  if (!type || !origin) {
    return { state, changed: false, duplicate: false, signal: stateSignalResult(type, origin, false, 'unsupported_signal') };
  }
  if (stateSignalAlreadyProcessed(state, eventId)) {
    return { state, changed: false, duplicate: true, signal: stateSignalResult(type, origin, false, 'duplicate_event') };
  }

  const timeZone = options.timeZone ?? 'Asia/Shanghai';
  const { day } = localDayAndHour(now, timeZone);
  const dailyUsed = Number(state.stateSignalUsage[day] ?? 0);
  const maxPerDay = clamp(Number(options.maxPerDay ?? 12), 1, 96);
  const windowMinutes = clamp(Number(options.windowMinutes ?? 10), 1, 1440);
  const maxPerWindow = clamp(Number(options.maxPerWindow ?? 3), 1, 24);
  const windowStart = now.getTime() - windowMinutes * 60_000;
  const windowUsed = state.recentStateSignals.filter((item) => {
    const processedAt = Date.parse(item?.processedAt ?? '');
    return item?.reasonCode === 'applied' && Number.isFinite(processedAt) && processedAt >= windowStart;
  }).length;
  let reasonCode = 'applied';
  if (dailyUsed >= maxPerDay) reasonCode = 'daily_signal_limit';
  else if (windowUsed >= maxPerWindow) reasonCode = 'short_window_signal_limit';

  const affectedDrives = [];
  if (reasonCode === 'applied') {
    for (const [key, baseIncrease] of Object.entries(STATE_SIGNAL_EFFECTS[type].increase)) {
      const dimension = DIMENSIONS[key];
      if (!dimension || !DRIVE_KEYS.includes(key)) continue;
      const ceiling = Number(dimension.ceiling ?? SATURATE_CEIL);
      const current = Number(state.drives[key] ?? 0);
      const headroomRatio = clamp((ceiling - current) / Math.max(ceiling, 0.01), 0, 1);
      state.drives[key] = Number(clamp(current + Number(baseIncrease) * headroomRatio, 0, ceiling).toFixed(4));
      affectedDrives.push(key);
    }
    state.stateSignalUsage[day] = dailyUsed + 1;
    state.stateSignalUsage = Object.fromEntries(
      Object.entries(state.stateSignalUsage).sort(([left], [right]) => right.localeCompare(left)).slice(0, 14),
    );
  }
  recordStateSignalFingerprint(state, eventId, type, origin, now, reasonCode);
  state.revision += 1;
  return {
    state,
    changed: true,
    duplicate: false,
    signal: stateSignalResult(type, origin, reasonCode === 'applied', reasonCode, affectedDrives),
  };
}

export function settleAndApplyStateSignal(input, event = {}, now = new Date(), options = {}) {
  const settled = settleState(input, now, options.sleepAfterMinutes ?? 90, options.settle ?? {});
  const applied = applyStateSignal(settled.state, event, now, options.stateSignal ?? options);
  return { ...applied, settled };
}

function applyInteractionOutcome(state, type, now, options = {}) {
  if (!type) {
    return {
      type: null,
      applied: false,
      reasonCode: 'no_interaction_outcome',
      affectedDrives: [],
    };
  }
  const maxPerDay = clamp(Number(options.maxInteractionEffectsPerDay ?? 24), 1, 96);
  const timeZone = options.timeZone ?? 'Asia/Shanghai';
  const { day } = localDayAndHour(now, timeZone);
  const used = Number(state.interactionUsage[day] ?? 0);
  if (used >= maxPerDay) {
    return {
      type,
      applied: false,
      reasonCode: 'daily_effect_limit',
      affectedDrives: [],
    };
  }

  const effect = INTERACTION_EFFECTS[type];
  const affected = new Set();
  for (const [key, relief] of Object.entries(effect.relief ?? {})) {
    if (!DRIVE_KEYS.includes(key)) continue;
    const current = Number(state.drives[key] ?? 0);
    state.drives[key] = Number(clamp(current * (1 - clamp(Number(relief), 0, 0.35))).toFixed(4));
    affected.add(key);
  }
  for (const [key, increase] of Object.entries(effect.increase ?? {})) {
    if (!DRIVE_KEYS.includes(key)) continue;
    const current = Number(state.drives[key] ?? 0);
    state.drives[key] = Number(clamp(current + clamp(Number(increase), 0, 0.12)).toFixed(4));
    affected.add(key);
  }
  state.interactionUsage[day] = used + 1;
  state.interactionUsage = Object.fromEntries(
    Object.entries(state.interactionUsage).sort(([left], [right]) => right.localeCompare(left)).slice(0, 14),
  );
  return {
    type,
    applied: true,
    reasonCode: 'applied',
    affectedDrives: [...affected],
  };
}

function applySessionOverlay(state, event, now) {
  const sessionId = cleanSessionId(event);
  if (!sessionId) return { sessionId: '', created: false };
  const current = state.sessionOverlays[sessionId] ?? {
    sessionId,
    createdAt: iso(now),
    tone: 'neutral',
    warmth: 0.5,
    tension: 0,
    attention: 0.5,
    confidence: 0.5,
  };
  const absolute = event.sessionState ?? event.windowState ?? {};
  const deltas = event.sessionDeltas ?? event.windowDeltas ?? {};
  for (const key of SESSION_FIELDS) {
    const base = Number(current[key] ?? (key === 'tension' ? 0 : 0.5));
    const hasAbsolute = Number.isFinite(Number(absolute[key]));
    const delta = Number.isFinite(Number(deltas[key])) ? Number(deltas[key]) : 0;
    current[key] = Number(clamp((hasAbsolute ? Number(absolute[key]) : base) + delta).toFixed(4));
  }
  const tone = String(absolute.tone ?? event.sessionTone ?? current.tone ?? 'neutral').trim().toLowerCase();
  current.tone = SESSION_TONES.has(tone)
    ? tone
    : (SESSION_TONES.has(current.tone) ? current.tone : 'neutral');
  const ttlMinutes = clamp(Number(event.sessionTtlMinutes ?? event.session_ttl_minutes ?? 240), 15, 1440);
  current.lastConversationAt = iso(now);
  current.updatedAt = iso(now);
  current.expiresAt = iso(new Date(now.getTime() + ttlMinutes * 60_000));
  current.lastEventId = String(event.eventId ?? event.event_id ?? '').trim().slice(0, 120);
  const created = !state.sessionOverlays[sessionId];
  state.sessionOverlays[sessionId] = current;
  const entries = Object.entries(state.sessionOverlays)
    .sort((left, right) => Date.parse(right[1]?.updatedAt ?? '') - Date.parse(left[1]?.updatedAt ?? ''))
    .slice(0, 64);
  state.sessionOverlays = Object.fromEntries(entries);
  return { sessionId, created };
}

export function newState(now = new Date()) {
  const at = iso(now);
  return {
    schemaVersion: 13,
    revision: 0,
    consciousness: 'awake',
    lastConversationAt: at,
    lastHeartbeatAt: null,
    lastSettledAt: at,
    sleepStartedAt: null,
    drives: Object.fromEntries(DRIVE_KEYS.map((key) => [key, 0.15])),
    thoughtPool: newThoughtPool(),
    fatigue: 0,
    recentDreams: [],
    dreamUsage: {},
    lastDreamAttemptAt: null,
    lastDreamMaterialFingerprint: null,
    lastBarkAt: null,
    lastDreamBarkAt: null,
    lastAutonomousBarkAt: null,
    barkUsage: {},
    recentBarkMessages: [],
    lastDreamPushMessage: null,
    lastAutonomousMessage: null,
    lastDaytimeEmergenceAt: null,
    nextDaytimeEmergenceAt: null,
    daytimeEmergenceUsage: {},
    pendingAwareness: null,
    sessionOverlays: {},
    contextDeliveries: {},
    recentConversationEvents: [],
    interactionUsage: {},
    recentStateSignals: [],
    stateSignalUsage: {},
    recentActions: [],
    silenceObservations: [],
    arrivalHistogram: Array.from({ length: 24 }, () => 0),
  };
}

// ── Bark dedup utilities ──────────────────────────────────────────

function normalizeBarkMessage(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function characterNgrams(value, size = 2) {
  const chars = Array.from(value);
  if (chars.length < size) return chars.length ? [chars.join('')] : [];
  return Array.from({ length: chars.length - size + 1 }, (_, index) => chars.slice(index, index + size).join(''));
}

export function barkMessageSimilarity(left, right) {
  const a = normalizeBarkMessage(left);
  const b = normalizeBarkMessage(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = characterNgrams(a);
  const bGrams = characterNgrams(b);
  const remaining = new Map();
  for (const gram of aGrams) remaining.set(gram, Number(remaining.get(gram) ?? 0) + 1);
  let overlap = 0;
  for (const gram of bGrams) {
    const count = Number(remaining.get(gram) ?? 0);
    if (count > 0) {
      overlap += 1;
      remaining.set(gram, count - 1);
    }
  }
  const dice = (2 * overlap) / (aGrams.length + bGrams.length);
  const containment = overlap / Math.min(aGrams.length, bGrams.length);
  return Number(Math.max(dice, containment * 0.9).toFixed(4));
}

export function recentBarkHistory(state, limit = 8) {
  const current = Array.isArray(state.recentBarkMessages) ? state.recentBarkMessages : [];
  if (current.length) return current.slice(-limit);
  return [
    { at: state.lastDreamBarkAt, kind: 'dream', message: state.lastDreamPushMessage },
    { at: state.lastAutonomousBarkAt, kind: 'autonomous_thought', message: state.lastAutonomousMessage },
    { at: state.lastDaytimeEmergenceAt, kind: 'daytime_emergence', message: state.lastDaytimeMessage },
  ]
    .filter((item) => item.at && item.message)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
    .slice(-limit);
}

export function barkDuplicateCheck(message, state, threshold = 0.55) {
  const scores = recentBarkHistory(state).map((item) => barkMessageSimilarity(message, item.message));
  const similarity = scores.length ? Math.max(...scores) : 0;
  return { duplicate: similarity >= threshold, similarity };
}

function appendRecentBark(state, at, kind, message) {
  if (!message) return;
  state.recentBarkMessages = [
    ...recentBarkHistory(state),
    { at, kind, message },
  ].slice(-8);
  state.schemaVersion = Math.max(6, Number(state.schemaVersion) || 0);
}

// ── Time helpers ──────────────────────────────────────────────────

export function localDayAndHour(now, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) };
}

// ── Environmental settlement ──────────────────────────────────────

export function settleState(input, now = new Date(), sleepAfterMinutes = 90, options = {}) {
  const originalSchemaVersion = Number(input?.schemaVersion) || 0;
  const state = ensureStateShape(structuredClone(input));
  const nowMs = now.getTime();
  const elapsedHours = Math.max(0, (nowMs - Date.parse(state.lastSettledAt)) / 3_600_000);
  let changed = elapsedHours > 0 || originalSchemaVersion < state.schemaVersion;
  if (pruneExpiredSessionOverlays(state, now) > 0) changed = true;

  // Wall-clock settlement owns only observable environment state. Drives,
  // thoughts and fatigue may change only when an explicit event/wake evaluates
  // new evidence; elapsed time alone is never a psychic accumulator.
  void options;

  // Sleep transition
  const idleMinutes = Math.max(0, (nowMs - Date.parse(state.lastConversationAt)) / 60_000);
  if (idleMinutes >= sleepAfterMinutes && state.consciousness !== 'sleeping') {
    state.consciousness = 'sleeping';
    state.sleepStartedAt = iso(now);
    changed = true;
  }

  state.lastSettledAt = iso(now);
  if (changed) state.revision += 1;
  return { state, changed, elapsedHours, idleMinutes };
}

// ── Conversation event (wake up / interact) ───────────────────────

export function applyConversationEvent(input, event = {}, now = new Date(), options = {}) {
  const state = ensureStateShape(structuredClone(input));
  const eventId = cleanEventId(event);
  const type = interactionType(event);
  const sessionId = cleanSessionId(event);
  if (interactionAlreadyProcessed(state, eventId)) {
    return {
      state,
      changed: false,
      duplicate: true,
      wasSleeping: false,
      sessionId,
      sessionCreated: false,
      interaction: {
        type: type || null,
        applied: false,
        reasonCode: 'duplicate_event',
        affectedDrives: [],
      },
    };
  }
  const wasSleeping = state.consciousness === 'sleeping';
  const previousConversationMs = Date.parse(input.lastConversationAt ?? '');
  // Presence-only heartbeats prove the user is around, nothing more. They must
  // not wake the system, reset the conversation idle clock, or fabricate dream
  // awareness — only the observable presence anchor moves.
  if (options.presenceOnly === true && !type) {
    state.lastHeartbeatAt = iso(now);
    state.revision += 1;
    return {
      state,
      changed: true,
      duplicate: false,
      wasSleeping,
      sessionId,
      sessionCreated: false,
      interaction: {
        type: null,
        applied: false,
        reasonCode: 'presence_only',
        affectedDrives: [],
      },
    };
  }
  state.consciousness = 'awake';
  state.lastConversationAt = iso(now);
  // Any real conversation event is stronger evidence of presence than a
  // content-free heartbeat. Keep the autonomous-contact idle gate aligned
  // with both HTTP hooks and MCP interaction events.
  state.lastHeartbeatAt = iso(now);
  state.lastSettledAt = iso(now);
  state.sleepStartedAt = null;
  state.thoughtPool ??= newThoughtPool();
  const session = applySessionOverlay(state, event, now);

  if (wasSleeping) {
    const latest = state.recentDreams.at(-1);
    const belongsToThisSleep = latest && input.sleepStartedAt && Date.parse(latest.createdAt) >= Date.parse(input.sleepStartedAt);
    state.pendingAwareness = {
      createdAt: iso(now),
      dreamId: belongsToThisSleep ? latest.id : null,
      residue: belongsToThisSleep ? latest.residue : null,
      note: '外部记忆 MCP 只是记忆材料来源；调用记忆服务本身不代表醒来。',
    };
  }

  const interaction = type && !eventId
    ? {
      type,
      applied: false,
      reasonCode: 'missing_event_id',
      affectedDrives: [],
    }
    : applyInteractionOutcome(state, type, now, options);

  // Learn only from real semantic arrivals. Presence heartbeats and internal
  // LMC recalls never become samples, and messages inside one long session do
  // not flood the same hour bucket.
  if (type && options.recordArrival === true) {
    const gapMinutes = Number.isFinite(previousConversationMs)
      ? (now.getTime() - previousConversationMs) / 60_000
      : Infinity;
    if (wasSleeping || gapMinutes >= Number(options.arrivalGapMinutes ?? 90)) {
      const { hour } = localDayAndHour(now, options.timeZone ?? 'Asia/Shanghai');
      for (let index = 0; index < 24; index += 1) {
        state.arrivalHistogram[index] = Number((state.arrivalHistogram[index] * ARRIVAL_DECAY).toFixed(4));
      }
      state.arrivalHistogram[hour] = Number((state.arrivalHistogram[hour] + 1).toFixed(4));
    }
  }

  // Clients report semantic events only. Numeric deltas, self-selected
  // satisfaction and arbitrary thought text are intentionally ignored.

  // Presence-only heartbeats are not semantic interactions. Keeping them out
  // of this history prevents a healthy recall heartbeat from looking like a
  // broken interaction with interactionType=null.
  if (type) recordConversationEventFingerprint(state, eventId, type, now);
  state.revision += 1;
  return {
    state,
    changed: true,
    duplicate: false,
    wasSleeping,
    sessionId: session.sessionId,
    sessionCreated: session.created,
    interaction,
  };
}

export function settleAndApplyConversationEvent(input, event = {}, now = new Date(), options = {}) {
  const settled = settleState(
    input,
    now,
    options.sleepAfterMinutes ?? 90,
    options.settle ?? {},
  );
  const applied = applyConversationEvent(
    settled.state,
    event,
    now,
    {
      ...(options.interaction ?? {}),
      recordArrival: options.recordArrival === true,
      arrivalGapMinutes: options.arrivalGapMinutes,
      presenceOnly: options.presenceOnly === true,
      timeZone: options.settle?.timeZone ?? options.timeZone ?? options.interaction?.timeZone,
    },
  );
  return {
    ...applied,
    settled,
  };
}

// ── pickIntent (weighted random from tied pool) ───────────────────

export function pickIntent(state, random = Math.random) {
  const entries = Object.entries(state.drives)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  if (!entries.length) return null;

  const maxVal = Number(entries[0][1]);
  const tied = entries.filter(([, v]) => maxVal - Number(v) <= 0.12);

  if (tied.length === 1) {
    return { key: tied[0][0], value: Number(tied[0][1]), label: DIMENSIONS[tied[0][0]].label };
  }

  const pool = state.thoughtPool ?? newThoughtPool();
  const weights = tied.map(([key, value]) => ({
    key,
    value: Number(value),
    weight: Number(value) + obsessionBonus(pool, key),
  }));

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = random() * totalWeight;

  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return { key: w.key, value: w.value, label: DIMENSIONS[w.key].label };
  }

  return { key: weights[0].key, value: weights[0].value, label: DIMENSIONS[weights[0].key].label };
}

// ── Heartbeat / idle ──────────────────────────────────────────────

export function applyOmbreHeartbeat(input, now = new Date()) {
  return applyConversationEvent(input, {}, now, { presenceOnly: true });
}

export function contactIdleAllowed(state, now, minIdleHours) {
  if (!state.lastHeartbeatAt) return false;
  const lastHeartbeatMs = Date.parse(state.lastHeartbeatAt);
  return Number.isFinite(lastHeartbeatMs)
    && now.getTime() - lastHeartbeatMs >= minIdleHours * 3_600_000;
}

export function observeSilenceThreshold(input, now = new Date(), thresholdHours = 2) {
  const state = ensureStateShape(structuredClone(input));
  const threshold = Math.max(0.25, Number(thresholdHours) || 2);
  const anchorAt = state.lastHeartbeatAt ?? state.lastConversationAt;
  const anchorMs = Date.parse(anchorAt ?? '');
  const elapsedHours = Number.isFinite(anchorMs)
    ? Math.max(0, (now.getTime() - anchorMs) / 3_600_000)
    : 0;
  const active = Number.isFinite(anchorMs) && elapsedHours >= threshold;
  const fingerprint = active
    ? eventFingerprint(`silence:${anchorAt}:${threshold}`)
    : '';
  const duplicate = Boolean(
    fingerprint
    && state.silenceObservations.some((item) => item?.eventFingerprint === fingerprint),
  );
  if (!active || duplicate) {
    return {
      state,
      changed: false,
      active,
      crossed: false,
      duplicate,
      thresholdHours: threshold,
      elapsedHours,
      anchorAt: anchorAt ?? null,
    };
  }
  state.silenceObservations = [
    ...state.silenceObservations,
    {
      type: 'silence_threshold_crossed',
      eventFingerprint: fingerprint,
      thresholdHours: threshold,
      anchorAt,
      observedAt: iso(now),
    },
  ].slice(-MAX_SILENCE_OBSERVATIONS);
  state.revision += 1;
  return {
    state,
    changed: true,
    active: true,
    crossed: true,
    duplicate: false,
    thresholdHours: threshold,
    elapsedHours,
    anchorAt,
  };
}

// ── Drive feedback ────────────────────────────────────────────────

export function applyDriveFeedback(input, feedback = {}, now = new Date()) {
  const state = ensureStateShape(structuredClone(input));
  for (const [key, delta] of Object.entries(feedback)) {
    if (DRIVE_KEYS.includes(key) && Number.isFinite(Number(delta))) {
      const ceiling = clamp(Number(DIMENSIONS[key].ceiling ?? SATURATE_CEIL), 0.1, 1);
      state.drives[key] = Number(clamp(Number(state.drives[key]) + Number(delta), 0, ceiling).toFixed(4));
    }
  }
  state.lastSettledAt = iso(now);
  state.revision += 1;
  return state;
}

export function completeAction(input, action = {}, now = new Date(), amount = 0.30) {
  const state = ensureStateShape(structuredClone(input));
  const eventId = cleanEventId(action);
  const driveKey = String(action.driveKey ?? action.drive_key ?? '').trim();
  const kind = String(action.kind ?? 'action_result').trim().slice(0, 80);
  if (!eventId) {
    return { state, changed: false, duplicate: false, applied: false, reasonCode: 'missing_event_id' };
  }
  if (!DRIVE_KEYS.includes(driveKey)) {
    return { state, changed: false, duplicate: false, applied: false, reasonCode: 'unknown_drive', key: driveKey || null };
  }
  const fingerprint = eventFingerprint(eventId);
  if (state.recentActions.some((item) => item?.eventFingerprint === fingerprint)) {
    return { state, changed: false, duplicate: true, applied: false, reasonCode: 'duplicate_event', key: driveKey };
  }
  const satisfaction = clamp(Number(amount) || 0.30, 0.05, 0.95);
  const before = Number(state.drives[driveKey] ?? 0);
  const after = Number(clamp(before * (1 - satisfaction), 0, Number(DIMENSIONS[driveKey].ceiling ?? 1)).toFixed(4));
  state.drives[driveKey] = after;
  state.recentActions = [
    ...state.recentActions,
    {
      eventFingerprint: fingerprint,
      kind,
      driveKey,
      completedAt: iso(now),
    },
  ].slice(-MAX_RECENT_ACTIONS);
  state.lastSettledAt = iso(now);
  state.revision += 1;
  return {
    state,
    changed: true,
    duplicate: false,
    applied: true,
    reasonCode: 'satisfied',
    key: driveKey,
    before,
    after,
    decrease: Number((before - after).toFixed(4)),
  };
}

// Recalled LMC metadata may gently resonate with drives.  Per-drive ceilings,
// max affinity (not additive affinity), and a per-call cap keep this bounded.
export function applyMemoryResonance(input, signals = [], now = new Date(), options = {}) {
  const state = ensureStateShape(structuredClone(input));
  const nudge = clamp(Number(options.nudge ?? 0.02), 0, 0.1);
  const perCallCap = clamp(Number(options.perCallCap ?? 0.06), 0, 0.3);
  const affinity = {};
  for (const raw of Array.isArray(signals) ? signals : []) {
    const map = MEMORY_AFFINITY[String(raw ?? '').trim().toLowerCase()];
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      affinity[key] = Math.max(affinity[key] ?? 0, Number(value) || 0);
    }
  }
  const applied = {};
  let budget = perCallCap;
  for (const [key, value] of Object.entries(affinity)) {
    if (budget <= 0) break;
    if (value < RESONANCE_MIN_AFFINITY || !DRIVE_KEYS.includes(key)) continue;
    const ceiling = clamp(Number(DIMENSIONS[key].ceiling ?? SATURATE_CEIL), 0.1, 1);
    const before = Number(state.drives[key] ?? 0);
    const delta = Math.min(nudge * value, budget, Math.max(0, ceiling - before));
    const after = Number((before + delta).toFixed(4));
    if (after !== before) {
      state.drives[key] = after;
      applied[key] = Number((after - before).toFixed(4));
      budget = Number((budget - applied[key]).toFixed(4));
    }
  }
  const changed = Object.keys(applied).length > 0;
  if (changed) {
    state.lastSettledAt = iso(now);
    state.revision += 1;
  }
  return { state, applied, changed, reasonCode: changed ? 'resonated' : 'no_affinity' };
}

export function computeAnticipation(state, now = new Date(), options = {}) {
  const histogram = Array.isArray(state?.arrivalHistogram) ? state.arrivalHistogram : [];
  const total = histogram.reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (total < Number(options.minSamples ?? 8)) return 0;
  const { hour } = localDayAndHour(now, options.timeZone ?? 'Asia/Shanghai');
  const probability = (value) => (Number(histogram[((value % 24) + 24) % 24]) || 0) / total;
  const windowAt = (value) => probability(value) + 0.6 * probability(value + 1) + 0.3 * probability(value - 1);
  const peak = Math.max(...Array.from({ length: 24 }, (_, index) => windowAt(index)));
  if (peak <= 0) return 0;
  const relative = windowAt(hour) / peak;
  if (relative < Number(options.quietGate ?? 0.15)) return 0;
  const previous = Date.parse(state?.lastConversationAt ?? '');
  const idleHours = Number.isFinite(previous) ? Math.max(0, (now.getTime() - previous) / 3_600_000) : 0;
  return Number((relative * clamp(idleHours / Number(options.expectIdleHours ?? 3), 0, 1)).toFixed(3));
}

export function computeLonging(state, now = new Date(), options = {}) {
  const anchorAt = state?.lastHeartbeatAt ?? state?.lastConversationAt;
  const observedThreshold = (Array.isArray(state?.silenceObservations) ? state.silenceObservations : [])
    .filter((item) => item?.type === 'silence_threshold_crossed' && item?.anchorAt === anchorAt)
    .reduce((maximum, item) => Math.max(maximum, Number(item?.thresholdHours) || 0), 0);
  if (observedThreshold <= 0) return 0;
  const monitor = clamp(Number(state?.drives?.monitor ?? 0), 0, 1);
  const fullThreshold = Math.max(1, Number(options.fullThresholdHours ?? 12));
  void now;
  return Number((monitor * clamp(observedThreshold / fullThreshold, 0, 1)).toFixed(3));
}

export function activeSessionOverlay(input, sessionId, now = new Date()) {
  const state = ensureStateShape(structuredClone(input));
  const key = String(sessionId ?? '').trim();
  if (!key) return null;
  const overlay = state.sessionOverlays[key];
  if (!overlay) return null;
  const expiresAt = Date.parse(overlay.expiresAt ?? '');
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) return null;
  return structuredClone(overlay);
}

// ── Top drives ────────────────────────────────────────────────────

export function topDrives(state, limit = 5) {
  return Object.entries(state.drives)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => ({ key, label: DIMENSIONS[key].label, value }));
}

// ── Dream management ──────────────────────────────────────────────

export function recordDream(input, dream) {
  const state = ensureStateShape(structuredClone(input));
  dream.fingerprint = dreamFingerprint(dream) || dream.fingerprint || null;
  state.recentDreams.push(dream);
  state.recentDreams = state.recentDreams.slice(-MAX_RECENT_DREAMS);
  const day = dream.createdAt.slice(0, 10);
  state.dreamUsage[day] = Number(state.dreamUsage[day] ?? 0) + 1;
  state.lastDreamAttemptAt = dream.createdAt;
  state.lastDreamMaterialFingerprint = dream.materialFingerprint ?? null;
  state.revision += 1;
  return state;
}

function normalizeDreamText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function dreamNgrams(value, size = 2) {
  const chars = Array.from(value);
  if (chars.length < size) return chars.length ? [chars.join('')] : [];
  return Array.from({ length: chars.length - size + 1 }, (_, index) => chars.slice(index, index + size).join(''));
}

function dreamText(dream) {
  return [dream?.dream, dream?.residue, dream?.awareness].filter(Boolean).join('\n');
}

export function dreamFingerprint(dream) {
  const normalized = normalizeDreamText(dreamText(dream));
  return normalized ? createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24) : '';
}

export function dreamMaterialFingerprint(material, topDriveItems = []) {
  const normalized = normalizeDreamText([String(material ?? ''), JSON.stringify(
    (Array.isArray(topDriveItems) ? topDriveItems : []).map((item) => [item?.key, Number(item?.value ?? 0).toFixed(2)]),
  )].join('\n'));
  return normalized ? createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24) : '';
}

export function dreamSimilarity(left, right) {
  const a = normalizeDreamText(dreamText(left));
  const b = normalizeDreamText(dreamText(right));
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = dreamNgrams(a);
  const bGrams = dreamNgrams(b);
  const remaining = new Map();
  for (const gram of aGrams) remaining.set(gram, Number(remaining.get(gram) ?? 0) + 1);
  let overlap = 0;
  for (const gram of bGrams) {
    const count = Number(remaining.get(gram) ?? 0);
    if (count > 0) { overlap += 1; remaining.set(gram, count - 1); }
  }
  const dice = (2 * overlap) / (aGrams.length + bGrams.length);
  const containment = overlap / Math.min(aGrams.length, bGrams.length);
  return Number(Math.max(dice, containment * 0.92).toFixed(4));
}

// Template-assembled dreams can re-share one long component (e.g. the same
// motion sentence) while the rest differs, which whole-text n-gram similarity
// scores far below the duplicate threshold. A shared continuous fragment with
// the immediately previous dream is a duplicate regardless of the global
// score. Only the latest dream is compared: fixed template pools make overlap
// with older dreams inevitable, and a wider window would eventually reject
// every new dream and starve shadow-mode dreaming entirely.
const SHARED_FRAGMENT_MIN_CHARS = 20;
const SHARED_FRAGMENT_LOOKBACK = 1;

export function sharesLongFragment(left, right, minChars = SHARED_FRAGMENT_MIN_CHARS) {
  const a = normalizeDreamText(left);
  const b = normalizeDreamText(right);
  if (!a || !b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < minChars) return shorter === longer;
  for (let index = 0; index + minChars <= shorter.length; index += 4) {
    if (longer.includes(shorter.slice(index, index + minChars))) return true;
  }
  return false;
}

export function collapseDuplicateDreamHistory(items, threshold = 0.94) {
  const keptNewestFirst = [];
  for (const dream of (Array.isArray(items) ? items : []).slice().reverse()) {
    const fingerprint = dream?.fingerprint || dreamFingerprint(dream);
    const duplicate = keptNewestFirst.some((existing) => {
      const existingFingerprint = existing?.fingerprint || dreamFingerprint(existing);
      return (fingerprint && fingerprint === existingFingerprint)
        || dreamSimilarity(dream, existing) >= threshold;
    });
    if (!duplicate) keptNewestFirst.push(dream);
  }
  return keptNewestFirst.reverse().slice(-MAX_RECENT_DREAMS);
}

export function dreamDuplicateCheck(dream, state, threshold = 0.62) {
  const fingerprint = dreamFingerprint(dream);
  let similarity = 0;
  let matchedDreamId = null;
  let sharedFragment = false;
  const recent = (state?.recentDreams ?? []).slice(-MAX_RECENT_DREAMS);
  for (const existing of recent) {
    const score = fingerprint && fingerprint === (existing?.fingerprint || dreamFingerprint(existing))
      ? 1 : dreamSimilarity(dream, existing);
    if (score > similarity) { similarity = score; matchedDreamId = existing?.id ?? null; }
  }
  for (const existing of recent.slice(-SHARED_FRAGMENT_LOOKBACK)) {
    if (sharesLongFragment(dreamText(dream), dreamText(existing))) {
      sharedFragment = true;
      matchedDreamId = existing?.id ?? matchedDreamId;
    }
  }
  return { duplicate: sharedFragment || similarity >= threshold, fingerprint, similarity, matchedDreamId, sharedFragment };
}

export function recordDreamAttempt(input, now = new Date(), materialFingerprint = null) {
  const state = ensureStateShape(structuredClone(input));
  state.lastDreamAttemptAt = iso(now);
  state.lastDreamMaterialFingerprint = materialFingerprint || null;
  state.revision += 1;
  return state;
}

function compactDreamText(value, maxChars = 280) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

export function breathDreamContext(input, now = new Date(), maxAgeHours = 18, maxDreams = 3) {
  const cutoff = now.getTime() - Math.max(1, Number(maxAgeHours) || 18) * 3_600_000;
  const limit = Math.max(1, Math.min(3, Number(maxDreams) || 3));
  const dreams = (input.recentDreams ?? [])
    .filter((dream) => {
      const createdAt = Date.parse(dream.createdAt ?? '');
      return Number.isFinite(createdAt) && createdAt >= cutoff && createdAt <= now.getTime();
    })
    .slice(-limit)
    .map((dream) => ({
      id: dream.id,
      createdAt: dream.createdAt,
      summary: compactDreamText(dream.awareness || dream.residue),
      residue: compactDreamText(dream.residue),
    }))
    .filter((dream) => dream.summary || dream.residue);
  return { version: 1, available: dreams.length > 0, dreams };
}

// ── Bark management ───────────────────────────────────────────────

export function recordBark(input, now = new Date(), details = {}) {
  const state = structuredClone(input);
  const at = iso(now);
  const day = at.slice(0, 10);
  appendRecentBark(state, at, details.kind ?? 'unknown', details.message);
  state.lastBarkAt = at;
  state.barkUsage ??= {};
  state.barkUsage[day] = Number(state.barkUsage[day] ?? 0) + 1;
  if (details.kind === 'dream') state.lastDreamBarkAt = at;
  if (details.kind === 'autonomous_thought') state.lastAutonomousBarkAt = at;
  if (details.kind === 'dream') state.lastDreamPushMessage = details.message ?? null;
  if (details.kind === 'autonomous_thought') state.lastAutonomousMessage = details.message ?? null;
  state.revision += 1;
  return state;
}

// ── Daytime emergence ─────────────────────────────────────────────

export function daytimeEmergenceAllowed(state, now, options) {
  const { day, hour } = localDayAndHour(now, options.timeZone);
  if (hour < options.startHour || hour >= options.endHour) return false;
  if (Number(state.daytimeEmergenceUsage?.[day] ?? 0) >= options.maxPerDay) return false;
  const dueAt = Date.parse(state.nextDaytimeEmergenceAt ?? '');
  return Number.isFinite(dueAt) && now.getTime() >= dueAt;
}

export function scheduleDaytimeEmergence(input, now = new Date(), minHours = 2, maxHours = 3, random = Math.random) {
  const state = structuredClone(input);
  const low = Math.min(minHours, maxHours);
  const high = Math.max(minHours, maxHours);
  const delayHours = low + clamp(Number(random()), 0, 1) * (high - low);
  state.nextDaytimeEmergenceAt = iso(new Date(now.getTime() + delayHours * 3_600_000));
  state.revision += 1;
  return state;
}

export function recordDaytimeEmergence(input, message, now = new Date(), timeZone = 'Asia/Shanghai') {
  const state = structuredClone(input);
  const at = iso(now);
  const { day } = localDayAndHour(now, timeZone);
  appendRecentBark(state, at, 'daytime_emergence', message);
  state.lastDaytimeEmergenceAt = at;
  state.lastDaytimeMessage = message;
  state.daytimeEmergenceUsage ??= {};
  state.daytimeEmergenceUsage[day] = Number(state.daytimeEmergenceUsage[day] ?? 0) + 1;
  state.revision += 1;
  return state;
}

// ── Bark gating ───────────────────────────────────────────────────

export function barkAllowed(state, now, minIntervalHours, maxPerDay, kind = null) {
  const day = iso(now).slice(0, 10);
  if (Number(state.barkUsage?.[day] ?? 0) >= maxPerDay) return false;
  const lastAt = kind === 'dream'
    ? state.lastDreamBarkAt
    : kind === 'autonomous_thought' ? state.lastAutonomousBarkAt : state.lastBarkAt;
  if (!lastAt) return true;
  return now.getTime() - Date.parse(lastAt) >= minIntervalHours * 3_600_000;
}

export function proactiveBarkAllowed(state, now, minIntervalHours, maxPerDay, minDrive) {
  if (state.consciousness !== 'sleeping') return false;
  const strongest = Math.max(...Object.values(state.drives).map(Number));
  return strongest >= minDrive && barkAllowed(state, now, minIntervalHours, maxPerDay, 'autonomous_thought');
}

export function dreamAllowed(state, now, minIntervalHours, maxPerDay) {
  if (state.consciousness !== 'sleeping') return false;
  const day = iso(now).slice(0, 10);
  if (Number(state.dreamUsage[day] ?? 0) >= maxPerDay) return false;
  const latest = state.recentDreams.at(-1);
  const latestAt = Math.max(
    Number.isFinite(Date.parse(latest?.createdAt ?? '')) ? Date.parse(latest.createdAt) : 0,
    Number.isFinite(Date.parse(state.lastDreamAttemptAt ?? '')) ? Date.parse(state.lastDreamAttemptAt) : 0,
  );
  if (!latestAt) return true;
  return now.getTime() - latestAt >= minIntervalHours * 3_600_000;
}
