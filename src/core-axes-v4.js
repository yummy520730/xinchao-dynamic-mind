// Independent modeled response to verified Owner reports. Not an introspection
// claim, Shadow promotion, P0 replay or drive input. Caller must verify proof.
import { createHash } from 'node:crypto';
const H = 3_600_000;
export const CORE_AXES_POLICY = Object.freeze({ version: 1, baseline: Object.freeze({ security: .62, confidence: .60 }),
  min: .05, max: .95, halfLifeHours: 72, receiptHours: 48, semanticHours: 6, maxReceipts: 2048,
  maxEventsPerDay: 24, maxAbsoluteChangePerDay: .12 });
const PUSH = Object.freeze({ explicit_ignore: -.025, explicit_slight: -.02, broken_promise: -.03,
  preference_gap: -.02, active_response: .015, reassurance: .025, reconciliation: .03, chosen: .025, companionship: .005 });
const hash = (...parts) => createHash('sha256').update(JSON.stringify(['core-axes-v1', ...parts])).digest('hex');
const iso = (ms) => new Date(ms).toISOString();
const clamp = (v) => Math.max(CORE_AXES_POLICY.min, Math.min(CORE_AXES_POLICY.max, v));
function valuesAt(s, ms) {
  const factor = 2 ** (-Math.max(0, ms - Date.parse(s?.at ?? iso(ms))) / (CORE_AXES_POLICY.halfLifeHours * H));
  return Object.fromEntries(Object.entries(CORE_AXES_POLICY.baseline).map(([key, base]) =>
    [key, clamp(base + ((Number.isFinite(s?.[key]) ? s[key] : base) - base) * factor)]));
}
function dayOf(now, zone) {
  const p = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year','month','day'].map((k) => p.find((v) => v.type === k).value).join('-');
}
function validState(s) {
  return Number.isFinite(Date.parse(s.at)) && Number.isFinite(Date.parse(s.lastProcessedAt)) &&
    Date.parse(s.at) <= Date.parse(s.lastProcessedAt) &&
    ['security','confidence'].every((k) => Number.isFinite(s[k]) && s[k] >= CORE_AXES_POLICY.min && s[k] <= CORE_AXES_POLICY.max) &&
    Number.isInteger(s.sourceCount) && s.sourceCount >= 0 &&
    Array.isArray(s.receipts) && Array.isArray(s.seen) && s.receipts.length <= CORE_AXES_POLICY.maxReceipts &&
    s.seen.length <= CORE_AXES_POLICY.maxReceipts;
}
export function projectCoreAxesV4(s, now = new Date()) {
  if (s && s.version !== 1) return { status: 'unsupported_state' };
  if (s && !validState(s)) return { status: 'invalid_state' };
  const ms = now.getTime();
  if (!Number.isFinite(ms) || (s && ms < Date.parse(s.lastProcessedAt))) return { status: 'clock_regression' };
  const values = valuesAt(s, ms);
  const result = { status: s?.sourceCount ? 'owner_report_model' : 'baseline', halfLifeHours: CORE_AXES_POLICY.halfLifeHours,
    lastUpdatedAt: s?.lastEffectiveAt ?? null, sourceCount: s?.sourceCount ?? 0 };
  for (const key of ['security','confidence']) {
    const base = CORE_AXES_POLICY.baseline[key];
    result[key] = { value: Number(values[key].toFixed(6)), baseline: base,
      trend: Math.abs(values[key] - base) < .001 ? 'steady' : values[key] > base ? 'above_baseline' : 'below_baseline' };
  }
  return result;
}
/** Called ONLY after authorization, strict P1.5 schema and bound proof checks. */
export function reduceVerifiedCoreAxesV4(state, event, now, options = {}) {
  const no = (reason) => ({ applied: false, reason });
  if (options.coreAxesEnabled !== true) return no('disabled');
  if (event.source !== 'owner_confirmation') return no('source_not_permitted');
  const ms = now.getTime(), occurred = Date.parse(event.occurred_at);
  if (!Number.isFinite(ms) || !Number.isFinite(occurred) || occurred > ms || ms - occurred > 24 * H) return no('event_time_invalid');
  const old = state.coreAxesV4;
  if (old && old.version !== 1) return no('unsupported_state');
  if (old && !validState(old)) return no('invalid_state');
  if (old && ms < Date.parse(old.lastProcessedAt)) return no('clock_regression');
  const s = old ? structuredClone(old) : { version: 1, ...CORE_AXES_POLICY.baseline, at: iso(ms), sourceCount: 0, receipts: [], seen: [], daily: {} };
  s.receipts = s.receipts.filter((r) => ms - Date.parse(r.at) < CORE_AXES_POLICY.receiptHours * H);
  s.seen = s.seen.filter((r) => ms - Date.parse(r.at) < CORE_AXES_POLICY.semanticHours * H);
  const key = hash(event.event_id), binding = hash(event.event_type, event.subject_ref, event.incident_ref, event.occurred_at,
    event.reason ?? null, event.empathy_type ?? null, event.closeness ?? null, event.relationship_ref ?? null);
  const prior = s.receipts.find((r) => r.key === key);
  if (prior) return no(prior.binding === binding ? 'duplicate' : 'event_mismatch');
  const semantic = hash(event.subject_ref, event.incident_ref, event.event_type, event.reason ?? event.empathy_type);
  if (s.receipts.length >= CORE_AXES_POLICY.maxReceipts || s.seen.length >= CORE_AXES_POLICY.maxReceipts) return no('ledger_full');
  let axis, delta = 0;
  if (event.event_type.startsWith('favored_') && Object.hasOwn(PUSH, event.reason)) { axis = 'security'; delta = PUSH[event.reason]; }
  // A reported completed helping action, not a feeling/intent or task progress.
  if (event.event_type === 'helped') { axis = 'confidence'; delta = .02; }
  const zone = options.timeZone ?? 'Asia/Shanghai', day = dayOf(now, zone);
  let reason = !axis ? 'unsupported_event' : 'applied';
  if (s.seen.some((r) => r.key === semantic)) reason = 'duplicate';
  // Late events are discounted from occurrence to admission, never backdated.
  // Daily budget is admission-day absolute input (before discount), UTC/local
  // day anchored by configured zone. Opposite signs cannot cancel spending.
  const daily = s.daily.day === day ? s.daily : { day, timeZone: zone, events: 0, security: 0, confidence: 0 };
  if (s.daily.timeZone && s.daily.timeZone !== zone) return no('budget_policy_changed');
  if (reason === 'applied' && (daily.events >= CORE_AXES_POLICY.maxEventsPerDay || daily[axis] + Math.abs(delta) > CORE_AXES_POLICY.maxAbsoluteChangePerDay + 1e-12)) reason = 'daily_limit';
  if (reason === 'applied') {
    Object.assign(s, valuesAt(s, ms));
    s[axis] = clamp(s[axis] + delta * 2 ** (-(ms - occurred) / (CORE_AXES_POLICY.halfLifeHours * H)));
    s.at = iso(ms); s.lastEffectiveAt = iso(ms); s.sourceCount = Math.min(1e9, s.sourceCount + 1);
    daily.events++; daily[axis] += Math.abs(delta);
  }
  s.daily = daily;
  // Even limited/unsupported semantic admissions cannot later collect capacity.
  s.receipts.push({ key, binding, at: iso(ms) });
  if (reason !== 'duplicate') s.seen.push({ key: semantic, at: iso(ms) });
  s.lastProcessedAt = iso(ms); state.coreAxesV4 = s;
  return { applied: reason === 'applied', reason };
}
