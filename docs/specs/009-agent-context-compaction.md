# Batch 009 spec: agent-context-compaction

Spec status: closed

## Outcome

All four slices verified in round 1. S01, S02, S03, and S04 certified on the first attempt, with no rejections and no round-2 rework. Commit `65b4cd76` ships the full compaction write side: trigger policy, summarizer stage, transformContext wiring, and safety and observability. The ledger chain stood at 27 entries at verdict time and is valid at 33 entries at stage `research_update`, after the clarification amend at seq 32 and the stage advance at seq 33. Certification is pending ledger accept.

## Problem Statement

The server agent runtime grows its driver context without bound. The ENGE503 production session 96cdbbfa-31c1-4d21-9398-ef9059d36b24 reached 307323 input tokens in one driver turn (the last nonzero message usage block in the entry tree). The driver re-sends the full message history every turn through `streamLLM`. A long course build in one session repeats that cost. Every additional turn raises the price of every later turn and degrades steering quality.

The read side of compaction already ships. `loadSessionEntryHistory` (`lib/server/agent-runtime/entry-tree-storage.ts:43-121`) consumes `compaction` entries. It validates `firstKeptEntryId` as backward (`entry-tree-storage.ts:64-73`), finds the latest compaction entry (`entry-tree-storage.ts:76`), and slices the model view around it (`entry-tree-storage.ts:77-108`). The raw message stream stays untouched for delivery cursors (`entry-tree-storage.ts:119`). The storage schema carries the entry type (`packages/@openmaic/storage/src/agent-session/types.ts:224-228`). Pi materializes the compaction entry into a context summary message (`dist/harness/session/session.js:3-57`) and pi `Session.appendCompaction` writes the canonical entry shape (`dist/harness/session/session.js:134`).

The write side does not exist. `agentRuntimeConfig.compaction` is parsed (`lib/server/agent-runtime/config.ts:27-42`) and consumed nowhere. `buildAgent` accepts `transformContext` (`lib/agent/runtime/build-agent.ts:55`, passed at `:69`) and no caller passes it. The flags `OPENMAIC_AGENT_COMPACTION_ENABLED`, `OPENMAIC_AGENT_COMPACTION_RESERVE_TOKENS`, and `OPENMAIC_AGENT_COMPACTION_KEEP_RECENT_TOKENS` are documented as reserved and inert (`.env.example:401-403`). No trigger measures the assembled driver context. No summarizer produces a compaction entry. No path writes one through the entry tree.

The workbench progress rail proves the 008 connection: the trace channel is durable, and compaction must never break what 008 ships. This batch fills the write side against the shipped read side, under the driver context window pin the runtime already exposes.

## Solution

Four slices build the compaction write side. They mirror the proven reference runtime `createDirectorCompactionRuntime` (`lib/chat/pi/director-compaction.ts:106-233`) with one hard divergence: the summarizer calls `callLLM`, never pi `generateSummary`.

- S01: a trigger policy measures the assembled driver context against the pinned context window minus the reserve.
- S02: a summarizer produces the compaction summary through `callLLM` with a new provider neutral stage, and the runtime appends the compaction entry in the exact shape `entry-tree-storage` consumes.
- S03: the runner passes the compaction runtime as `transformContext` to `buildAgent`, so the driver turn sees the post compaction view while delivery cursors keep raw entries.
- S04: safety and observability. The compaction never fires mid tool call. The write is critical, fenced, and durable. Every compaction emits a trace line.

The flag stays default OFF. The tandem run in the meta spec flips it with environment and the orchestrator watches.

## User Stories

1. As an operator, I run a 35 page build in one session without the driver context growing into the hundreds of thousands of tokens, so the tandem completion stays inside the 4 to 8 hour band.
2. As the driver model, I see a summary of the old conversation plus the recent tail instead of the full transcript, so my steering quality stays high on late turns.
3. As an operator, I route the summarizer model separately from the driver through `MODEL_ROUTES`, so a cheap summarizer does not spend driver budget.
4. As the maintainer, I see one trace line per compaction with the before and after token counts, so the runtime is observable in the event log and in the workbench tool card.
5. As the verifier, I prove compaction round trips through the shipped reader with hermetic gates, so certification does not depend on the live tandem run.

## Slices

### S01 Compaction trigger policy (tier 3)

**Target symbols.**

- `lib/server/agent-runtime/compaction.ts` :: `resolveCompactionSettings` (kind function, new exported helper).
- `lib/server/agent-runtime/compaction.ts` :: `measureDriverContextTokens` (kind function, new exported helper).

**Before-state capture facts.**

