// Independent P1 candidates. No engine, memory, notification or model imports.
import { createHash } from 'node:crypto';

const HOUR = 3_600_000;
export const SHADOW_POLICY = Object.freeze({
  version: 1,
  favoredHalfLifeHours: 12, favoredCap: 0.55, favoredImpulse: 0.25, satisfaction: 0.50,
  empathyBase: 0.25, empathyHalfLifeHours: 6, helpedRelief: 0.60,
  othersCap: 0.45, strangerCap: 0.30, herCap: 0.75,
  dedupeHours: 6, maxEventAgeHours: 24, receiptHours: 48,
  maxReceipts: 2048, maxLoads: 512,
});
export const CLOSENESS_WEIGHTS = Object.freeze({ her: 1, family: 0.8, known: 0.5, stranger: 0.25, unknown: null });
export const EMPATHY_DAILY_CAPS = Object.freeze({ her: 0.50, family: 0.40, known: 0.30, stranger: 0.15, unknown: 0 });
export const EMPATHY_TARGETS = Object.freeze({ care: 'grieve', injustice: 'anger', help_intent: 'share', joy: null });
const HURT = ['explicit_ignore', 'explicit_slight', 'broken_promise', 'preference_gap'];
const RELIEF = ['active_response', 'reassurance', 'reconciliation', 'chosen', 'companionship'];
const SOURCES = ['owner_confirmation', 'trusted_adapter'];
const TYPES = ['favored_hurt', 'favored_relief', 'empathy', 'helped'];
const OPAQUE_ID = /^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const round = (v) => Number(v.toFixed(8));
const decay = (value, at, now, hours) => value * 2 ** (-Math.max(0, now - Date.parse(at)) / (hours * HOUR));
const fail = () => { throw new Error('invalid shadow event'); };

/** Strict data contract, not a claim of truth. Authorization/verification is external. */
export function validateShadowEvent(event, now = new Date()) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || !Number.isFinite(now.getTime())) fail();
  if (typeof event.event_type !== 'string') fail();
  const common = ['schema_version', 'event_id', 'event_type', 'occurred_at', 'source', 'evidence_ref', 'subject_ref', 'incident_ref'];
  const fields = event.event_type?.startsWith('favored_')
    ? [...common, 'reason'] : [...common, 'empathy_type', 'closeness', 'relationship_ref'];
  if (Object.keys(event).some((key) => !fields.includes(key)) || common.some((key) => !Object.hasOwn(event, key))) fail();
  if (event.schema_version !== 1 || !TYPES.includes(event.event_type) || !SOURCES.includes(event.source)) fail();
  for (const key of ['event_id', 'evidence_ref', 'subject_ref', 'incident_ref']) {
    if (typeof event[key] !== 'string' || !OPAQUE_ID.test(event[key])) fail();
  }
  const at = Date.parse(event.occurred_at);
  if (typeof event.occurred_at !== 'string' || !Number.isFinite(at) || new Date(at).toISOString() !== event.occurred_at ||
      at > now.getTime() || now.getTime() - at > SHADOW_POLICY.maxEventAgeHours * HOUR) fail();
  if (event.event_type === 'favored_hurt' && !HURT.includes(event.reason)) fail();
  if (event.event_type === 'favored_relief' && !RELIEF.includes(event.reason)) fail();
  if (['empathy', 'helped'].includes(event.event_type)) {
    if (!Object.hasOwn(EMPATHY_TARGETS, event.empathy_type) || !Object.hasOwn(CLOSENESS_WEIGHTS, event.closeness)) fail();
    if (event.closeness === 'unknown') {
      if (event.relationship_ref !== undefined) fail();
    } else if (typeof event.relationship_ref !== 'string' || !OPAQUE_ID.test(event.relationship_ref)) fail();
    if (event.event_type === 'helped' && event.empathy_type === 'joy') fail();
  }
  return structuredClone(event);
}

function dayKey(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key).value).join('-');
}
function fresh(now) {
  return { schemaVersion: 1, policyVersion: 1, lastProcessedAt: now.toISOString(), lastEffectiveAt: null,
    stats: { applied: 0, duplicate: 0, limited: 0, unknown: 0 }, receipts: [], seen: [], daily: {} };
}
function count(s, key) { s.stats[key] = Math.min(1_000_000_000, (s.stats[key] ?? 0) + 1); }
function loadsAt(s, now) {
  return (s.loads ?? []).map((load) => ({ ...load,
    value: decay(load.value, load.at, now.getTime(), SHADOW_POLICY.empathyHalfLifeHours), at: now.toISOString(),
  })).filter((load) => load.value >= 0.000001);
}
function loadKey(event) { return hash(event.subject_ref, event.incident_ref, event.empathy_type); }

