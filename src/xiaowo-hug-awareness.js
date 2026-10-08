import { awarenessId } from './self-signal.js';
import { DRIVE_KEYS } from './dimensions.js';

export function hugAwarenessResidue(batch) {
  const fact = batch.count === 1 ? '芥子从小窝送来一个拥抱' : `芥子从小窝送来 ${batch.count} 个拥抱`;
  const context = batch.petals.length ? `（花瓣：${batch.petals.join('、')}）` : '';
  return `${fact}${context}。${batch.baseResidue ? ` ${batch.baseResidue}` : ''}`;
}

// One unacknowledged batch occupies the existing awareness slot. Each new
// arrival gets a new version so an ack for an older projection cannot eat it.
export function recordXiaowoHugAwareness(state, event, now = new Date()) {
  if (event.interactionType !== 'affection' || !event.eventId?.startsWith('xiaowo-hug-')) return state;
  const pending = state.pendingAwareness;
  const batch = pending?.xiaowoHug ?? { count: 0, petals: [], baseResidue: pending?.residue ?? '' };
  const petals = new Set(batch.petals);
  if (event.contextType === 'petal' && DRIVE_KEYS.includes(event.contextId)) petals.add(event.contextId);
  const count = batch.count + 1;
  const nextBatch = { count, petals: [...petals], baseResidue: batch.baseResidue };
  state.pendingAwareness = {
    ...pending,
    id: awarenessId(event.eventId, now.toISOString()),
    createdAt: pending?.createdAt ?? now.toISOString(),
    dreamId: pending?.dreamId ?? null,
    residue: hugAwarenessResidue(nextBatch),
    xiaowoHug: nextBatch,
  };
  return state;
}
