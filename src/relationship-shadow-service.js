import { reduceShadowEvent, validateShadowEvent } from './relationship-shadow.js';

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

  async ingest(payload, context, now = new Date()) {
    const receivedAt = new Date(now);
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
      result = reduceShadowEvent(state, event, receivedAt, this.options);
      return state;
    });
    return result;
  }
}