/** Called only by the authorized internal service inside StateStore.update. */
export function reduceShadowEvent(state, event, now, options) {
  const favored = event.event_type.startsWith('favored_');
  const field = favored ? 'favoredShadow' : 'empathyShadow';
  const old = state[field];
  if (old && (old.schemaVersion !== 1 || old.policyVersion !== 1)) return { applied: false, reason: 'unsupported_state' };
  if (old && now.getTime() < Date.parse(old.lastProcessedAt)) return { applied: false, reason: 'clock_regression' };
  const s = old ? structuredClone(old) : fresh(now);
  const retention = (items, hours) => items.filter((item) => now.getTime() - Date.parse(item.at) < hours * HOUR);
  s.receipts = retention(s.receipts, SHADOW_POLICY.receiptHours);
  s.seen = retention(s.seen, SHADOW_POLICY.dedupeHours);
  const eventKey = hash(event.event_id); // Entry point and source do not namespace a canonical event.
  const semanticKey = favored ? hash(event.subject_ref, event.incident_ref, event.event_type, event.reason) : loadKey(event);
  const seenKey = hash(semanticKey, event.event_type);
  if (s.receipts.some((r) => r.key === eventKey) || s.seen.some((r) => r.key === seenKey)) {
    if (!s.receipts.some((r) => r.key === eventKey)) {
      if (s.receipts.length >= SHADOW_POLICY.maxReceipts) return { applied: false, reason: 'ledger_full' };
      s.receipts.push({ key: eventKey, at: now.toISOString() });
    }
    count(s, 'duplicate');
    s.lastProcessedAt = now.toISOString();
    state[field] = s;
    return { applied: false, reason: 'duplicate' };
  }
  // Fail closed rather than evict still-live dedupe receipts.
  if (s.receipts.length >= SHADOW_POLICY.maxReceipts || s.seen.length >= SHADOW_POLICY.maxReceipts) {
    return { applied: false, reason: 'ledger_full' };
  }
  s.receipts.push({ key: eventKey, at: now.toISOString() });
  s.seen.push({ key: seenKey, at: now.toISOString() });
  const day = dayKey(now, options.timeZone ?? 'Asia/Shanghai');
  if (s.daily.day !== day) s.daily = { day, events: 0 };
  let result = { applied: false, reason: 'daily_limit' };
  if (s.daily.events < (options.maxEffectsPerDay ?? 24)) {
    if (favored) {
      const before = decay(s.intensity ?? 0, s.updatedAt ?? now.toISOString(), now.getTime(), SHADOW_POLICY.favoredHalfLifeHours);
      const after = event.event_type === 'favored_hurt'
        ? Math.min(SHADOW_POLICY.favoredCap, before + SHADOW_POLICY.favoredImpulse)
        : before * SHADOW_POLICY.satisfaction;
      s.intensity = round(after);
      s.updatedAt = now.toISOString();
      s.lastDelta = round(after - before);
      result = { applied: after !== before, reason: after !== before ? 'applied' : 'no_change', expectedDelta: s.lastDelta };
    } else {
      const weight = CLOSENESS_WEIGHTS[event.closeness];
      s.loads = loadsAt(s, now);
      if (weight === null) {
        result = { applied: false, reason: 'unknown_closeness', closeness: 'unknown' };
        count(s, 'unknown');
      } else if (event.event_type === 'helped') {
        // Exact object + incident + kind AND verified relationship tier; never aggregate relief.
        const load = s.loads.find((l) => l.key === semanticKey && l.closeness === event.closeness);
        if (load) {
          const drop = load.value * SHADOW_POLICY.helpedRelief;
          load.value = round(load.value - drop);
          result = { applied: drop > 0, reason: 'applied', expectedDelta: { [EMPATHY_TARGETS[event.empathy_type]]: round(-drop) } };
        } else result = { applied: false, reason: 'no_matching_load' };
      } else {
        const target = EMPATHY_TARGETS[event.empathy_type];
        const existing = s.loads.find((l) => l.key === semanticKey);
        // A changed relationship needs an explicit future reconciliation protocol.
        if (existing && existing.closeness !== event.closeness) result = { applied: false, reason: 'relationship_mismatch' };
        else {
          const used = s.daily[event.closeness] ?? 0;
          let amount = Math.min(SHADOW_POLICY.empathyBase * weight, Math.max(0, EMPATHY_DAILY_CAPS[event.closeness] - used));
          if (target) {
            const sameTarget = s.loads.filter((l) => l.target === target);
            const total = (predicate) => sameTarget.filter(predicate).reduce((sum, l) => sum + l.value, 0);
            const own = event.closeness === 'her';
            amount = Math.min(amount, Math.max(0, (own ? SHADOW_POLICY.herCap : SHADOW_POLICY.othersCap) - total((l) => own ? l.closeness === 'her' : l.closeness !== 'her')));
            if (event.closeness === 'stranger') amount = Math.min(amount, Math.max(0, SHADOW_POLICY.strangerCap - total((l) => l.closeness === 'stranger')));
            if (!existing && s.loads.length >= SHADOW_POLICY.maxLoads) amount = 0;
          }
          amount = round(amount);
          if (amount > 0) {
            s.daily[event.closeness] = round(used + amount);
            if (target) {
              if (existing) existing.value = round(existing.value + amount);
              else s.loads.push({ key: semanticKey, type: event.empathy_type, closeness: event.closeness, target, value: amount, at: now.toISOString() });
            }
            const scale = amount / SHADOW_POLICY.empathyBase;
            result = { applied: true, reason: 'applied', expectedDelta: target ? { [target]: round(amount) } : {},
              emotionDelta: event.empathy_type === 'joy' ? { valence: round(0.12 * scale), arousal: round(0.10 * scale) } : { valence: 0, arousal: 0 } };
          } else result = { applied: false, reason: 'load_or_daily_limit' };
        }
      }
    }
  }
  if (result.applied) {
    count(s, 'applied');
    s.daily.events += 1;
    s.lastEffectiveAt = now.toISOString();
  } else if (['daily_limit', 'load_or_daily_limit'].includes(result.reason)) count(s, 'limited');
  s.lastProcessedAt = now.toISOString();
  // Only hashes, enumerations and numbers persist; no supplied text or names.
  s.lastEvent = { event: eventKey, evidence: hash(event.evidence_ref), incident: hash(event.incident_ref),
    source: event.source, occurredAt: event.occurred_at, type: event.event_type,
    reason: favored ? event.reason : event.empathy_type, ...(favored ? {} : { closeness: event.closeness,
      ...(event.relationship_ref ? { relationship: hash(event.relationship_ref) } : {}) }), result: result.reason };
  s.lastCandidate = { expectedDelta: result.expectedDelta ?? (favored ? 0 : {}),
    ...(favored ? {} : { emotionDelta: result.emotionDelta ?? { valence: 0, arousal: 0 } }) };
  state[field] = s;
  return result;
}

