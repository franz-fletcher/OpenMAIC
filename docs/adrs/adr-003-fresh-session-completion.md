# ADR-003: Fresh session completion with the plan embedded

Status: Accepted (2026-09-03)

## Context

The driver turn at seq 5836 carried 307323 input tokens for one turn because the driver re-sends the full message history every turn. Resume repeats the cost on every later turn and degrades steering quality. All durable state the finish needs lives in the database, not in the transcript.

## Decision

Option B. The finishing build runs in a fresh agent session whose prompt embeds the pinned plan. The session requests only the missing pages, and the completion gate verifies the result.

## Consequences

- The fresh driver context starts small, so batch 008 finishes without batch 009 compaction.
- The plan prompt must fit within `MAX_SESSION_TEXT_LENGTH`, which is 100000 characters at `limits.ts:9`.
- The 52-versus-50 page label discrepancy stays unresolved, and the gate uses the table inventory of 50.
- Resume remains available for other cases, and 11 `session_resumed` rows show the durable checkpoint architecture works.

References: `docs/specs/008-stage-generation-throughput.md` (Solution item 5, Implementation Decisions, Out of Scope), reference session `96cdbbfa-31c1-4d21-9398-ef9059d36b24` seq 5836, `lib/server/agent-runtime/limits.ts:9`. Commit `7844d653`. Ledger stage `research_update`.