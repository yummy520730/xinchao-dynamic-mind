# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Xinchao (心潮) is a self-hosted dynamic state engine for AI companions. It maintains twelve drive dimensions, a thought pool, fatigue/sleep cycles, dream residue, and short-term session state independently of any language model. Clients connect via HTTP API or remote Streamable HTTP MCP (with optional OAuth 2.1). Models, long-term memory, and notifications are optional adapters that never replace the core state machine.

## Commands

```bash
npm test          # Run all tests (Node.js built-in test runner, no dependencies)
npm start         # Start the server (requires .env with a valid SERVICE_TOKEN)

# Run a single test file
node --test test/engine.test.js

# Docker
docker compose up -d --build
```

CI runs `npm test` on Node 20 and 22 (`.github/workflows/test.yml`).

## Architecture

The project is a zero-dependency Node.js 20+ ES module application. There is no build step, no bundler, no TypeScript — source files run directly.

### Core State Machine (no external I/O)

- **`engine.js`** — Pure-function state settlement: drive growth over time, sleep/wake transitions, fatigue, bounded interaction effects, state signals, dream eligibility, intent selection. All drive math lives here. `settleState()` is the central tick; `settleAndApplyConversationEvent()` and `settleAndApplyStateSignal()` combine a settle with an event.
- **`dimensions.js`** — The twelve drive definitions (growth rates, ceilings, sleep decay, inhibition, night multipliers). This is the single source of truth for drive parameters.
- **`thought-pool.js`** — Flash thoughts decay over time; repeated themes promote to obsessions. Pure functions, no side effects.

### Server & Protocol Layer

- **`server.js`** — HTTP server wiring all routes, the settle timer, and the bridge poll timer. Owns `updateState()` which wraps `StateStore` writes with transition journal recording. No framework — raw `node:http`.
- **`mcp-protocol.js`** — Translates MCP JSON-RPC into tool calls (`xinchao_context`, `xinchao_event`, `xinchao_state_signal`, `xinchao_handoff_note`, `xinchao_from_me`). Handles `initialize`, `tools/list`, `tools/call`.
- **`oauth-provider.js`** — OAuth 2.1 with PKCE and dynamic client registration for remote MCP clients.

### Adapters (all optional, all off by default)

- **`model-client.js`** — OpenAI-compatible chat completions for dreams and notifications. Falls back to rule-based generation when disabled.
- **`ombre-client.js`** — Ombre/LMC-5 compatible Streamable HTTP Memory MCP for long-term memory reads/writes.
- **`bark-client.js`** / **`ntfy-client.js`** — Push notifications (Bark for iOS, ntfy for Android).
- **`bark-dedupe.js`** — Cosine-similarity deduplication for notification messages.
- **`bridge-queue.js`** — Durable delivery queue for user-initiated interactions, notes, and scheduled items. SSE stream for machine consumers.
- **`from-me-store.js`** — AI outbox for proactive messages (petal, dream_response, etc.).

### State & Persistence

- **`state-store.js`** — Atomic JSON persistence via temp-file + rename. `read()` / `update(mutate)`.
- **`transition-journal.js`** — Append-only JSONL audit log of state transitions (no chat text).
- **`context-envelope.js`** — Builds the short-lived Context Envelope (drives, session overlays, handoff notes, dream residue) within a token budget. Does not carry stable identity/core instructions.
- **`handoff-notes.js`** — Bounded, TTL-limited session continuity notes (max 1200 chars, default 72h expiry).
- **`dashboard-projection.js`** — Read-only sanitized projections for the visual dashboard. Private text hidden by default.
- **`dashboard-auth.js`** — Independent access-token auth for the browser dashboard (HttpOnly cookies, never exposes SERVICE_TOKEN).
- **`heartbeat-store.js`** — Reads external heartbeat files to update presence time.

### Sub-packages

- **`packages/wake-bridge/`** — Standalone `@xinchao/wake-bridge-protocol` defining privacy-bounded delivery envelopes.

## Key Design Constraints

- **Clients cannot submit drive numbers.** Interactions are semantic types (`affection`, `companionship`, `intimacy`, etc.) with server-fixed bounded effects. `event_id` ensures idempotent processing.
- **State signals are ignition inputs, not completed interactions.** Only `intimacy_cue` with `origin=user` is accepted; drive mapping is fixed in the engine.
- **Context Envelope only carries short-lived state.** Stable identity and core instructions are the client's responsibility.
- **All adapters default to off.** The core state machine runs offline with no network, no model, no memory service.
- **Shadow mode** (`SHADOW_MODE=true`, the default) uses rule-based fallback generation instead of calling a real model.
- **Transition journal never stores chat text** — only structured deltas, digests, and delivery metadata.

## Testing Patterns

Tests use `node:test` and `node:assert` with no test framework. Each `test/*.test.js` file imports the module under test directly. Engine tests create state via `newState()`, mutate with pure functions, and assert on the result — no HTTP, no mocking.

To test a specific area:
```bash
node --test test/engine.test.js
node --test test/mcp-protocol.test.js
node --test test/context-envelope.test.js
```

When changing engine functions, update `test/engine.test.js`. When changing MCP tools, update `test/mcp-protocol.test.js`. The test file naming convention mirrors `src/` one-to-one.

## Configuration

All configuration is via environment variables loaded in `config.js`. Copy `.env.example` to `.env` to start. Key groups:

- `SERVICE_TOKEN` — Required, must be >=32 chars, not the placeholder value
- `SHADOW_MODE` — `true` (default) disables real model calls
- `MODEL_*` — Optional OpenAI-compatible model
- `MEMORY_*` / `OMBRE_*` — Optional LMC-5/Ombre memory MCP
- `MCP_ENABLED` / `OAUTH_ENABLED` — Remote MCP access
- `BRIDGE_*` — User-interaction runtime bridge
- `BARK_*` / `NTFY_*` — Push notifications
- `DASHBOARD_*` — Read-only visual dashboard
