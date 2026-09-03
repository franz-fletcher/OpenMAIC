# ADR-004: Compaction write side through appendCompaction and callLLM

Status: Accepted (2026-09-03)

## Context

The reference director compaction uses pi `generateSummary` with a raw model and api key. That call bypasses `callLLM`, which violates the hard architecture boundary that every server side model call flows through the LLM wrapper.

## Decision

Batch 009 writes through pi `Session.appendCompaction` on the runner critical chain. The summarizer calls `callLLM` with the provider neutral stage `maic-agent-compaction` and never imports `generateText` or `streamText`.

## Consequences

- The compaction entry keeps the exact shape `loadSessionEntryHistory` consumes, including `firstKeptEntryId`.
- The write is a critical entry write fenced through `writeRequiredSessionEntry`, so lease loss aborts the run like a message append.
- The stage needs a `MODEL_ROUTES` entry, and a missing route throws before any call.
- The lint LLM entry guard stays green, and usage accounting covers the summarizer.

References: `docs/specs/009-agent-context-compaction.md` (S02, S03, Implementation Decisions), `lib/server/agent-runtime/compaction.ts:261-286`, `lib/server/agent-runtime/runner.ts:1273-1293,1519`, pi `session.js:134`, `lib/server/model-routes.ts:131-152`. Commit `65b4cd76`. Ledger stage `research_update`.