- `agentRuntimeConfig.compaction` parses `OPENMAIC_AGENT_COMPACTION_ENABLED === 'true'` and conditionally spreads `reserveTokens` and `keepRecentTokens` (`config.ts:28-41`). It is never read.
- The driver context window chain is pinned at `agent-driver-model.ts:39`: route operator pin, then catalog window, then a 128000 fallback. The `128_000` fallback replaces an earlier 1_050_000 and the pinned model test names the reason (`tests/agent-runtime/agent-driver-model.test.ts:144`).
- Pi provides the measurement primitives: `estimateContextTokens(messages)` returns `{ tokens, usageTokens, trailingTokens, lastUsageIndex }`, and `estimateTokens(message)` is a conservative character heuristic (`dist/harness/compaction/compaction.d.ts`).
- The reference runtime resolves settings with floors: reserve at least 2048 or 20 percent of the window, keep recent at least 2048 or 25 percent, capped by pi defaults (`director-compaction.ts:51-68`).
- Database evidence for the zero usage case: the reference session has 137 of 141 assistant message blobs with nonzero usage, and the last blob is all zero. The reference runtime falls back to the per message estimator when the last usage anchor is zero or absent (`director-compaction.ts:85-95`).

**Postcondition (per target symbol).**

- `resolveCompactionSettings`: after-exists true. after-kind function. after-signature `(contextWindow: number, overrides?: Partial<CompactionSettings>): CompactionSettings`.
- The function resolves `enabled`, `reserveTokens`, and `keepRecentTokens`. Absent values use the floor policy: reserve at least 2048 or 20 percent of the window, keep recent at least 2048 or 25 percent, capped by pi defaults.
- `measureDriverContextTokens`: after-exists true. after-kind function. after-signature `(messages: AgentMessage[]): number`.
- The function returns the pi estimate when a nonzero usage anchor exists. A zero or absent usage anchor falls back to the sum of per message estimates.

**Per-target success expectations.**

- `resolveCompactionSettings` with no overrides keeps the flag OFF and never triggers.
- Explicit reserve and keep recent values win over the floor policy.
- `measureDriverContextTokens` on the zero tail shape (the reference session evidence) counts every message.
- The trigger never fires when compaction is disabled or when the count is under the window minus reserve.

**Evidence strings.**

- Config parse: `OPENMAIC_AGENT_COMPACTION_ENABLED === 'true'` at `config.ts:28`.
- Window chain: `routeContextWindow ?? connection.modelInfo?.contextWindow ?? 128_000` at `agent-driver-model.ts:39`.
- Zero usage fallback guard: `providerEstimate.usageTokens <= 0` at `director-compaction.ts:91`.
- Reference max input block: `307323`.

**Delivered versus spec.**

- `resolveCompactionSettings` ships at `compaction.ts:41-57`. The floor pair is byte-equivalent to the reference `director-compaction.ts:51-68`: reserve is at least 2048 or 20 percent of the window, keepRecent is at least 2048 or 25 percent, both capped by the pi defaults. The floor caps are the pi constants `reserveTokens: 16384` and `keepRecentTokens: 20000` (`pi-agent-core/dist/harness/compaction/compaction.js:57-61`). The one divergence is the enabled default. This runtime defaults to false at `compaction.ts:53`, where the reference uses the pi opt-in default of true. The comment at `compaction.ts:51-52` documents the inversion.
- The zero-usage guard ships at `compaction.ts:69-79`. `measureDriverContextTokens` checks `lastUsageIndex !== null && usageTokens <= 0` at `compaction.ts:75` and sums the per-message estimator, byte-equivalent to the reference guard at `director-compaction.ts:91`.
- The settings functions carry the `// prettier-ignore` marker at `compaction.ts:40` so the frozen signatures survive the Prettier 100-column wrap. The diff gate matched the captured signatures on the first round.

**Round-1 evidence.**

