const FLASH_DECAY       = 0.82;
const OBSESSION_GROWTH  = 1.10;
const PROMOTE_THRESHOLD = 0.50;
const PROMOTE_MIN_AGE   = 3;
const FEEDBACK_AMOUNT   = 0.18;
const FEEDBACK_CEIL     = 0.85;
const MAX_FEEDBACKS     = 3;
const MAX_FLASH         = 8;
const MAX_OBSESSIONS    = 3;

export function newThoughtPool() {
  return { flash: [], obsessions: [] };
}

export function tickThoughtPool(pool) {
  pool.flash = pool.flash
    .map((t) => ({ ...t, intensity: t.intensity * FLASH_DECAY, age: t.age + 1 }))
    .filter((t) => t.intensity > 0.05);

  const promoted = [];
  pool.flash = pool.flash.filter((t) => {
    if (t.intensity >= PROMOTE_THRESHOLD && t.age >= PROMOTE_MIN_AGE && pool.obsessions.length + promoted.length < MAX_OBSESSIONS) {
      promoted.push({ key: t.key, text: t.text, intensity: t.intensity, feedbacks: 0 });
      return false;
    }
    return true;
  });
  pool.obsessions.push(...promoted);

  const feedbacks = {};
  pool.obsessions = pool.obsessions
    .map((o) => {
      const next = { ...o, intensity: Math.min(1, o.intensity * OBSESSION_GROWTH) };
      if (next.intensity > FEEDBACK_CEIL && next.feedbacks < MAX_FEEDBACKS) {
        feedbacks[next.key] = (feedbacks[next.key] ?? 0) + FEEDBACK_AMOUNT;
        next.feedbacks += 1;
      }
      return next;
    })
    .filter((o) => o.feedbacks < MAX_FEEDBACKS);

  return feedbacks;
}

export function addFlashThought(pool, key, text, intensity = 0.70) {
  if (pool.flash.length >= MAX_FLASH) {
    pool.flash.sort((a, b) => a.intensity - b.intensity);
    pool.flash.shift();
  }
  pool.flash.push({ key, text, intensity: Math.min(1, intensity), age: 0 });
}

export function obsessionBonus(pool, key) {
  const hit = (pool?.obsessions ?? []).find((o) => o.key === key);
  return hit ? hit.intensity * 0.15 : 0;
}

// A delivered autonomous expression leaves a bounded trace in the thought
// pool.  It does not directly raise a drive, so a single message naturally
// fades; only repeated expression can become an obsession through the normal
// pool lifecycle.
export function reinforceThought(pool, key, text, amount = 0.30) {
  pool.flash ??= [];
  const step = Math.min(1, Math.max(0, Number(amount) || 0));
  const existing = pool.flash.find((item) => item.key === key);
  if (existing) {
    existing.intensity = Math.min(1, Number(existing.intensity ?? 0) + step);
    if (text) existing.text = String(text).slice(0, 500);
    return { key, intensity: Number(existing.intensity.toFixed(4)), seeded: false };
  }
  addFlashThought(pool, key, String(text ?? '').slice(0, 500), step);
  const created = pool.flash.find((item) => item.key === key);
  return { key, intensity: Number((created?.intensity ?? step).toFixed(4)), seeded: true };
}
