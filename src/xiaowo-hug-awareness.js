import { awarenessId } from './self-signal.js';
import { DRIVE_KEYS } from './dimensions.js';

// One unacknowledged batch occupies the existing awareness slot. Each new
// arrival gets a new version so an ack for an older projection cannot eat it.
export function recordXiaowoHugAwareness(state, event, now = new Date()) {
  if (event.interactionType !== 'affection' || !event.eventId?.startsWith('xiaowo-hug-')) return state;
  const pending = state.pendingAwareness;
  const batch = pending?.xiaowoHug ?? { count: 0, petals: [], baseResidue: pending?.residue ?? '' };
  const petals = new Set(batch.petals);
  if (event.contextType === 'petal' && DRIVE_KEYS.includes(event.contextId)) petals.add(event.contextId);
  const count = batch.count + 1;
  const fact = count === 1 ? '芥子从小窝送来一个拥抱' : `芥子从小窝送来 ${count} 个拥抱`;
  const context = petals.size ? `（花瓣：${[...petals].join('、')}）` : '';
  state.pendingAwareness = {
    ...pending,
    id: awarenessId(event.eventId, now.toISOString()),
    createdAt: pending?.createdAt ?? now.toISOString(),
    dreamId: pending?.dreamId ?? null,
    residue: `${fact}${context}。${batch.baseResidue ? ` ${batch.baseResidue}` : ''}`,
    xiaowoHug: { count, petals: [...petals], baseResidue: batch.baseResidue },
  };
  return state;
}