- 16 tests in `tests/agent-runtime/compaction-trigger.test.ts`, 2 in `tests/agent-runtime/runner-contract.test.ts`, and 13 in `tests/agent-runtime/agent-driver-model.test.ts`, plus the TSC smoke. All pass. Verified round 1.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/compaction-trigger.test.ts` expect `passed`.
- G02 (unit): `npx vitest run tests/agent-runtime/runner-contract.test.ts` expect `passed`. The existing runner contract suite proves flags-default-OFF deployments are untouched, so the trigger policy lands with zero behavior change for deployments that leave the flags unset.
- G03 (integration): `npx vitest run tests/agent-runtime/agent-driver-model.test.ts` expect `passed`. The trigger consumes the context window chain this suite pins, so it is part of the trigger's integration surface.
- G04 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S02 Summarizer and entry writer (tier 3)

**Target symbols.**

- `lib/server/agent-runtime/compaction.ts` :: `generateCompactionSummary` (kind function, new exported helper).
- `lib/server/model-routes.ts` :: `LLM_STAGES` (kind constant, existing).

**Before-state capture facts.**

- `LLM_STAGES` ends at `maic-agent-driver` (`lib/server/model-routes.ts:131-152`). A test pins the full list with exact equality (`tests/server/model-routes.test.ts:361-378`), so a new stage requires that update.
- The entry tree writer exists in pi: `Session.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook)` writes `{ type: 'compaction', id, parentId, timestamp, summary, firstKeptEntryId, tokensBefore, details, fromHook }` (`dist/harness/session/session.js:134-144`). The storage type admits it (`types.ts:224-228`).
- `loadSessionEntryHistory` consumes exactly that: a compaction entry whose `firstKeptEntryId` is a backward branch id, plus the entry id on the context list (`entry-tree-storage.ts:66-73, 76-108`).
- The reference summarizer route is pi `generateSummary`, which takes a `Model` and `apiKey` and calls the provider directly (`dist/harness/compaction/compaction.d.ts`). That bypasses `callLLM`. The hard architecture boundary forbids it: every server side model call flows through `callLLM`/`streamLLM` (`lib/ai/llm.ts`), pinned by `tests/lint-llm-entry-guard.test.ts`.

**Postcondition (per target symbol).**

- `generateCompactionSummary`: after-exists true. after-kind function. after-signature `(messages: AgentMessage[], focus: string, maxOutputTokens: number, signal?: AbortSignal): Promise<string>`.
- The function calls `callLLM` with stage `maic-agent-compaction` and returns the summary text. It never imports `generateText` or `streamText`. It resolves the stage through `resolveModel`, with no fallback to another stage. A missing route throws before the call.
- `LLM_STAGES`: after-exists true. after-kind constant. The list now includes `maic-agent-compaction` before the closing element, and the pinned test at `tests/server/model-routes.test.ts:361-378` reflects it.

**Per-target success expectations.**

- A mocked `callLLM` returns the summary and the summary text reaches the caller.
- The stage name `maic-agent-compaction` appears once in `LLM_STAGES` and carries no vendor term.
- The compaction entry written by `Session.appendCompaction` passes `loadSessionEntryHistory` on the next load: the backward check, the context slice, and the message count check (`entry-tree-storage.ts:109-114`).
- The provider neutrality debt table stays untouched. The lint LLM entry guard stays green.

**Evidence strings.**

- Canonical writer: `async appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook)` at `session.js:134`.
- Stage list pin: `toEqual` at `tests/server/model-routes.test.ts:362`.
- Entry key names: `firstKeptEntryId`, `summary`, `tokensBefore`.

**Delivered versus spec.**

- `generateCompactionSummary` ships at `compaction.ts:261-286`. It touches the LLM boundary only through dynamic import at `compaction.ts:262-263`, so the boundary loads only when a summary is actually generated. The function resolves the single stage `maic-agent-compaction` with no fallback at `compaction.ts:271` and passes the same stage to `callLLM` at `compaction.ts:281`. A missing route throws before any call, matching the driver doctrine. The function never imports `generateText` or `streamText`, and the lint entry guard gate stays green.
- `LLM_STAGES` gains the stage once. The pinned registry test carries `'maic-agent-compaction'` at `tests/server/model-routes.test.ts:379`.
- Neutrality is clean. No vendor term entered a neutral file, so the provider neutrality debt deltas are zero.

**Round-1 evidence.**

- 3 tests in `tests/agent-runtime/compaction-summary.test.ts`, 30 tests in `tests/server/model-routes.test.ts`, and 4 passed with 3 skipped in `tests/agent-runtime/entry-tree-storage.test.ts`, plus the TSC smoke. The 3 skips are pre-existing and outside batch scope. Verified round 1.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/compaction-summary.test.ts` expect `passed`.
- G02 (integration): `npx vitest run tests/server/model-routes.test.ts` expect `passed`. The re-pinned stage list plus `resolveModel` stage resolution form the route integration surface.
- G03 (unit): `npx vitest run tests/agent-runtime/entry-tree-storage.test.ts` expect `passed`. The new compaction-entry tests prove the writer's shape against the shipped reader.
- G04 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S03 transformContext wiring and read path (tier 3)

**Target symbols.**

- `lib/server/agent-runtime/compaction.ts` :: `makeCompactionRuntime` (kind function, new exported helper).
- `lib/server/agent-runtime/runner.ts` :: `runSession` (kind function, existing).

