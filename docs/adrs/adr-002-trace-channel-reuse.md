# ADR-002: Phase progress on the durable trace channel

Status: Accepted (2026-09-03)

## Context

The workbench already folds durable trace rows onto the running tool card at `session-store.ts:1184-1203`. The runner persists every non-throttled event, and the events route replays durable rows, so the observability channel exists end to end. Only the emission was missing.

## Decision

`generate_scene` emits phase lines through the pi `onUpdate` callback. The runner maps the surviving message from `tool_execution_update` to a `trace` row, and the workbench rail learns the new vocabulary. No new event type and no new vendor dependency.

## Consequences

- The phase lines are durable and replayable, so a refreshed page shows the same story as the live one.
- `args` and `partialResult` stay stripped from durable `tool_execution_update` rows, and the trace row carries the phase line instead.
- `tool_execution_update` receives no workbench fold case, so the trace channel stays the single progress surface.
- The structural type `ToolUpdateWithMessage` replaces the pi type `ToolExecutionUpdateEvent`, which does not exist in the installed dist types.

References: `docs/specs/008-stage-generation-throughput.md` (S01, Delivered versus spec, Implementation Decisions), `lib/server/agent-runtime/runner.ts:1506-1512`, `lib/server/agent-runtime/tool-progress.ts:1-14`, `lib/workbench/session-store.ts:1184-1203`, `components/workbench/chat/tool-progress.ts:52-55`. Commits `7844d653`, `919413dd`. Ledger stage `research_update`.