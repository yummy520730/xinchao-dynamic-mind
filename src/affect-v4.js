import { projectCoreAxesV4 } from './core-axes-v4.js';
import { recordMoodV4, projectMoodV4 } from './mood-v4.js';
import { recordMixedFeelingsV4, projectMixedFeelingsV4 } from './mixed-feelings-v4.js';
export function recordAffectV4(state, now, options = {}) {
  if (options.moodEnabled === true) {
    const next = recordMoodV4(state.moodV4, state.emotionV4, now);
    if (next) state.moodV4 = next;
  }
  if (options.mixedFeelingsEnabled === true) {
    const next = recordMixedFeelingsV4(state.mixedFeelingsV4, state, now);
    if (next) state.mixedFeelingsV4 = next;
  }
}
export function projectAffectV4(state, options = {}, now = new Date()) {
  if (![options.coreAxesEnabled, options.moodEnabled, options.mixedFeelingsEnabled].some((v) => v === true)) return {};
  return { affectV4: { version: 1,
    ...(options.coreAxesEnabled === true ? { coreAxes: projectCoreAxesV4(state.coreAxesV4, now) } : {}),
    ...(options.moodEnabled === true ? { mood: projectMoodV4(state.moodV4, now) } : {}),
    ...(options.mixedFeelingsEnabled === true ? { mixed: projectMixedFeelingsV4(state.mixedFeelingsV4, state, now) } : {}),
  } };
}
// Generic state reads also protect the private dedupe ledger. Flags do not
// grant raw ledger access. No private-text setting participates in this gate.
export function redactAffectAudit(state, now = new Date()) {
  const safe = structuredClone(state);
  if (safe.coreAxesV4) safe.coreAxesV4 = projectCoreAxesV4(state.coreAxesV4, now);
  if (safe.moodV4) safe.moodV4 = projectMoodV4(state.moodV4, now);
  if (safe.mixedFeelingsV4) safe.mixedFeelingsV4 = projectMixedFeelingsV4(state.mixedFeelingsV4, state, now);
  return safe;
}

// Metadata-only maintenance on the existing writer. Never samples, decays
// values, changes budgets, starts an episode or invokes expression machinery.
export function pruneAffectAudit(state, options = {}, now = new Date()) {
  const ms = now.getTime(), hour = 3_600_000;
  const core = state.coreAxesV4;
  if (options.coreAxesEnabled === true && core?.version === 1 && ms >= Date.parse(core.lastProcessedAt)) {
    core.receipts = core.receipts.filter((r) => ms - Date.parse(r.at) < 48 * hour);
    core.seen = core.seen.filter((r) => ms - Date.parse(r.at) < 6 * hour);
  }
  const mood = state.moodV4;
  if (options.moodEnabled === true && mood?.version === 1 && ms >= Date.parse(mood.lastObservedAt)) {
    mood.buckets = mood.buckets.filter((b) => b.hour > ms - 72 * hour);
  }
  return state;
}