**Before-state capture facts.**

- `BuildAgentOptions.transformContext` exists and no caller passes it (`lib/agent/runtime/build-agent.ts:55`, `:69`). A repo wide search finds no other reference.
- Pi invokes `transformContext` before each LLM call: `messages = await config.n(messages, signal)` in `dist/agent-loop.js`.
- The runner builds the agent at `runner.ts:1461-1500` with `history: modelMessages` on continue (`runner.ts:1492`). `modelMessages` already comes from the post compaction read view (`runner.ts:1142-1164`), so a compaction entry written by a prior run is visible on resume.
- Entry writes run on the serial chain: `enqueue` at `runner.ts:915-934`, critical writes through `writeRequiredSessionEntry` at `runner.ts:129-142`, message appends at `runner.ts:1518-1519`.
- Delivery cursors stay raw: `cursorMessages` is the append only stream (`entry-tree-storage.ts:119`) and the resume intent comes from durable `user_message` rows, never from the compaction view (`runner.ts:1694-1703`).
- The reference runtime shape returns `{ transformContext, getTrace, dispose }` and records `checkCount`, `triggerCount`, `failures`, and `events` (`director-compaction.ts:34-49, 137-146`).

**Postcondition (per target symbol).**

- `makeCompactionRuntime`: after-exists true. after-kind function. after-signature `(opts: CompactionRuntimeOptions): CompactionRuntime`.
- The runtime resolves settings from `agentRuntimeConfig.compaction` and the driver context window. When disabled it returns a pass through `transformContext` that returns its input unchanged.
- When enabled, `transformContext` measures the assembled messages, triggers on the threshold, prepares the cut point with `findCutPoint`, calls the injected summarizer, appends the compaction entry through the injected durable sink, and returns the post compaction view. The view and the incoming messages are never mutated in place.
- `runSession`: after-exists true. after-kind function. The signature is unchanged.
- When compaction is enabled and configured, `runSession` builds the runtime with a durable append sink fenced through `writeRequiredSessionEntry` and passes `transformContext` to `buildAgent`. A lease lost write aborts exactly like a message write. When disabled, `runSession` passes no `transformContext`, byte identical to today.

**Per-target success expectations.**

- A hermetic round trip writes a compaction entry and reloads it through `loadSessionEntryHistory`: the context messages shrink to the summary plus the kept tail, and `cursorMessages` stays the full raw stream.
- The driver turn after compaction sees the post compaction view, and the delivery cursors still address raw messages.
- Disabled mode returns the identical message array by reference and appends nothing.
- The cut point respects `keepRecentTokens` and the entry keeps the recent tail.

**Evidence strings.**

- Seam: `transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>` at `build-agent.ts:55`.
- Build call: `buildAgent({` at `runner.ts:1461`.
- Delivery doctrine: `never from the compaction view` at `runner.ts:1696`.
- Raw cursor: `cursorMessages: branch.flatMap(...)` at `entry-tree-storage.ts:119`.

**Delivered versus spec.**

- Enabled-only construction ships at `runner.ts:1273-1293`. The ternary at `runner.ts:1278` builds the runtime only when `config.compaction.enabled` is true. The lease fence wraps the durable append through `writeRequiredSessionEntry` with `markLeaseLost` at `runner.ts:1286-1292`, so a lost lease aborts exactly like a message write.
- The conditional spread at `runner.ts:1519` keeps the disabled build byte identical. When the flag is off, `compactionRuntime` is undefined and the spread adds no `transformContext`.
- No input mutation. The runtime returns the incoming array by reference on pass-through at `compaction.ts:187` and on failure at `compaction.ts:234`. The no-mutation property is pinned at `tests/agent-runtime/compaction-runtime.test.ts:186-200`.

**Round-1 evidence.**

