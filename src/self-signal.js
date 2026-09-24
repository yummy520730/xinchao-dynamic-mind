import { createHash } from 'node:crypto';
import { DIMENSIONS, DRIVE_KEYS, SATURATE_CEIL } from './dimensions.js';

const DRIVE_SIGNAL_TYPES = new Set([
  'conversation_event',
  'state_signal',
  'memory_resonance',
  'action_satisfied',
]);

function iso(now) {
  return new Date(now).toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function ceilingFor(key) {
  return Number(DIMENSIONS[key]?.ceiling ?? SATURATE_CEIL);
}

function digest(value, length = 24) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, length);
}

export function awarenessId(dreamId, createdAt) {
  return `awareness-${digest(`${String(dreamId ?? 'wake')}\n${String(createdAt ?? '')}`, 28)}`;
}

export function selfSignalEventId(kind, key) {
  return `self:${String(kind || 'signal').slice(0, 24)}:${digest(key, 32)}`;
}

export function selfSignalDeliveryId(eventId) {
  return `delivery-self-${digest(eventId, 32)}`;
}

export function ensureSelfSignalState(input) {
  input.selfSignalState ??= {};
  input.selfSignalState.driveArmed ??= {};
  input.selfSignalState.lastQueuedAt ??= {};
  input.selfSignalState.recent = Array.isArray(input.selfSignalState.recent)
    ? input.selfSignalState.recent.slice(-40)
    : [];
  for (const key of DRIVE_KEYS) {
    if (typeof input.selfSignalState.driveArmed[key] !== 'boolean') {
      input.selfSignalState.driveArmed[key] = true;
    }
  }
  input.awarenessHistory = Array.isArray(input.awarenessHistory)
    ? input.awarenessHistory.slice(-30)
    : [];
  return input;
}

function driveCandidate(before, after, meta, options) {
  if (!DRIVE_SIGNAL_TYPES.has(String(meta?.type ?? ''))) return null;
  const thresholdRatio = clamp(options.thresholdRatio ?? 0.72, 0.4, 0.95);
  const rearmRatio = clamp(options.rearmRatio ?? 0.52, 0.2, thresholdRatio - 0.05);
  const minDelta = clamp(options.minDelta ?? 0.025, 0.005, 0.2);

  let best = null;
  for (const key of DRIVE_KEYS) {
    const ceiling = ceilingFor(key);
    const beforeValue = Number(before?.drives?.[key] ?? 0);
    const afterValue = Number(after?.drives?.[key] ?? 0);
    const threshold = ceiling * thresholdRatio;
    const rearm = ceiling * rearmRatio;

    if (afterValue <= rearm) after.selfSignalState.driveArmed[key] = true;
    const armed = after.selfSignalState.driveArmed[key] !== false;
    const delta = afterValue - beforeValue;
    const crossed = beforeValue < threshold && afterValue >= threshold;
    if (!armed || afterValue < threshold || (!crossed && delta < minDelta)) continue;

    const normalized = ceiling > 0 ? afterValue / ceiling : afterValue;
    const score = normalized * 10 + Math.max(0, delta);
    if (!best || score > best.score) {
      best = {
        score,
        key,
        value: Number(afterValue.toFixed(4)),
        ceiling: Number(ceiling.toFixed(4)),
        delta: Number(delta.toFixed(4)),
        threshold: Number(threshold.toFixed(4)),
      };
    }
  }
  return best;
}