/** No state normalization or writes on Dashboard reads, even during sleep. */
const safeNumber = (value, min = 0, max = 1) => Number.isFinite(Number(value))
  ? round(Math.max(min, Math.min(max, Number(value)))) : 0;
const safeStats = (stats = {}) => Object.fromEntries(['applied', 'duplicate', 'limited', 'unknown']
  .map((key) => [key, Math.floor(safeNumber(stats[key], 0, 1_000_000_000))]));
const safeTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : null;
function safeCandidate(candidate = {}) {
  return {
    expectedDelta: Object.fromEntries(['grieve', 'anger', 'share']
      .filter((key) => Object.hasOwn(candidate.expectedDelta ?? {}, key))
      .map((key) => [key, safeNumber(candidate.expectedDelta[key], -1, 1)])),
    emotionDelta: { valence: safeNumber(candidate.emotionDelta?.valence, -1, 1),
      arousal: safeNumber(candidate.emotionDelta?.arousal, -1, 1) },
  };
}
export function projectRelationshipShadow(state, options = {}, now = new Date()) {
  const out = {};
  const f = state.favoredShadow;
  if (options.favoredEnabled === true && f?.schemaVersion === 1 && f.policyVersion === 1 && f.lastEvent) {
    out.favored = { intensity: safeNumber(decay(safeNumber(f.intensity, 0, SHADOW_POLICY.favoredCap), safeTime(f.updatedAt) ?? now.toISOString(), now.getTime(), SHADOW_POLICY.favoredHalfLifeHours)),
      trend: now.getTime() > Date.parse(f.updatedAt) && f.intensity > 0 ? 'decaying'
        : (f.lastDelta ?? 0) > 0 ? 'rising' : (f.lastDelta ?? 0) < 0 ? 'easing' : 'steady',
      lastEffectiveAt: safeTime(f.lastEffectiveAt), stats: safeStats(f.stats) };
  }
  const e = state.empathyShadow;
  if (options.empathyEnabled === true && e?.schemaVersion === 1 && e.policyVersion === 1 && e.lastEvent) {
    const loads = loadsAt(e, now);
    const groups = new Map();
    for (const l of loads) {
      if (!Object.hasOwn(EMPATHY_TARGETS, l.type) || !Object.hasOwn(CLOSENESS_WEIGHTS, l.closeness) ||
          EMPATHY_TARGETS[l.type] !== l.target) continue;
      const key = `${l.type}:${l.closeness}`;
      const group = groups.get(key) ?? { type: l.type, closeness: l.closeness, target: l.target, load: 0 };
      group.load += safeNumber(l.value);
      groups.set(key, group);
    }
    out.empathy = { categories: [...groups.values()].map((g) => ({ ...g, load: round(g.load) })),
      lastType: Object.hasOwn(EMPATHY_TARGETS, e.lastEvent.reason) ? e.lastEvent.reason : null,
      lastCloseness: Object.hasOwn(CLOSENESS_WEIGHTS, e.lastEvent.closeness) ? e.lastEvent.closeness : 'unknown',
      lastCandidate: safeCandidate(e.lastCandidate), lastEffectiveAt: safeTime(e.lastEffectiveAt), stats: safeStats(e.stats) };
  }
  return out;
}
