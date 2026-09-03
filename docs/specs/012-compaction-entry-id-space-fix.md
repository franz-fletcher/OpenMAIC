# Batch 012 spec: compaction-entry-id-space-fix

Spec status: verification

## Problem Statement

The first live compaction corrupted the durable entry tree of session `13dd023b-322f-4631-8a7d-d46fc26011e2`. The session cannot resume. Every claim fails at setup with:

```
SessionEntryHistoryError: compaction 8bca36ed has a non-backward firstKeptEntryId 01a06649
```

Entry `01a06649` does not exist in `agent_session_entries`. The tree validator is correct to reject the history. The writer is wrong.

Root cause, verified live on 2026-09-03:

- `makeCompactionRuntime` keeps an in-memory mirror session (`InMemorySessionRepo`, `lib/server/agent-runtime/compaction.ts:165`). `syncSession` appends the driver's message objects into that mirror. The mirror generates its own entry ids.
- The durable tree is a separate pg-backed pi session. Its message entries carry different ids, generated at durable append time.
- `prepareCompaction` runs against the mirror branch. It returns `firstKeptEntryId` from the mirror id space (`compaction.ts:220-223`).
- The runner sink passes that mirror id straight into `entrySession.appendCompaction` (`runner.ts:1296-1300`). The durable row therefore references an id that only exists in the mirror.
- Batch 009 never saw this because its tests injected a void `vi.fn()` sink. No durable second id space existed in any 009 test, so the mismatch had no place to surface. The live two-storage wiring exposed it. This is the synthetic-versus-real gap the tandem run exists to catch.

## Solution

Resolve the kept-entry id in the durable id space at sink time, and fail closed when it cannot be resolved.

- S01 (tier 3): the runner `appendSink` recomputes the cut point against the durable branch using pi's `prepareCompaction` with the same settings the runtime uses. It appends the compaction with the durable `firstKeptEntryId`. If the durable preparation yields no id, the sink throws, the runtime records the failure through its existing path, no end event is emitted, and the tree stays uncorrupted. The compaction summary content still comes from the mirror; only the id is re-resolved.
- S02 (tier 2): the durable compaction row of the live session is repaired by an operator runbook (one UPDATE, executed by the orchestrator, not a ledger gate). The repair recomputes the correct durable id with the same function S01 uses, so the fixed code and the repaired row agree.

The validator (`entry-tree-storage.ts:64-73`) does not change. Fail-fast on a broken tree is correct behavior and this batch keeps it.

## User stories

1. As an operator, my build session resumes after a compaction, so the tandem run can finish.
2. As an operator, a compaction never writes an id the durable tree cannot resolve, so no future session corrupts.
3. As a maintainer, a regression test uses two distinct id spaces, so the mirror cannot silently pass again.

## Slices

### S01 Durable id resolution in the append sink (tier 3)

Target symbols.

- `lib/server/agent-runtime/runner.ts` :: `runSession` (existing, signature unchanged: `(ctx: RunContext, meta: ClaimedAgentSession): Promise<void>`).
- `lib/server/agent-runtime/compaction.ts` :: `makeCompactionRuntime` (existing, signature unchanged: `(opts: CompactionRuntimeOptions): CompactionRuntime`). The options gain one field: `resolveFirstKeptEntryId?: (mirrorFirstKeptEntryId: string) => Promise<string>`. When present, the runtime calls it before `appendSink` and uses its return value for both the mirror append and the durable append. When absent, behavior is today's (tests and single-storage callers).
- `lib/server/agent-runtime/compaction.ts` :: `CompactionRuntimeOptions` (existing, gains the optional resolver field).

Design.

- The runner supplies the resolver. It loads the durable branch through the existing `entrySession` (`getBranch`), runs pi's `prepareCompaction(durableBranch, settings)` with the same resolved settings the runtime holds, and returns the durable `firstKeptEntryId`. A nullish or throwing result propagates as a compaction failure: the existing catch records `trace.failures`, emits no end event, returns the input messages unchanged, and writes no durable row.
- The runtime keeps its mirror append unchanged: the mirror row keeps the mirror `firstKeptEntryId`. Mirror ids come from `uuidv7().slice(0,8)` and durable ids from `randomUUID().slice(0,8)`. The two spaces are disjoint by construction, and pi's `buildSessionContext` drops every entry before a compaction row whose `firstKeptEntryId` is foreign. Passing a durable id into the mirror would truncate the live context to the summary message alone.
- The resolved durable id flows only into the `appendSink` payload. That is the row the validator reads.
- The resolver fails closed on divergence. After the first compaction the mirror holds the compacted view while the durable branch holds full history plus compaction rows, so `prepareCompaction` can cut at different points. The resolver compares the mirror cut message and the durable kept entry by content. A mismatch throws. The runtime records the failure, emits no end event, writes no durable row, and returns the input messages unchanged. The safety suite pins the divergence case.
- The `end` card event (batch 011) keeps carrying the mirror-space id returned by `session.appendCompaction`. Batch 011 treats `entryId` as an opaque string. No consumer resolves it against a tree.

