import { reduceVerifiedCoreAxesV4 } from './core-axes-v4.js';
import { reduceShadowEvent, validateShadowEvent, validateClosenessRevision, reduceClosenessRevision, shadowReceiptRef } from './relationship-shadow.js';

/** Internal-only integration seam; deliberately not registered in HTTP or MCP.
 * Reuse the SAME StateStore instance as the runtime. Both callbacks must come
 * from trusted server wiring, never from a client-supplied `verified` flag.
 */
export class RelationshipShadowService {
  constructor({ store, options = {}, affectOptions = {}, authorize, verify }) {
    this.store = store;
    this.options = Object.freeze({ ...options });
    this.affectOptions = Object.freeze({ ...affectOptions });
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
    const shadowEnabled = (favored ? this.options.favoredEnabled : this.options.empathyEnabled) === true;
    if (!shadowEnabled && this.affectOptions.coreAxesEnabled !== true) {
      return { applied: false, reason: 'disabled' };
    }
    if (typeof this.verify !== 'function' || await this.verify(structuredClone(event), context) !== true) {
      throw new Error('shadow event evidence unverified');
    }
    let result;
    await this.store.update(async (state) => {
      // Live requests settle on the serialized write clock, not an arrival
      // timestamp captured before asynchronous proof verification. Explicit
      // test clocks remain deterministic; genuine clock regression still rejects.
      const clock = now === undefined ? new Date() : receivedAt;
      // P2 also checks short proof expiry after waiting for the single writer.
      if (this.affectOptions.coreAxesEnabled === true &&
          await this.verify(structuredClone(event), { ...context, now: clock }) !== true) {
        result = { applied: false, reason: 'evidence_invalid_or_expired' }; return state;
      }
      // Compute independently from the signed fact, never Shadow delta/strength.
      const draft = structuredClone(state);
      let affect = reduceVerifiedCoreAxesV4(draft, event, clock, this.affectOptions);
      // An event settled before P2 activation cannot be backfilled by retry.
      // This also holds if P1 has since been disabled, or an alias changes only
      // the event ID within its semantic window. Do not rewrite P1 receipts.
      const age = (r) => clock.getTime() - Date.parse(r.at);
      const priorSettlement = ['favoredShadow','empathyShadow'].some((field) => state[field]?.receipts?.some((r) =>
        age(r) >= 0 && age(r) < 48 * 3_600_000 && (r.key === shadowReceiptRef(event.event_id) ||
          (age(r) < 6 * 3_600_000 && r.audit?.subject === shadowReceiptRef(event.subject_ref) &&
            r.audit?.incident === shadowReceiptRef(event.incident_ref) && r.audit?.type === event.event_type &&
            r.audit?.kind === (event.reason ?? event.empathy_type)))));
      const commitAffect = !priorSettlement || affect.reason === 'duplicate';
      if (['event_mismatch', 'clock_regression', 'invalid_state', 'unsupported_state', 'budget_policy_changed', 'event_time_invalid'].includes(affect.reason)) {
        result = { applied: false, reason: affect.reason }; return state;
      }
      if (!commitAffect) affect = { applied: false, reason: 'prior_settlement_no_backfill' };
      result = shadowEnabled ? reduceShadowEvent(state, event, clock, this.options) : { applied: false, reason: 'disabled' };
      if (['disabled','applied','no_change','unknown_closeness','no_matching_load','duplicate','daily_limit','load_or_daily_limit'].includes(result.reason)) {
        if (commitAffect && draft.coreAxesV4 && this.affectOptions.coreAxesEnabled === true) state.coreAxesV4 = draft.coreAxesV4;
        if (this.affectOptions.coreAxesEnabled === true) result.affect = affect;
      }
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
