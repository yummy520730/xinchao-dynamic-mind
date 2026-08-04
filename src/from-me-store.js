import { StateStore } from './state-store.js';
import { createWakeBridgeEnvelope, consumeWakeBridgeEnvelope } from './wake-bridge-protocol.js';

const ALLOWED_KINDS = new Set(['longing_content', 'action_result', 'pending_from_me']);

export class FromMeStore {
  constructor(path, options = {}) {
    this.maxEntries = Math.max(10, Number(options.maxEntries) || 100);
    this.ttlHours = Math.max(1, Number(options.ttlHours) || 168);
    this.store = new StateStore(path, () => ({ version: 1, items: [] }));
  }

  prune(state, now = new Date()) {
    const nowMs = now.getTime();
    state.items = (Array.isArray(state.items) ? state.items : [])
      .filter((item) => Date.parse(item.expiresAt ?? '') > nowMs)
      .slice(-this.maxEntries);
    return state;
  }

  async add(input = {}, now = new Date()) {
    const kind = String(input.kind ?? 'pending_from_me');
    if (!ALLOWED_KINDS.has(kind)) throw new Error('kind is not supported');
    const eventId = String(input.eventId ?? input.event_id ?? '').trim().slice(0, 120);
    const message = String(input.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (eventId.length < 8) throw new Error('event_id must contain at least 8 characters');
    if (!message) throw new Error('message is required');
    let result;
    await this.store.update((state) => {
      this.prune(state, now);
      const existing = state.items.find((item) => item.dedupeKey === eventId);
      if (existing) { result = { item: existing, duplicate: true }; return state; }
      const item = createWakeBridgeEnvelope({
        kind, audience: 'user', humanMessage: message, source: 'ai', dedupeKey: eventId,
        ttlHours: Math.max(1, Math.min(720, Number(input.ttlHours ?? input.ttl_hours ?? this.ttlHours))), now,
      });
      state.items.push(item);
      this.prune(state, now);
      result = { item, duplicate: false };
      return state;
    });
    return result;
  }

  async list(options = {}, now = new Date()) {
    let items = [];
    await this.store.update((state) => {
      this.prune(state, now);
      items = state.items.filter((item) => options.includeConsumed || item.status !== 'consumed');
      return state;
    });
    return items.slice(-Math.max(1, Math.min(100, Number(options.limit) || 30))).reverse();
  }

  async consume(id, now = new Date()) {
    let consumed = null;
    await this.store.update((state) => {
      this.prune(state, now);
      const index = state.items.findIndex((item) => item.id === id);
      if (index >= 0) { state.items[index] = consumeWakeBridgeEnvelope(state.items[index], now); consumed = state.items[index]; }
      return state;
    });
    return consumed;
  }
}