Per-target expectations.

- A regression test constructs a runtime whose mirror and whose durable branch generate different ids for the same message sequence, wires the resolver, and asserts the durable compaction row carries an id from the durable space and that `loadSessionEntryHistory` accepts the resulting tree.
- A second case: resolver throws; no compaction row is appended; `getTrace().failures` records it; context is returned unchanged.
- A third case: mirror and durable branches diverge after a prior compaction; the resolver's content comparison throws; the fail-closed path holds.
- Default-absent resolver keeps existing behavior: every 009/011 compaction test stays green unmodified.

Gates (cwd: repo root).

- G01 (unit): `npx vitest run tests/agent-runtime/compaction-runtime.test.ts` expect `passed`. New two-id-space cases live here.
- G02 (integration): `npx vitest run tests/agent-runtime/compaction-safety.test.ts` expect `passed`. The safety suite gains the end-to-end mirror-plus-durable wiring case using the in-memory storage double with independent id counters.
- G03 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S02 Repair runbook and re-entry proof (tier 2, gate-only slice)

S02 declares no target symbols. Its gates are the contract.

Deliverable.

- `scripts/repair-compaction-entry.js` (new): reads `DATABASE_URL` from the environment only, never from `.env.local`, matching the `check-stage-completion.js` guard doctrine. It loads one session's durable branch, finds compaction rows whose `firstKeptEntryId` is not a branch id, recomputes the correct id with `prepareCompaction` over the branch prefix before that row, prints the planned UPDATE, and applies it only with `--apply`. Without `DATABASE_URL` it prints `REPAIR_UNAVAILABLE` and exits 2. Default is dry-run print only. The session must not be running when `--apply` executes; the operator confirms a terminal status first.
- The orchestrator executes it against session `13dd023b-322f-4631-8a7d-d46fc26011e2` with `--apply` after S01 lands, then resumes the build. The resume itself re-triggers compaction at the pinned 45K window and renders the batch-011 card live. That live observation is the meta acceptance for batches 011 and 012 together.

Gates (cwd: repo root).

- G01 (unit): `npx vitest run tests/scripts/repair-compaction-entry.test.ts` expect `passed`. The test feeds a fixture branch with a phantom id and asserts the recomputed id, the dry-run output, and the refusal to touch a valid tree. Both files under `tests/scripts/` are new.
- G02 (smoke): `env -u DATABASE_URL node scripts/repair-compaction-entry.js` expect `REPAIR_UNAVAILABLE`. The unsetting is mandatory: the rivr gate runner loads `.env.local`, which today exports a real `DATABASE_URL`.

## Implementation Decisions

- Re-resolve at the sink instead of sharing id spaces. Making the mirror reuse durable ids would require a custom `SessionStorage` with id injection, which pi does not support. Recomputation is one pure function call on authoritative data.
- The mirror row keeps the mirror id. Pi's context builder requires the kept id to resolve inside its own storage. Only the durable row receives the resolved id.
- The resolver is optional. Single-storage tests and any future non-durable caller keep working without ceremony.
- Fail closed. An unresolvable kept id must never reach the durable tree. Losing one compaction (the context just grows one more turn and retries) is cheap; corrupting the tree is not.
- The repair script recomputes with the same pi function the fix uses. One source of truth for the cut point.
- The trigger arithmetic for the acceptance window: the 45K pin resolves the reserve floor to `min(16384, max(2048, 20 percent of 45000))` = 9000, so the trigger is 36000 tokens, not 28600. Post-repair context near 25K re-crosses it in roughly ten pages.
- No validator change. The backward-reference rule caught the bug exactly as designed.

## Testing Decisions

- The regression test must generate mirror ids and durable ids from independent counters. A shared counter hides the bug, which is how 009 passed.
- Existing suites that must stay green untouched: `compaction-trigger`, `compaction-summary`, `runner-event-order`, `entry-tree-storage`, `event-log-slim`, the 011 fold and card suites.
- Full `pnpm test` before mark. The only allowed pre-existing failure remains `runner-skills-registration` (proven pre-existing twice on clean checkouts).

## Out of Scope

- Any change to trigger policy, settings floors, card events, fold, or UI.
- Automatic self-healing in `loadSessionEntryHistory`. Rejection stays.
- The `OPENMAIC_AGENT_*` env surface and the 45K route pin, which is an operator setting for the acceptance window, not code.

## Open Questions

- None blocking. The live repair value for the broken row will be printed by the dry run before `--apply`.

## Further Notes

- Program acceptance after this batch: session `13dd023b` resumes, the card streams at the next model boundary, the tree validates on every subsequent resume, and the build reaches 50 pages for `check-stage-completion.js`.
- Batch 011 certification and this batch's certification are both held until that live observation passes.