- 8 tests in `tests/agent-runtime/compaction-runtime.test.ts` (with two non-blocking vi.mock hoisting warnings), 4 passed with 3 skipped in `tests/agent-runtime/entry-tree-storage.test.ts`, and the TSC smoke. Verified round 1.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/compaction-runtime.test.ts` expect `passed`.
- G02 (integration): `npx vitest run tests/agent-runtime/entry-tree-storage.test.ts` expect `passed`.
- G03 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S04 Safety and observability (tier 4)

**Target symbols.**

- `lib/server/agent-runtime/compaction.ts` :: `makeCompactionRuntime` (kind function, new).
- `lib/server/agent-runtime/entry-tree-storage.ts` :: `loadSessionEntryHistory` (kind function, existing).

**Before-state capture facts.**

- `loadSessionEntryHistory` has no compaction test. `tests/agent-runtime/entry-tree-storage.test.ts` contains no `compaction` match.
- The runtime emits durable events through `emit` and `appendEvent` (`runner.ts:960-1044`). `trace` is not throttled. The workbench folds `trace` onto the running tool card (`lib/workbench/session-store.ts:1184-1203`, `components/workbench/chat/tool-card.tsx:92`).
- Existing event realism rule: event log compaction drops raw call arguments and prose, so a tool keeps structured `details` for replay (`lib/server/agent-runtime/create-skill.ts:58-62`).
- Pi runs `transformContext` before the LLM call, never during a tool execution, so a compaction write cannot land mid tool call by construction (`dist/agent-loop.js`).

**Postcondition (per target symbol).**

- `makeCompactionRuntime`: after-exists true. after-kind function. The signature is unchanged.
- Every compaction emits one trace line with the before and after token counts and the summary length. Every failure records into `getTrace().failures` and returns the incoming messages unchanged. A summarizer failure appends nothing to the tree.
- `loadSessionEntryHistory`: after-exists true. after-kind function. The signature is unchanged.
- The function accepts a branch containing one compaction entry whose `firstKeptEntryId` is backward, returns the post compaction messages and the raw cursor messages, and rejects exactly the shapes it rejects today: an empty tree after a prior run, a non backward `firstKeptEntryId`, and a context to entry count mismatch.

**Per-target success expectations.**

- A transform during the summarizer failure returns the original messages and the tree gains no compaction entry.
- A valid compaction entry survives a reload with the same summary text and the same kept tail.
- The trace line carries the compaction entry id and the token counts.
- The existing rejection paths stay byte identical.

**Evidence strings.**

- Trace fold: `case 'trace':` at `session-store.ts:1184`.
- Replay rule: `deliberately drops raw call arguments and prose` at `create-skill.ts:58-59`.
- Validation throw: `has a non-backward firstKeptEntryId` at `entry-tree-storage.ts:69`.

**Delivered versus spec.**

- One trace line per successful compaction ships at `compaction.ts:228-230`: `compaction <entryId> tokens <before>-><after> summary <length>`. The failure path records into the trace failures list and returns the original message array by reference at `compaction.ts:232-235`, so a summarizer failure appends nothing to the tree.
- The reader is untouched. `loadSessionEntryHistory` keeps its signature and its rejection shapes. This batch adds coverage only.

**Round-1 evidence.**

- 6 tests in `tests/agent-runtime/compaction-safety.test.ts` (full run), the adversarial subset with the literal `summarizer failure` (2 passed, 4 skipped), and 32 tests in `tests/lint-llm-entry-guard.test.ts`, plus the TSC smoke. Verified round 1.

**Proposed gates (cwd: repo root for every gate).**

- G01 (integration): `npx vitest run tests/agent-runtime/compaction-safety.test.ts` expect `passed`.
- G02 (adversarial): `npx vitest run tests/agent-runtime/compaction-safety.test.ts -t "summarizer failure"` expect `passed`. The adversarial property is that a failing summarizer cannot corrupt the tree: the runtime returns the original messages, records the failure, and appends nothing.
- G03 (integration): `npx vitest run tests/lint-llm-entry-guard.test.ts` expect `passed`.
- G04 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

## Implementation Decisions

- **The runtime file is `lib/server/agent-runtime/compaction.ts`.** It ports the director runtime shape (`lib/chat/pi/director-compaction.ts`) and replaces the summarizer call with the OpenMAIC boundary. The three injected dependencies are the driver context window, the summarizer, and the durable append sink. This keeps the file pure and the runner as the composition root.
- **The summarizer stage is `maic-agent-compaction`.** The name is provider neutral and follows the `maic-agent-*` family. It is added to `LLM_STAGES` (`lib/server/model-routes.ts:131-152`) and the pinned list test is updated in the same change. The route has no fallback, matching the driver doctrine: a missing route throws at call time with the stage name.
- **The summarizer calls `callLLM`, never pi `generateSummary`.** `generateSummary` takes a `Model` and `apiKey` and calls the provider directly, which would bypass usage accounting and the entry guard. `tests/lint-llm-entry-guard.test.ts` is a required gate for S04.
- **The write goes through pi `Session.appendCompaction`.** It emits the shape the shipped reader consumes. The write is a critical entry write fenced through `writeRequiredSessionEntry`, so lease loss aborts the run exactly like a message append.
- **`transformContext` is the wiring seam.** Pi invokes it before each LLM call, so the compaction judgment runs at a model boundary, never inside a tool call. The runner passes it only when `agentRuntimeConfig.compaction.enabled` is true. Disabled mode is a pass through and changes no existing behavior.
- **The trigger token source is the entry tree usage blocks.** Assistant message blobs carry a `usage` block (137 of 141 in the reference session). The last block of a run can be all zero, so the measurement uses the trailing heuristic fallback from the reference runtime, never the last block alone.
- **Default OFF, tandem flips it.** `OPENMAIC_AGENT_COMPACTION_ENABLED` stays default OFF. The `.env.example:401-403` wording updated in the same change to describe live semantics while keeping the OFF default, per the repo rule for operator facing vars. The tandem run sets it true with orchestrator monitoring. The new env flags have no effect on existing tests because the parse defaults to false.
- **Observability is the existing trace channel.** One `LIFECYCLE.trace` emit per compaction with before and after counts. The line is durable and replayable. No new event type and no i18n keys: the text is operator facing diagnostics.
- **Repository constraints honored.** No `packages/@openmaic` changes. No provider vendor term enters a neutral file, so `tests/providers/provider-neutrality-guard.test.ts` debt counts stay untouched. Prettier 100 columns. No i18n keys.
- **The frozen signatures carry `// prettier-ignore`.** The 008 round-1 lesson was applied preemptively. Prettier re-wraps TypeScript signatures past 100 columns, and the stored contract is the wrapped text. `resolveCompactionSettings`, `makeCompactionRuntime`, and `generateCompactionSummary` each carry the marker before a one-line signature (`compaction.ts:40, 135, 260`), so the frozen text survives formatting and the diff compares real code. The 8 symbol diffs matched on the first round because of it.
- **The slice expectation cap was avoided by drafting under it.** Slice expectations have a 300-character cap. 008 hit the cap during staging and abandoned a staging worktree. 009 drafted each expectation under the cap on the first pass, so the ledger build landed without a cap error and without a workaround.

