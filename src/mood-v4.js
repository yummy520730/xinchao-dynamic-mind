// Event-sampled trend, never continuous coverage or long-term memory.
const H = 3_600_000;
export const MOOD_POLICY = Object.freeze({ version: 1, windowHours: 72, minimumHoursPerDay: 12, minimumSpanHours: 12 });
export function recordMoodV4(previous, emotion, now = new Date()) {
  const ms = now.getTime(), valence = emotion?.valence;
  if (!Number.isFinite(ms) || !Number.isFinite(valence) || valence < 0 || valence > 1) return previous ?? null;
  if (previous && (previous.version !== 1 || ms < Date.parse(previous.lastObservedAt))) return previous;
  const hour = Math.floor(ms / H) * H;
  // First accepted sample per UTC hour; later chat density does not reweight it.
  const buckets = (previous?.buckets ?? []).filter((b) => b.hour > ms - MOOD_POLICY.windowHours * H && b.hour <= hour).map((b) => ({ hour: b.hour, valence: b.valence }));
  if (!buckets.some((b) => b.hour === hour)) buckets.push({ hour, valence });
  return { version: 1, lastObservedAt: now.toISOString(), buckets: buckets.slice(-MOOD_POLICY.windowHours) };
}
export function projectMoodV4(s, now = new Date()) {
  const ms = now.getTime();
  const empty = { status: 'insufficient_data', value: null, trend: null, basis: 'event_samples', windowHours: 72,
    sampledHours: 0, coverage: 0, periods: [] };
  if (s && s.version !== 1) return { ...empty, status: 'unsupported_state' };
  if (!Number.isFinite(ms) || (s && ms < Date.parse(s.lastObservedAt))) return { ...empty, status: 'clock_regression' };
  // Query anchored rolling 24h periods, no local-midnight sample weighting.
  const entries = (s?.buckets ?? []).filter((b) => b.hour > ms - MOOD_POLICY.windowHours * H && b.hour <= ms && Number.isFinite(b.valence));
  const periods = [2,1,0].map((age) => {
    const rows = entries.filter((b) => b.hour > ms - (age + 1) * 24 * H && b.hour <= ms - age * 24 * H);
    const span = rows.length ? (Math.max(...rows.map((b) => b.hour)) - Math.min(...rows.map((b) => b.hour))) / H : 0;
    return { sampledHours: rows.length, spanHours: span, sufficient: rows.length >= MOOD_POLICY.minimumHoursPerDay && span >= MOOD_POLICY.minimumSpanHours,
      mean: rows.length ? rows.reduce((sum,b) => sum + b.valence, 0) / rows.length : null };
  });
  const sufficient = periods.every((p) => p.sufficient);
  const mean = sufficient ? periods.reduce((sum,p) => sum + p.mean, 0) / 3 : null;
  const difference = sufficient ? periods[2].mean - periods[0].mean : null;
  return { ...empty, status: sufficient ? 'available' : 'insufficient_data', value: mean === null ? null : Number(mean.toFixed(6)),
    trend: difference === null ? null : Math.abs(difference) < .03 ? 'steady' : difference > 0 ? 'brightening' : 'dimming',
    sampledHours: entries.length, coverage: Number((entries.length / 72).toFixed(4)),
    periods: periods.map(({mean,...rest}) => rest) };
}
