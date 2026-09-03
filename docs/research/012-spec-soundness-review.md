# Batch 012 spec soundness review

Reviewer: independent spec-soundness reviewer. The reviewer did not write the
spec. The reviewer read the code and ran read-only probes on 2026-09-03.

Reviewed documents:

- `docs/specs/012-compaction-entry-id-space-fix.md` (draft)
- `docs/specs/009-agent-context-compaction.md` (closed)
- `docs/specs/011-compaction-card-ui.md` (closed)
- `.rivr/specs/009-agent-context-compaction.ledger.json` (read only)

Method: gate dry-runs, contract symbol audit, root-cause re-verification
against the shipped code and the pi dist, assumption probes, and a
contradiction hunt. Two pi behavior probes ran as throwaway node scripts.
No code changed. No ledger written. Only this file was created.

## Verdict

Blocked. Two blockers must return to the spec author before approval, and
one design guard is missing from S01.

## Root cause verification

The spec's root cause is confirmed with one correction in wording.

- The mirror mints its own ids. `InMemorySessionStorage.createEntryId`
  returns `uuidv7().slice(0, 8)` (`pi-agent-core/dist/harness/session/
  memory-storage.js:17-23`). The durable tree mints ids with
  `randomUUID().slice(0, 8)` (`packages/@openmaic/storage/src/agent-session/
  pg.ts:1738-1744`). The spaces are independent and both are minted at append
  time.
- The runner sink passes the mirror id verbatim. `makeCompactionRuntime`
  calls the mirror `session.appendCompaction` and the sink with the same
  `preparation.value.firstKeptEntryId`
  (`lib/server/agent-runtime/compaction.ts:235-245`). The runner forwards
  it to `entrySession.appendCompaction`
  (`lib/server/agent-runtime/runner.ts:1297-1304`). The durable row is
  written with an id that exists only in the in-memory mirror.
- The 009 tests made the mismatch invisible, but not because they used one
  session in two roles. The append sink was a void `vi.fn(async () => {})`
  and the tests asserted only `typeof entry.firstKeptEntryId === 'string'`
  (`tests/agent-runtime/compaction-runtime.test.ts:187, 202-211`). No test
  validated the id against any durable space. With no durable space at all,
  no mismatch could surface. The substance of the claim holds.

## BLOCKERS

### B1. The S01 design breaks the current turn's driver context on every compaction.