## Testing Decisions

- Test homes: `tests/agent-runtime/compaction-trigger.test.ts` for settings floors and the zero usage fallback, using the reference session evidence shape. `tests/agent-runtime/compaction-summary.test.ts` mocks `callLLM` and asserts the stage resolution. `tests/agent-runtime/compaction-runtime.test.ts` drives the full runtime against an in memory pi `Session` and asserts the round trip through `loadSessionEntryHistory`. `tests/agent-runtime/compaction-safety.test.ts` asserts failure returns, no write on failure, one trace line per compaction, and the unchanged rejection paths.
- The read side gains its first compaction coverage in `tests/agent-runtime/entry-tree-storage.test.ts`, which today has none.
- `tests/server/model-routes.test.ts:361-378` is re-pinned with the new stage.
- Gate oracle doctrine: expect strings are literal substrings of stdout plus stderr. Silent success commands echo a literal marker: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`. The adversarial gate names its test with the literal `summarizer failure`. Every gate pins the cwd to the repo root and is hermetic.
- Zero paid gates. The summarizer tests mock `callLLM`. No gate touches the database.
- **Allowed pre-existing failures.** `tests/agent-runtime/entry-tree-storage.test.ts` carries 3 pre-existing skipped tests in the S02 G03 and S03 G02 gates (7 total, 4 executed). The skips predate the batch, are outside its scope, and the gates pass on the executed subset. The vi.mock hoisting warnings in `tests/agent-runtime/compaction-runtime.test.ts` pass with warnings and will become an error in a future vitest version.
- **Flag-on hermeticity spot check.** The enabled path runs with no environment. The runtime tests construct `makeCompactionRuntime` with settings on and mock `callLLM` and `resolve-model`, and the runtime in-memory session seam means no store is touched. Zero paid gates held.
- **Soft finding on the trigger test.** `tests/agent-runtime/compaction-trigger.test.ts:138-162` re-implements the threshold formula inline (`settings.enabled && tokenCount > windowMinusReserve`) instead of calling `shouldCompact`. Documented, non-blocking. The real decision runs through `shouldCompact` at `compaction.ts:193`, and the trigger coverage lands via `tests/agent-runtime/compaction-runtime.test.ts:101-201`, which exercises the under-threshold and over-threshold paths through the runtime.

## Out of Scope

- Requiring the tandem run for this batch's certification. Gates are hermetic. The tandem run is the verifier round hostile environment validation, per batch 005 doctrine.
- Changing `generate_scene` internals. That is 008 territory.
- Enabling compaction by default. The flag stays OFF. The tandem run flips it.
- Changing the read side. `entry-tree-storage` already consumes compaction entries. This batch adds tests, not behavior.
- Reusing pi `generateSummary` or any direct provider call. All model calls flow through `callLLM`.
- Branch summaries and multi branch tree restructures. One linear compaction entry per judgment.
- Schema migrations. The storage type carries the compaction entry already.
- Any `packages/@openmaic` change and any i18n change.
- **The out-of-scope claim that certification does not depend on the tandem run is met.** All gates are hermetic. Zero paid gates. No gate touches the database.

## Further Notes

- Cross batch: 009 reuses the trace durability 008 ships. Nothing in 008 depends on 009. The fresh session completion starts with a small context, so 008 finishes without compaction.
- Operator setup: enabling compaction requires `OPENMAIC_AGENT_COMPACTION_ENABLED=true` and a `MODEL_ROUTES` entry for `maic-agent-compaction`. The driver route stays unchanged.
- The reference session 96cdbbfa remains the evidence artifact for token shapes. Its last assistant usage block is all zero, which is the fallback case S01 pins.
- Verifier note: all 009 gates are hermetic, so a hostile env run can execute them from a neutral cwd with absolute paths. The bun compiled rivr loads `.env.local` from its startup cwd, so gates that must stay clean run from a neutral cwd.
- Soundness expectation: the soundness review at the human checkpoint dry runs every gate against the current CLI and dry runs the round trip against the shipped reader.
- **Tandem start condition (meta-spec).** The tandem run flips compaction on in production with two steps: set `OPENMAIC_AGENT_COMPACTION_ENABLED=true` and add a `MODEL_ROUTES` entry for `maic-agent-compaction`. Then restart the server. The COMPLETION acceptance marker is unchanged.
- **The `.env.example` promise is kept.** The compaction block at `.env.example` now describes live semantics while keeping the OFF default, per the repo rule for operator facing vars. The clarification amend at ledger seq 32 records the wording as landed. The spec decision voice was corrected to the completed-change voice in the same amend.

## Deviations and Surprises

- The `.env.example` promise was initially unmet. The reserved-and-inert wording was still in place after the implementation commit. The cleanup before close replaced it with live semantics, and the clarification amend at seq 32 records the correction.
- `enabled` defaults false in `resolveCompactionSettings` (`compaction.ts:53`), where pi `DEFAULT_COMPACTION_SETTINGS.enabled` is true. The divergence is documented at `compaction.ts:51-52`. `makeCompactionRuntime` then applies `enabled ?? true` at `compaction.ts:139`, so the runner enabled-only construction at `runner.ts:1278` stays the single production gate.
- `InMemorySessionRepo` is the hermetic session fake. The runtime builds a throwaway in-memory session per transform at `compaction.ts:144, 167`, and the tests drive the same seam. The durable write is only the injected `appendSink`. No real store is touched, which is what keeps the gates hermetic.
- Vitest 4 warns when `vi.mock` is not at the module top level. `tests/agent-runtime/compaction-runtime.test.ts` logs the hoisting warning twice, and the mock still hoists correctly. The gates pass. A future vitest will turn the warning into an error.
## Certification Report

Certified: 2026-09-03T04:02:36.109Z
Signature: 273788756693879f2d207795397d66bffe9c67f1cc194f4e61c30f17c1b76b02

### Summary

Slices: 4
Symbols: 8
Gates: 15

### Implemented Symbols

- **S01** (Compaction trigger policy):
  - lib/server/agent-runtime/compaction.ts::resolveCompactionSettings
  - lib/server/agent-runtime/compaction.ts::measureDriverContextTokens
- **S02** (Summarizer and entry writer contract):
  - lib/server/agent-runtime/compaction.ts::generateCompactionSummary
  - lib/server/model-routes.ts::LLM_STAGES
- **S03** (transformContext wiring and read path):
  - lib/server/agent-runtime/compaction.ts::makeCompactionRuntime
  - lib/server/agent-runtime/runner.ts::runSession
- **S04** (Compaction safety and observability):
  - lib/server/agent-runtime/compaction.ts::makeCompactionRuntime
  - lib/server/agent-runtime/entry-tree-storage.ts::loadSessionEntryHistory

### Gates Passed

- **S01**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/compaction-trigger.test.ts \u001b[2m(\u001b[22m\u001b[2m16 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 3\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m16 passed\u001b[39m\u001b[22m\u001b[90m (16)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:51:23\n\u001b[2m   Duration \u001b[22m 184ms\u001b[2m (transform 22ms, setup 15ms, import 111ms, tests 3ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/runner-contract.test.ts \u001b[2m(\u001b[22m\u001b[2m2 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 1\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:51:24\n\u001b[2m   Duration \u001b[22m 1.02s\u001b[2m (transform 482ms, setup 13ms, import 949ms, tests 1ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/agent-driver-model.test.ts \u001b[2m(\u001b[22m\u001b[2m13 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 64\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m13 passed\u001b[39m\u001b[22m\u001b[90m (13)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:51:25\n\u001b[2m   Duration \u001b[22m 153ms\u001b[2m (transform 43ms, setup 14ms, import 19ms, tests 64ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G04: {"id":"G04","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S02**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/compaction-summary.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 94\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:51:36\n\u001b[2m   Duration \u001b[22m 173ms\u001b[2m (transform 22ms, setup 12ms, import 11ms, tests 94ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/server/model-routes.test.ts \u001b[2m(\u001b[22m\u001b[2m30 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 19\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m30 passed\u001b[39m\u001b[22m\u001b[90m (30)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:51:36\n\u001b[2m   Duration \u001b[22m 112ms\u001b[2m (transform 35ms, setup 13ms, import 24ms, tests 19ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/entry-tree-storage.test.ts \u001b[2m(\u001b[22m\u001b[2m7 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m3 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[32m 6\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m3 skipped\u001b[39m\u001b[90m (7)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:51:37\n\u001b[2m   Duration \u001b[22m 400ms\u001b[2m (transform 200ms, setup 14ms, import 326ms, tests 6ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G04: {"id":"G04","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S03**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/compaction-runtime.test.ts \u001b[2m(\u001b[22m\u001b[2m8 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 16\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m8 passed\u001b[39m\u001b[22m\u001b[90m (8)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:51:48\n\u001b[2m   Duration \u001b[22m 195ms\u001b[2m (transform 29ms, setup 14ms, import 109ms, tests 16ms, environment 0ms)\u001b[22m\n\nWarning: A vi.mock(\"@/lib/ai/llm\") call in \"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC/tests/agent-runtime/compaction-runtime.test.ts\" is not at the top level of the module. Although it appears nested, it will be hoisted and executed before any tests run. Move it to the top level to reflect its actual execution order. This will become an error in a future version.\nSee: https://vitest.dev/guide/mocking/modules#how-it-works\nWarning: A vi.mock(\"@/lib/server/resolve-model\") call in \"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC/tests/agent-runtime/compaction-runtime.test.ts\" is not at the top level of the module. Although it appears nested, it will be hoisted and executed before any tests run. Move it to the top level to reflect its actual execution order. This will become an error in a future version.\nSee: https://vitest.dev/guide/mocking/modules#how-it-works\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/entry-tree-storage.test.ts \u001b[2m(\u001b[22m\u001b[2m7 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m3 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[32m 5\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m3 skipped\u001b[39m\u001b[90m (7)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:51:48\n\u001b[2m   Duration \u001b[22m 381ms\u001b[2m (transform 180ms, setup 13ms, import 307ms, tests 5ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S04**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/compaction-safety.test.ts \u001b[2m(\u001b[22m\u001b[2m6 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 15\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m6 passed\u001b[39m\u001b[22m\u001b[90m (6)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:52:00\n\u001b[2m   Duration \u001b[22m 392ms\u001b[2m (transform 180ms, setup 14ms, import 306ms, tests 15ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/compaction-safety.test.ts \u001b[2m(\u001b[22m\u001b[2m6 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m4 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[32m 7\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m4 skipped\u001b[39m\u001b[90m (6)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:52:01\n\u001b[2m   Duration \u001b[22m 381ms\u001b[2m (transform 174ms, setup 14ms, import 301ms, tests 7ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/lint-llm-entry-guard.test.ts \u001b[2m(\u001b[22m\u001b[2m32 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 1469\u001b[2mms\u001b[22m\u001b[39m\n     \u001b[33m\u001b[2m✓\u001b[22m\u001b[39m blocks the named import in every guarded path (.ts) \u001b[33m 874\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m32 passed\u001b[39m\u001b[22m\u001b[90m (32)\u001b[39m\n\u001b[2m   Start at \u001b[22m 15:52:02\n\u001b[2m   Duration \u001b[22m 1.64s\u001b[2m (transform 16ms, setup 12ms, import 98ms, tests 1.47s, environment 0ms)\u001b[22m\n\n","passed":true}
  - G04: {"id":"G04","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}

Certification hash: 273788756693879f2d207795397d66bffe9c67f1cc194f4e61c30f17c1b76b02
Certified: 2026-09-03T04:02:36.109Z | Signature: 273788756693879f2d207795397d66bffe9c67f1cc194f4e61c30f17c1b76b02 | Certifier: verifier
