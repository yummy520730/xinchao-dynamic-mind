# P1.5 — trusted Owner reports and explicit closeness amendments

## Audit baseline and scope

- Construction started at `main b8659c2e1b26fec79b16de37393f3476a95c0808` (P0 #12 + P1 #13). Main was unchanged at the delivery audit.
- Paired Xiaowo construction baseline: `a1dc9dbe86bf74114fe21c5acbd82e9da19f9845`. During construction #56 advanced its main to `a5ee88d9da65bec4047fcbe715abdb9b4e1fac18`. Compared the complete delta: only lexicon acceptance documentation and its isolated harness were added, no runtime/auth/UI source changed. The paired branch is based on that newer main tree.
- Paired branch: [xiaowo-app/feat/p15-owner-confirmations](https://github.com/yummy520730/xiaowo-app/tree/feat/p15-owner-confirmations). See the two Draft PR descriptions for reciprocal PR links.
- No merge, deployment, VPS, database, production environment, LMC, Android, heartbeat, Murmur Writer or Life Writer changes. No automatic Shadow activation.

## Boundary audit

| Existing boundary | Finding | Decision |
|---|---|---|
| `RelationshipShadowService.authorize/verify` | Internal callbacks; there was no registered HTTP/MCP ingress | Wire both from trusted server code; default refusal |
| `StateStore.update` | One runtime instance; process-local serialized queue; atomic file replacement and fsync | Reuse this exact instance, never create a competing runtime writer |
| Xiaowo Owner Unlock | Frontend stores a password in current-tab sessionStorage; it does not prove identity | Worker must independently compare bearer with configured `API_TOKEN` |
| Owner Worker auth | Missing/wrong API_TOKEN rejects before proof creation/upstream access | Reuse this credential boundary with isolation checks |
| Existing mind proxy | Worker substitutes server `XINCHAO_SERVICE_TOKEN`; generic service auth also serves other routes | Use a separate narrow ingress credential and signed proof; existing credentials cannot submit Shadow events |
| Hug | Client creates `xiaowo-hug-UUID`, Worker proxies it; runtime produces interaction/awareness/bridge receipts | Prefix and legacy receipt are insufficient for content-bound P1 evidence; **NOT CONNECTED** |
| Identifier/evidence reuse | Legacy event/context IDs are client-controlled; no P1 subject/incident proof | Worker generates domain-separated opaque HMAC identifiers; Xinchao records immutable content binding |
| Retry/failure | Old proxy forwards responses; no durable P1 receipt contract | Browser freezes the original request, Worker times out at 8s, receipt/revision is persisted atomically in Xinchao |

Production credential custody was deliberately not inspected. Before enabling ingress, verify that `API_TOKEN` is an Owner-only credential and is not supplied to CC/model tools, Android device automation or other callers. Bearer auth proves possession of that credential, **not that a human clicked a button**. If this custody condition is false, activation is BLOCKED until a separately approved Owner step-up credential is introduced. Code rejects equality with exposed non-Owner credentials; it cannot detect undisclosed sharing of a bearer. This is an activation prerequisite, not permission to modify production.

## Real implemented chain

1. Owner deliberately selects an enumerated report in Xiaowo `/heart`, associates an anonymous object and incident, and checks confirmation. No text classifier or background submission exists.
2. Worker authenticates Owner, validates an exact bounded request, fixes the source and schema, normalizes the timestamp, maps the selection to the P1 contract, and generates opaque event/subject/incident/evidence/relationship references.
3. Worker signs a five-minute envelope using HMAC-SHA256: exact version, issuer `xiaowo-owner`, audience `xinchao-shadow`, purpose, `owner_bearer_report`, issuance, expiry and the entire event/revision payload. JSON keys are canonically sorted. Changing type, object, incident, closeness, timestamp, evidence or envelope metadata breaks verification.
4. Worker sends only to `POST /v1/owner-shadow/events` or `/closeness` with a separate server-only ingress bearer. Redirects are not followed. Owner password, client IDs and proof never enter the public response.
5. Xinchao independently checks channel auth, signature/TTL, source and strict P1 validation, then calls the existing service and reducer inside the unique StateStore queue.
6. `schemaVersion=1` Dashboard exposes only whitelisted aggregates/status. A sanitized receipt reference is returned only on the Owner route. Raw event/subject IDs, signatures and keys are never returned there.

Source connected in executable code and the real local HTTP/workerd test: **explicit Owner report**. Automatic hug, ordinary chat, silence, other AI/app usage, hypothetical, joke, roleplay, model self-assessment: **no adapters**. Test facts are synthetic; no real production relationship event was submitted.

A report of reconciliation confirms the Owner's report of that event. It does not prove the model was angry, jealous or consciously experienced any previous emotion. P1 still produces only independent Shadow candidates; it never mutates drives, P0 emotion, memory, presence/ACK, dreams or notifications.

## Identity, settlement and failure contract

- Same browser `request_id` always maps to the same event ID. Retrying retains the original occurrence time/context. New proof issuance cannot refresh an effective event.
- Immutable receipt binding covers event type, object, incident, occurrence time, reason/kind, closeness and relationship reference. Reusing an event ID with different content, including across favored/empathy domains, returns `event_mismatch`.
- Existing 6h semantic dedupe, inclusive 24h input window, exclusive 48h receipt retention, daily effect count, per-tier daily amount, aggregate/stranger/load ceilings remain in force. Duplicates do not change original receipt time, effective time or budgets.
- Runtime settlement time is acquired **inside** the serialized StateStore mutator, after async verification. This avoids treating reordered concurrent verification as clock rollback. Explicit test clocks and genuine regression still reject.
- `shadow_settled=true` means this request produced a new Shadow effect. Duplicates report their explicit reason with `false`; disabled reports confirm verified evidence with `false` and do not write a receipt/state.
- HTTP 401: wrong ingress identity. HTTP 422: invalid, expired or tampered evidence/input. HTTP 409: receipt/state/identity/amendment conflict. HTTP 503: disabled/unconfigured ingress or unavailable storage/settlement. Errors never reflect raw exception messages or supplied content.
- A network failure may occur after a commit. Xiaowo reports uncertain settlement and retries the **same** frozen request. It never reports success without the result. A receipt that survived a restart keeps its idempotency.
- StateStore's serialization is process-local. Running multiple Xinchao processes against one state file is unsupported and is an activation blocker; no distributed-lock claim is made.

## Explicit unknown amendment

Only a specific existing `empathy` receipt created by this version with outcome `unknown_closeness` is eligible. It stores a versioned, private zero-load amendment record. Semantic aliases, legacy unversioned receipts, favored events, `helped` events and already classified events are not eligible.

- Owner submits a new signed proof referencing the original receipt and exactly one of `her/family/known/stranger`. The original identity, audit, timestamp and receipt are never replaced.
- Window: original occurrence age must be **≤24h** and original receipt age **<48h**.
- Budget: initial unknown adds zero load and uses no effect/amount budget. Its one amendment may consume one effect and the existing per-tier amount/caps, **only in the original processing business day**, with the original timezone unchanged. No historical counter is rebuilt and no next-day quota can be borrowed.
- A new amendment crossing midnight returns `budget_day_closed`. A successful amendment retried after midnight returns `duplicate_revision` without consuming either day's budget. Midnight, TTL, policy-change and clipping cases are tested.
- The first admissible amendment attempt consumes its single slot even if limits clip it to zero. It cannot later retry into decayed capacity or a reset quota. Contradictory tier/proof returns `relationship_conflict`; a revision ID repointed to another receipt returns `revision_mismatch`.
- A later semantic record in the dedupe window rejects with `semantic_conflict`. Existing nonzero load for the exact object/incident/kind rejects with `existing_load_requires_migration`; nothing is overwritten or relieved.
- Arithmetic is reused from the existing empathy settlement helper. This is an explicit new amendment transaction, **not replaying the original event**, and never calls P0 or the conversation/hug pipeline.

Changing an existing nonzero load, moving it between tiers/objects, amending historical-day budgets or retroactively applying completed-help relief needs a separate migration contract (versioned source/target receipts, amount attribution, caps and recovery). None is implemented here.

## Privacy and retention

- Private receipts contain hashes, enumerations, outcome, occurrence/processing times and source/verified-authorization metadata; never chat text, names, device identity, raw signatures or secrets.
- Detailed audit exists only in the private StateStore file (0600), not a new diagnostics API. Generic service `/v1/state` now substitutes the same safe P1 summaries used by Dashboard; its legacy/P0 fields are unchanged. Dashboard private-text settings cannot expose P1 evidence.
- Receipt/amendment/audit authority expires at exactly 48h; semantic receipt authority expires at 6h. Optional ingress maintenance physically removes expired records within one minute while running and on its next startup after downtime. With ingress disabled or the process stopped, private on-disk cleanup waits until the next enabled startup; expired records remain unusable. Backups need their own Owner-approved retention policy.

## Verification

| Check | Node 20.20.2 | Node 22.23.3 |
|---|---:|---:|
| Xinchao full unit/runtime suite | 210 PASS | 210 PASS |
| Paired Worker unit/proxy suites | 133 PASS | 133 PASS |
| Real workerd → HTTPS → actual Xinchao HTTP → StateStore/Dashboard | 1 PASS | 1 PASS |
| Paired Web tests | 266 PASS | 266 PASS |
| Paired Web typecheck/build | PASS | PASS |

Real HTTP test includes bad Owner auth, dedicated channel isolation, content tampering, 8 concurrent original deliveries, 8 concurrent amendments, content mismatch, generic-state redaction, unchanged Shadow after a legacy hug, Dashboard privacy and actual process restart. Miniflare is pinned to `4.20260730.0`; its workerd runs the real Worker modules. A generated local TLS certificate is explicitly trusted by the test-only loopback network, without disabling certificate verification. No request/reducer/auth/receipt is mocked in this test. Unit transport mocks are separately named in the unit test file.

Additional checks: JS syntax, `git diff --check`, new-runtime credential-literal scan PASS; changed Web ESLint: 0 errors, one pre-existing `heart.tsx` hook warning. A temporary, noncommitted audit lock for Xiaowo's existing manifest reported **0 vulnerabilities**; no application dependency was added. Xinchao has no package dependencies or build script; JS syntax checking is its build-level check.

Browser E2E: **NOT_RUN**. Playwright library was present, but its Chromium executable was absent and the browser download failed with a truncated/non-zip archive. No browser result is inferred from HTTP or unit tests. Production TLS/Cloudflare deployment, true Owner credential custody and actual production submission: **NOT_RUN / NOT_INSPECTED** by authorization scope.

Reproduce Xinchao: `npm test` on Node 20 and 22. Reproduce the real paired HTTP test from Xiaowo root after checking out both paired branches:

```sh
npm install --prefix /tmp/p15-miniflare miniflare@4.20260730.0
P15_MINIFLARE_MODULE=/tmp/p15-miniflare/node_modules/miniflare/dist/src/index.js \
XINCHAO_TEST_ROOT=/absolute/path/to/xinchao-dynamic-mind \
node --test worker/cloudflare/owner-confirmations.http.test.mjs
```

Requires openssl and Node 20/22. The harness uses a newly created temporary state directory, generated TLS certificate, synthetic credentials, retained child handles and cleanup of its own spawned processes only. Without optional Miniflare, ordinary Worker CI prints an explicit NOT_RUN skip for this integration test.

## Activation review — no production configuration performed

Keep `FAVORED_SHADOW_ENABLED=false` and `EMPATHY_SHADOW_ENABLED=false` until separately reviewed. Both still default OFF. Ingress itself also defaults OFF.

Before any later activation: verify exclusive Owner credential custody and one runtime writer; review the paired code/branches; generate an independent 32-byte hex `SHADOW_OWNER_EVIDENCE_KEY` and independent ≥32-character `SHADOW_OWNER_INGRESS_TOKEN`, held only by Worker and Xinchao servers. Review `SHADOW_OWNER_INGRESS_ENABLED` / Worker `SHADOW_CONFIRMATIONS_ENABLED`, HTTPS endpoint, timezone and budget configuration. Neither secret belongs in Web/Android/build variables, Git, logs or model prompts. Credential equality checks fail closed.

HMAC keys also scope opaque identifiers. Rotation is not transparent: do not rotate with live retry/amendment receipts. A separate drain/cutover review must preserve or expire the complete 24h input + 48h receipt window, stop old pending UI retries and avoid double attribution. No rotation endpoint or migration is supplied.

Manual browser acceptance is documented in the paired Xiaowo report. These Draft PRs await Owner review; they do not authorize activation.
