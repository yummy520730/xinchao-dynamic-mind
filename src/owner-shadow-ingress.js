import { timingSafeEqual } from 'node:crypto';
import { canonical, evidenceKeyValid, verifyEvidence } from './owner-evidence.js';
import { RelationshipShadowService } from './relationship-shadow-service.js';
import { shadowReceiptRef, validateShadowEvent, validateClosenessRevision } from './relationship-shadow.js';

export function createOwnerShadowIngress({ store, options, enabled, token, evidenceKey, serviceToken, affectOptions = {} }) {
  const ready = enabled === true && evidenceKeyValid(evidenceKey) && typeof token === 'string' && token.length >= 32 &&
    token !== serviceToken && token !== evidenceKey;
  const authorized = (supplied) => ready && typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  const service = new RelationshipShadowService({ store, options, affectOptions,
    authorize: (ctx) => authorized(ctx?.token),
    verify: async (data, ctx) => canonical(data) === canonical(ctx.envelope.data) &&
      await verifyEvidence(ctx.envelope, ctx.purpose, evidenceKey, ctx.now),
  });
  return async function handle(purpose, envelope, supplied, testClock) {
    const now = new Date(testClock ?? new Date());
    const reply = (status, reason) => ({ status, body: { confirmed: false, shadow_settled: false, reason } });
    if (!ready) return reply(503, 'ingress_disabled_or_unconfigured');
    if (!authorized(supplied)) return reply(401, 'unauthorized');
    if (!['event', 'closeness'].includes(purpose)) return reply(404, 'unknown_route');
    try {
      if (!await verifyEvidence(envelope, purpose, evidenceKey, now)) return reply(422, 'evidence_invalid_or_expired');
      if (purpose === 'event') {
        const event = validateShadowEvent(envelope.data, now);
        if (event.source !== 'owner_confirmation') return reply(422, 'source_not_permitted');
      } else validateClosenessRevision(envelope.data);
    } catch { return reply(422, 'invalid_event_or_revision'); }
    try {
      const context = { token: supplied, envelope, purpose, now };
      const result = purpose === 'event' ? await service.ingest(envelope.data, context, testClock)
        : await service.reviseCloseness(envelope.data, context, testClock);
      if (result.reason === 'evidence_invalid_or_expired') return reply(422, result.reason);
      const conflict = ['event_mismatch', 'relationship_conflict', 'invalid_state', 'event_time_invalid', 'unsupported_state', 'unsupported_receipt',
        'receipt_missing_or_expired', 'revision_window_expired', 'budget_day_closed', 'existing_load_requires_migration',
        'semantic_conflict', 'clock_regression', 'budget_policy_changed', 'revision_mismatch'].includes(result.reason);
      return { status: conflict ? 409 : 200, body: { confirmed: true, shadow_settled: result.applied,
        reason: result.reason, ...(result.affect ? { affect_settled: result.affect.applied, affect_reason: result.affect.reason } : {}), ...(result.reason === 'disabled' || conflict ? {} : { receipt_ref: purpose === 'event'
          ? shadowReceiptRef(envelope.data.event_id) : envelope.data.receipt_ref }) } };
    } catch { return reply(503, 'settlement_unavailable'); }
  };
}