- Spec: `docs/specs/012-compaction-entry-id-space-fix.md` line 51
  ("The runtime keeps its mirror append consistent with the durable row: it
  passes the resolved id into `session.appendCompaction` as well").
- Evidence: the resolved id is a durable-tree id. The mirror tree contains
  only mirror ids (`memory-storage.js:17-23`). The durable id can never
  exist in the mirror. Pi's `buildSessionContext` drops every entry before
  a compaction row when `firstKeptEntryId` is not in the branch
  (`pi-agent-core/dist/harness/session/session.js:37-51`). A read-only
  probe confirmed the decay: with a foreign `firstKeptEntryId` the
  post-compaction context is one message (the summary), while the same
  session with its own id keeps 11 messages.
- The runtime returns that truncated context to the driver: `afterContext`
  at `compaction.ts:246` and `return afterContext.messages` at
  `compaction.ts:267`. The `tokensAfter` measurement at `compaction.ts:247`
  and the 011 end event at `compaction.ts:260-266` inherit the error. The
  fix would trade a durable-tree corruption for a silent loss of the recent
  tail on every compaction with the resolver wired.
- Recommended fix (exact wording): replace the spec's line 51 with: "The
  mirror append keeps the mirror `firstKeptEntryId`. The runtime passes
  `preparation.value.firstKeptEntryId` to the mirror `session.appendCompaction`
  exactly as today. The resolved durable id flows only into the `appendSink`
  payload. The mirror and the durable row live in separate id spaces by
  construction; the mirror never contains the durable id."

### B2. The end-event entryId claim is not implementable under the recorded contracts.

- Spec: `docs/specs/012-compaction-entry-id-space-fix.md` line 52
  ("The `end` card event (batch 011) carries the resolved durable `entryId`
  unchanged").
- Evidence: the runtime's end event `entryId` is the return value of the
  mirror `session.appendCompaction` (`compaction.ts:235-239, 260-266`).
  That return is the mirror compaction row's id, minted by the mirror.
  The durable append returns the durable row id, but the sink contract is
  `Promise<void>` (`compaction.ts:136-141`) and the runner discards the
  return inside `writeRequiredSessionEntry`
  (`runner.ts:1297-1304`). No code path produces the durable row id at the
  end-event site.
- No consumer resolves the end-event `entryId` against a tree. The fold
  stores it opaquely and the tests pin fixture strings
  (`tests/workbench/session-store.test.ts:95-107`). The runtime test
  asserts only the type (`tests/agent-runtime/compaction-runtime.test.ts:283`).
- Recommended fix (exact wording): replace the spec's line 52 with: "The
  `end` card event keeps carrying the runtime's `session.appendCompaction`
  return value, a mirror-space id. Batch 011 treats `entryId` as an opaque
  string; no consumer resolves it against a tree. No UI change in this
  batch." If the durable row id is wanted in the event, the spec must widen
  the `appendSink` contract to `Promise<string>` and update every 011 test
  mock that returns undefined, which contradicts the S01 test expectation
  that all 009/011 tests stay green unmodified.

## CONCERNS

### C1. The durable resolver and the mirror can cut at different messages.

The S01 resolver re-runs `prepareCompaction(durableBranch, settings)`
(spec line 50). After the first compaction the mirror branch is the compacted
view, while the durable branch keeps the full raw history plus the
compaction row. `prepareCompaction` computes `boundaryStart` differently in
each tree (`pi-agent-core/dist/harness/compaction/compaction.js:406-411`).
A read-only probe with a small kept tail showed the mirror cutting at the
compactionSummary message while the durable cut at an older raw user
message. The mirror's `messagesToSummarize` was empty in that case. The
summary content and the durable kept id then describe different cuts, and
the validator stays silent because the durable id is backward. The repaired
live session is exactly this shape: a small kept tail after the first
compaction row.
- Fix: add to the S01 design: "The resolver compares the mirror cut
  message with the durable cut message by content. On mismatch it throws,
  and the runtime fails closed through the existing catch. The safety
  suite pins the mismatch case." The derivation can locate the durable
  entry whose message object matches the mirror cut, and fail when absent.

### C2. `tests/scripts/` does not exist and the spec does not mark the new home.

The S02 G01 gate names `tests/scripts/repair-compaction-entry.test.ts`
(spec line 75). The directory is absent today. Vitest includes
`tests/**/*.test.ts` (`vitest.config.ts:11`), so the new tree is picked up.
The batch 008 C6 precedent requires new files to be marked. Add to Testing
Decisions: "`tests/scripts/` is a new directory.
`scripts/repair-compaction-entry.js` and
`tests/scripts/repair-compaction-entry.test.ts` are new files."

### C3. The `REPAIR_UNAVAILABLE` guard needs a pinned env doctrine.

The S02 deliverable says the script "exits nonzero with `REPAIR_UNAVAILABLE`"
(spec line 70) and G02 expects that string (spec line 76). The string is new.
The established pattern reads `DATABASE_URL` from the environment only and
exits 2 (`scripts/check-stage-completion.js:337-340`). `.env.local` contains
a `DATABASE_URL` today, so a script that loads it would not fail as the gate
expects. Pin in S02: "The script reads `DATABASE_URL` from the environment
only and never loads `.env.local`. When `DATABASE_URL` is unset it prints
`REPAIR_UNAVAILABLE` to stderr and exits 2." Note in Testing Decisions that
G02 is hermetic only when `DATABASE_URL` is unset, matching the 009
neutral-cwd doctrine for clean gates.

### C4. The 28.6K trigger claim does not match the shipped settings math.

S02 says the resume "re-triggers compaction at the pinned 45K window"
and the spec text elsewhere names a 28.6K trigger (spec lines 71, 96).
With a 45000 window, the floor policy resolves reserve to
`min(16384, max(2048, 0.2 * 45000)) = 9000`
(`lib/server/agent-runtime/compaction.ts:57-74`), so the trigger is 36000.
The 28.6K value requires an explicit reserve override of 16384. `.env.local`
sets `OPENMAIC_AGENT_COMPACTION_ENABLED` only; no reserve override is set.
The re-trigger will still occur naturally as the context grows, but the
number is wrong. Fix: replace the 28.6K claim with "36000 (45000 minus the
floor reserve 9000)" or state the explicit override the operator must add.

### C5. S02 records no target symbols.

Every other slice in the repo records target symbols and per-target
expectations. S02 lists a deliverable and gates only. The ledger build
requires a slice-level expectation and target expectations, and tier 2
requires no tag, so the build can pass, but the script is a deliverable
with no captured contract. `.js` is a supported capture extension
(`rivr-ledger/SOURCES.md`). Fix: add to S02 a Target symbols block with
`scripts/repair-compaction-entry.js :: main` (kind function, new), or
declare explicitly that S02 is gate-only with no captured symbol, the
alternative batch 008 B3 records.

### C6. The 009 single-role characterization is imprecise.

Spec line 21 says "Batch 009 tests wired one session into both roles, so
both id spaces coincided." The 009 runtime tests fed the sink a void mock
(`compaction-runtime.test.ts:187-211`); there was no second role or second
space. The claim that the mismatch was invisible holds, but the mechanism
is different. Fix: reword to "Batch 009 tests never validated the id
against a durable space, so the mismatch was invisible."

## MINOR

### M1. The spec's root-cause line citations drift by a few lines.

Spec lines 17 to 20 cite `compaction.ts:165` (exact), `compaction.ts:220-223`
(the prepare call and id use sit at `compaction.ts:219, 235-245`), and
`runner.ts:1296-1300` (the sink sits at `runner.ts:1297-1304`). No
functional impact. Fix: correct the citations.

## Verified accurate

The following probes passed.

- Contract symbols. `runSession` at `runner.ts:891` reads
  `(ctx: RunContext, meta: ClaimedAgentSession): Promise<void>`, byte-exact.
  `makeCompactionRuntime` at `compaction.ts:156` reads
  `(opts: CompactionRuntimeOptions): CompactionRuntime`, byte-exact.
  `CompactionRuntimeOptions` exists at `compaction.ts:122` and gains the
  optional resolver field. `resolveFirstKeptEntryId` appears nowhere today.
- Gate oracles. `npx vitest run tests/agent-runtime/compaction-runtime.test.ts`
  passes 13 tests and `compaction-safety.test.ts` passes 6. The `passed`
  expect string is a literal substring. Both suites are gate-ready as
  existing files that stay green.
- Fail-closed path. The sink call at `compaction.ts:240-245` sits inside
  the try at `compaction.ts:217`. The catch at `compaction.ts:268-271`
  records `trace.failures` and returns the input messages unchanged. The
  end event emits at `compaction.ts:260-266`, after the sink, so a throwing
  resolver or sink emits no end event. The spec must pin the resolver call
  inside the existing try and before the summarizer to fail fast.
- Validator rule. Branch order is append order: `getPathToRoot` unshifts
  up the parent chain (`pg.ts:1687-1702`) and rows read `ORDER BY seq`
  (`pg.ts:1347`). The cut message always precedes the compaction row in
  branch order, so the corrected durable id passes the backward check at
  `entry-tree-storage.ts:64-73` and the context slice at 85 to 108 works.
- Repair target. The durable row stores `firstKeptEntryId` inside the JSONB
  `data` column: `appendTreeEntry` spreads `...data` (`pg.ts:1367-1384`)
  and the compaction entry shape carries `firstKeptEntryId`
  (`packages/@openmaic/storage/src/agent-session/types.ts:224-227`).
  The table is `agent_session_entries` (`pg.ts:58`). The
  `data->>'firstKeptEntryId'` path is correct. The prefix-recompute
  approach in S02 is correct because the broken row is the first compaction
  row, so the prefix contains the full history and no prior boundary.
- Route pin. `MODEL_ROUTES` contains a `maic-agent-driver` entry with a
  `contextWindow` key. Values were not inspected.
- Tier math. S01 tier 3 has exactly three gates with one integration tag
  (G01 unit, G02 integration, G03 smoke). S02 tier 2 has exactly two gates
  (G01 unit, G02 smoke). Both match the tier floor.
- Contradictions. 011 pins no entryId semantics: the fold tests use opaque
  fixture strings and the runtime test asserts only the type. The 009 spec
  claims no single id space anywhere. The mirror keeps its appended row id
  from the mirror space today, which matches the B2 fix.

## Could not verify

- The origin of the live id `01a06649`. Its shape matches the mirror's
  `uuidv7().slice(0, 8)` space, but without the database the claim stays a
  consistency check, not a proof.
- The post-repair resume re-triggering compaction. That depends on the
  real page sizes and the repaired kept tail. The trigger math is 36000,
  not 28600, but a re-trigger remains plausible.
- The repair runbook against a session with a live lease. The runbook is
  an orchestrator step, not a gate, and the spec should state that the
  session must not be running when the UPDATE applies.

## Bottom line

The root cause is correctly diagnosed and the fail-closed direction is
right. S01 as written corrupts the live turn's context on every
compaction, and the end-event claim is not expressible against the
recorded contracts. The spec must apply B1 and B2, add the C1 content
guard, and pin the new-file and env doctrine before certification.