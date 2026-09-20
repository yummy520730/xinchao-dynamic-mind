const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;

function compactId(value) {
  return String(value ?? '').trim().slice(0, 120);
}

function sourceDate(value) {
  const match = String(value ?? '').trim().match(DATE_RE);
  return match ? match[1] : '';
}

export function findRecentDream(state, dreamId) {
  const id = compactId(dreamId);
  if (!id) return null;
  const dreams = Array.isArray(state?.recentDreams) ? state.recentDreams : [];
  return dreams.find((dream) => compactId(dream?.id) === id) ?? null;
}

export function dreamHasHistoricalProvenance(dream) {
  if (!dream || String(dream.kind ?? '').trim() !== 'night') return false;
  if (!sourceDate(dream.source_date)) return false;
  return Array.isArray(dream.source_event_ids) && dream.source_event_ids.length > 0;
}

function mapMessage(item) {
  return {
    role: String(item?.role ?? ''),
    content: String(item?.content ?? ''),
    createdAt: item?.created_at ?? item?.createdAt ?? null,
  };
}

export function mapDreamSourceResponse(lmc, dream) {
  const status = lmc?.status === 'partial' || lmc?.status === 'empty' ? lmc.status : 'ok';
  const messages = Array.isArray(lmc?.messages) ? lmc.messages.map(mapMessage) : [];
  const sourceEventCount = Array.isArray(dream?.source_event_ids) ? dream.source_event_ids.length : 0;
  const returnedEventCount = Number(lmc?.returned_count);
  const missingEventCount = Number(lmc?.missing_count);
  return {
    schemaVersion: 1,
    dreamId: compactId(dream?.id),
    status,
    sourceDate: sourceDate(dream?.source_date) || sourceDate(lmc?.source_date) || null,
    startAt: lmc?.start_at ?? dream?.source_start_at ?? null,
    endAt: lmc?.end_at ?? dream?.source_end_at ?? null,
    sourceEventCount,
    returnedEventCount: Number.isFinite(returnedEventCount) ? returnedEventCount : messages.length,
    missingEventCount: Number.isFinite(missingEventCount) ? missingEventCount : 0,
    messages,
  };
}

export function historicalSourceUnavailable(error) {
  const message = String(error?.message ?? '');
  if (/HTTP 409|HTTP 400/.test(message)) return { status: 409, error: 'dream source unavailable' };
  return { status: 503, error: 'historical source unavailable' };
}
