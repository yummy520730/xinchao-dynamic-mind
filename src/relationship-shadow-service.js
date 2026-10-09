import { reduceShadowEvent, validateShadowEvent, validateClosenessRevision, reduceClosenessRevision } from './relationship-shadow.js';

/** Internal-only integration seam; deliberately not registered in HTTP or MCP.
 * Reuse the SAME StateStore instance as the runtime. Both callbacks must come
 * from trusted server wiring, never from a client-supplied `verified` flag.
 */
export class RelationshipShadowService {
  constructor({ store, options = {}, authorize, verify }) {
    this.store = store;
    this.options = Object.freeze({ ...options });
    this.authorize = authorize;
    this.verify = verify;
  }

  async ingest(payload, context, now) {
    const receivedAt = new Date(now ?? new Date());
    if (typeof this.authorize !== 'function' || await this.authorize(context) !== true) {
      throw new Error('shadow event unauthorized');
    }
    const event = validateShadowEvent(payload, receivedAt);
    const favored = event.event_type.startsWith('favored_');
    if ((favored ? this.options.favoredEnabled : this.options.empathyEnabled) !== true) {
      return { applied: false, reason: 'disabled' };
    }
    if (typeof this.verify !== 'function' || await this.verify(structuredClone(event), context) !== true) {
      throw new Error('shadow event evidence unverified');
    }
    let result;
    await this.store.update((state) => {
      // Live requests settle on the serialized write clock, not an arrival
      // timestamp captured before asynchronous proof verification. Explicit
      // test clocks remain deterministic; genuine clock regression still rejects.
      result = reduceShadowEvent(state, event, now === undefined ? new Date() : receivedAt, this.options);
      return state;
    });
    return result;
  }

  async reviseCloseness(payload, context, now) {
    const receivedAt = new Date(now ?? new Date());
    if (typeof this.authorize !== 'function' || await this.authorize(context) !== true) throw Error('shadow event unauthorized');
    const revision = validateClosenessRevision(payload);
    if (typeof this.verify !== 'function' || await this.verify(structuredClone(revision), context) !== true) throw Error('shadow event evidence unverified');
    if (this.options.empathyEnabled !== true) return { applied: false, reason: 'disabled' };
    let result;
    await this.store.update((state) => {
      result = reduceClosenessRevision(state, revision, now === undefined ? new Date() : receivedAt, this.options);
      return state;
    });
    return result;
  }
}
