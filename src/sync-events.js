import { createHash, randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._:+=/-]{1,128}$/;
const JOURNAL_TYPES = ['sync_event_pending', 'sync_event_ack'];

function hash(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function canonicalXinchaoIdentity(eventId) {
  const raw = String(eventId ?? '').trim();
  if (!raw) throw new Error('stable xinchao event id is required');
  const sourceEventId = SAFE_ID.test(raw) ? raw : `sha256-${hash(raw)}`;
  const direct = `xinchao:${sourceEventId}`;
  return {
    sourceEventId,
    idempotencyKey: direct.length <= 128 ? direct : `xinchao:sha256-${hash(raw)}`,
  };
}

function optional(value, max = 160) {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, max) : '';
}

function causalHint(event = {}) {
  const hint = {};
  for (const [output, inputs] of Object.entries({
    session_id: ['sessionId', 'session_id'],
    turn_id: ['turnId', 'turn_id'],
    trigger_event_id: ['triggerEventId', 'trigger_event_id'],
    causal_parent_id: ['causalParentId', 'causal_parent_id'],
    interaction_id: ['interactionId', 'interaction_id'],
  })) {
    const value = optional(event[inputs[0]] ?? event[inputs[1]], 160);
    if (value) hint[output] = value;
  }
  return hint;
}

function occurredAt(value, now) {
  const raw = optional(value, 64);
  if (!raw) return now.toISOString();
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw) || !Number.isFinite(Date.parse(raw))) {
    throw new Error('occurred_at must be an ISO timestamp with timezone');
  }
  return new Date(raw).toISOString();
}

export function buildXinchaoSourceEvent(event = {}, kind, now = new Date()) {
  const eventId = event.eventId ?? event.event_id;
  const identity = canonicalXinchaoIdentity(eventId);
  const occurred = occurredAt(event.occurredAt ?? event.occurred_at, now);
  const interactionType = optional(event.interactionType ?? event.interaction_type, 64);
  const payload = { event_kind: kind };
  if (interactionType) payload.interaction_type = interactionType;
  return {
    source: 'xinchao',
    source_event_id: identity.sourceEventId,
    type: kind === 'interaction' ? 'mind.interaction' : 'mind.presence',
    occurred_at: occurred,
    idempotency_key: identity.idempotencyKey,
    correlation_hint: causalHint(event),
    payload,
  };
}

function safeLog(log, event, fields = {}) {
  log(event, fields);
}

export class XinchaoSyncEvents {
  constructor({ config, journal, fetchImpl = fetch, log = () => {} }) {
    this.config = config;
    this.journal = journal;
    this.fetchImpl = fetchImpl;
    this.log = log;
  }

  async recordConversation(event, kind, now = new Date()) {
    if (!this.config?.enabled) return { ok: false, disabled: true };
    try {
      const candidate = buildXinchaoSourceEvent(event, kind, now);
      const staged = await this.stage(candidate);
      if (staged.acknowledged) return { ok: true, duplicate: true };
      return await this.deliver(staged.event);
    } catch (error) {
      safeLog(this.log, 'xinchao_sync_event_failed', {
        source_event_id: this.safeSourceId(event?.eventId ?? event?.event_id),
        error_name: error?.name || 'Error',
        error_code: optional(error?.code || 'adapter_error', 80),
      });
      return { ok: false };
    }
  }

  async stage(event) {
    const records = await this.records();
    const acknowledged = records.some((record) => (
      record.type === 'sync_event_ack' && record.sourceEventId === event.source_event_id
    ));
    if (acknowledged) return { acknowledged: true, event };
    const existing = records.find((record) => (
      record.type === 'sync_event_pending' && record.syncEvent?.source_event_id === event.source_event_id
    ));
    if (existing?.syncEvent) return { acknowledged: false, event: existing.syncEvent };
    await this.journal.append({
      id: randomUUID(),
      at: new Date().toISOString(),
      type: 'sync_event_pending',
      source: 'xinchao',
      sourceEventId: event.source_event_id,
      syncEvent: event,
    });
    return { acknowledged: false, event };
  }

  async deliver(event) {
    if (!this.config?.enabled) {
      safeLog(this.log, 'xinchao_sync_event_failed', {
        source_event_id: event.source_event_id,
        error_code: 'adapter_disabled',
      });
      return { ok: false };
    }
    try {
      const response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (response.status !== 200 && response.status !== 201) {
        safeLog(this.log, 'xinchao_sync_event_failed', {
          source_event_id: event.source_event_id,
          status: response.status,
        });
        return { ok: false, status: response.status };
      }
      await this.journal.append({
        id: randomUUID(),
        at: new Date().toISOString(),
        type: 'sync_event_ack',
        source: 'xinchao',
        sourceEventId: event.source_event_id,
      });
      return { ok: true, duplicate: response.status === 200 };
    } catch (error) {
      safeLog(this.log, 'xinchao_sync_event_failed', {
        source_event_id: event.source_event_id,
        error_name: error?.name || 'Error',
        error_code: optional(error?.code || 'delivery_error', 80),
      });
      return { ok: false };
    }
  }

  async replayPending() {
    if (!this.config?.enabled) return [];
    const records = await this.records();
    const acknowledged = new Set(records
      .filter((record) => record.type === 'sync_event_ack')
      .map((record) => record.sourceEventId));
    const pending = new Map();
    for (const record of records.slice().reverse()) {
      const event = record.type === 'sync_event_pending' ? record.syncEvent : null;
      if (event?.source_event_id && !pending.has(event.source_event_id)) {
        pending.set(event.source_event_id, event);
      }
    }
    const results = [];
    for (const [sourceEventId, event] of pending) {
      if (!acknowledged.has(sourceEventId)) results.push(await this.deliver(event));
    }
    return results;
  }

  records() {
    return this.journal.list({ limit: 200, types: JOURNAL_TYPES, maxBytes: 2 * 1024 * 1024 });
  }

  safeSourceId(value) {
    try { return canonicalXinchaoIdentity(value).sourceEventId; }
    catch { return 'unknown'; }
  }
}
