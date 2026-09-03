# ADR-006: Compaction flag default OFF

Status: Accepted (2026-09-03)

## Context

The compaction runtime adds a new model call and a new critical write path. Deployments that do not opt in must see zero behavior change, and the published packages and tests stay untouched.

## Decision

`OPENMAIC_AGENT_COMPACTION_ENABLED` defaults to false, and the parse at `config.ts:28` returns an empty block when unset. The tandem run flips the flag with environment, adds a `MODEL_ROUTES` entry for `maic-agent-compaction`, and restarts the server.

## Consequences

- Disabled mode returns the incoming messages by reference and appends nothing.
- No existing test changes behavior, and `runner.ts:1519` stays byte identical when disabled.
- Operators must set two variables to enable compaction, which is a deliberate activation cost.
- The `.env.example` block now describes live semantics while keeping the OFF default.

References: `docs/specs/009-agent-context-compaction.md` (S01, S03, Implementation Decisions, Further Notes), `lib/server/agent-runtime/compaction.ts:53`, `lib/server/agent-runtime/config.ts:27-42`, `lib/server/agent-runtime/runner.ts:1273-1293,1519`, `.env.example:401-403`. Commit `65b4cd76`. Ledger stage `research_update`.