export function evaluateSelfSignal(beforeInput, afterInput, meta = {}, now = new Date(), options = {}) {
  const after = ensureSelfSignalState(afterInput);
  const before = ensureSelfSignalState(structuredClone(beforeInput ?? {}));
  if (options.enabled === false) return { state: after, signal: null };

  const pending = after.pendingAwareness;
  const previousPendingId = String(before.pendingAwareness?.id ?? '');
  if (pending?.id && String(pending.id) !== previousPendingId) {
    const eventId = selfSignalEventId('awareness', pending.id);
    return {
      state: after,
      signal: {
        eventId,
        deliveryId: selfSignalDeliveryId(eventId),
        coalesceKey: `awareness:${pending.id}`,
        kind: 'pending_awareness',
        driveKey: null,
        message: '心潮有一条刚醒来的内部觉察需要被当前会话或下一次自主心跳看见。',
        aiContext: {
          awareness_id: pending.id,
          dream_id: pending.dreamId ?? null,
          residue: String(pending.residue ?? '').slice(0, 280) || null,
          created_at: pending.createdAt ?? iso(now),
          evidence_type: 'wake_awareness',
        },
      },
    };
  }

  if (String(meta?.type ?? '') === 'night_dream_recorded') {
    const dream = Array.isArray(after.recentDreams) ? after.recentDreams.at(-1) : null;
    const priorDream = Array.isArray(before.recentDreams) ? before.recentDreams.at(-1) : null;
    if (dream?.id && dream.id !== priorDream?.id) {
      const eventId = selfSignalEventId('dream', dream.id);
      return {
        state: after,
        signal: {
          eventId,
          deliveryId: selfSignalDeliveryId(eventId),
          coalesceKey: `dream:${dream.id}`,
          kind: 'dream_residue',
          driveKey: null,
          message: '夜梦留下了新的余韵，心潮希望下一次自主心跳能看见它。',
          aiContext: {
            dream_id: dream.id,
            residue: String(dream.residue ?? dream.awareness ?? '').slice(0, 280) || null,
            created_at: dream.createdAt ?? iso(now),
            evidence_type: 'night_dream',
          },
        },
      };
    }
  }

  const candidate = driveCandidate(before, after, meta, options);
  if (!candidate) return { state: after, signal: null };
  const sourceEvent = String(meta?.eventId ?? `${meta?.type ?? 'event'}:${after.revision ?? 0}`);
  const eventId = selfSignalEventId('drive', `${sourceEvent}:${candidate.key}`);
  return {
    state: after,
    signal: {
      eventId,
      deliveryId: selfSignalDeliveryId(eventId),
      coalesceKey: `drive:${candidate.key}`,
      kind: 'drive_transition',
      driveKey: candidate.key,
      message: `心潮的 ${candidate.key} 驱动刚刚跨过了可行动阈值。`,
      aiContext: {
        drive: candidate.key,
        value: candidate.value,
        ceiling: candidate.ceiling,
        delta: candidate.delta,
        threshold: candidate.threshold,
        evidence_type: String(meta?.type ?? 'event').slice(0, 80),
      },
    },
  };
}

export function markSelfSignalQueued(input, signal, now = new Date()) {
  const state = ensureSelfSignalState(structuredClone(input));
  if (signal?.driveKey && DRIVE_KEYS.includes(signal.driveKey)) {
    state.selfSignalState.driveArmed[signal.driveKey] = false;
    state.selfSignalState.lastQueuedAt[signal.driveKey] = iso(now);
  }
  state.selfSignalState.recent.push({
    eventId: String(signal?.eventId ?? '').slice(0, 120),
    kind: String(signal?.kind ?? '').slice(0, 40),
    drive: signal?.driveKey ?? null,
    queuedAt: iso(now),
  });
  state.selfSignalState.recent = state.selfSignalState.recent.slice(-40);
  return state;
}

export function consumePendingAwareness(input, id, now = new Date(), via = 'runtime') {
  const state = ensureSelfSignalState(structuredClone(input));
  const pending = state.pendingAwareness;
  if (!pending?.id || String(pending.id) !== String(id ?? '')) {
    return { state, consumed: false };
  }
  state.awarenessHistory.push({
    id: pending.id,
    dreamId: pending.dreamId ?? null,
    createdAt: pending.createdAt ?? null,
    consumedAt: iso(now),
    via: String(via || 'runtime').slice(0, 40),
  });
  state.awarenessHistory = state.awarenessHistory.slice(-30);
  state.pendingAwareness = null;
  state.revision = Number(state.revision || 0) + 1;
  return { state, consumed: true };
}
