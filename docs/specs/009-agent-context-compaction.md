# Batch 009 spec: agent-context-compaction

Spec status: draft

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

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/compaction-trigger.test.ts` expect `passed`.
- G02 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

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

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/compaction-summary.test.ts` expect `passed`.
- G02 (unit): `npx vitest run tests/server/model-routes.test.ts` expect `passed`.
- G03 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

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
- **Default OFF, tandem flips it.** `OPENMAIC_AGENT_COMPACTION_ENABLED` stays default OFF. The `.env.example:397-403` wording changes in the same PR to describe live semantics while keeping the OFF default, per the repo rule for operator facing vars. The tandem run sets it true with orchestrator monitoring. The new env flags have no effect on existing tests because the parse defaults to false.
- **Observability is the existing trace channel.** One `LIFECYCLE.trace` emit per compaction with before and after counts. The line is durable and replayable. No new event type and no i18n keys: the text is operator facing diagnostics.
- **Repository constraints honored.** No `packages/@openmaic` changes. No provider vendor term enters a neutral file, so `tests/providers/provider-neutrality-guard.test.ts` debt counts stay untouched. Prettier 100 columns. No i18n keys.

## Testing Decisions

- Test homes: `tests/agent-runtime/compaction-trigger.test.ts` for settings floors and the zero usage fallback, using the reference session evidence shape. `tests/agent-runtime/compaction-summary.test.ts` mocks `callLLM` and asserts the stage resolution. `tests/agent-runtime/compaction-runtime.test.ts` drives the full runtime against an in memory pi `Session` and asserts the round trip through `loadSessionEntryHistory`. `tests/agent-runtime/compaction-safety.test.ts` asserts failure returns, no write on failure, one trace line per compaction, and the unchanged rejection paths.
- The read side gains its first compaction coverage in `tests/agent-runtime/entry-tree-storage.test.ts`, which today has none.
- `tests/server/model-routes.test.ts:361-378` is re-pinned with the new stage.
- Gate oracle doctrine: expect strings are literal substrings of stdout plus stderr. Silent success commands echo a literal marker: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`. The adversarial gate names its test with the literal `summarizer failure`. Every gate pins the cwd to the repo root and is hermetic.
- Zero paid gates. The summarizer tests mock `callLLM`. No gate touches the database.

## Out of Scope

- Requiring the tandem run for this batch's certification. Gates are hermetic. The tandem run is the verifier round hostile environment validation, per batch 005 doctrine.
- Changing `generate_scene` internals. That is 008 territory.
- Enabling compaction by default. The flag stays OFF. The tandem run flips it.
- Changing the read side. `entry-tree-storage` already consumes compaction entries. This batch adds tests, not behavior.
- Reusing pi `generateSummary` or any direct provider call. All model calls flow through `callLLM`.
- Branch summaries and multi branch tree restructures. One linear compaction entry per judgment.
- Schema migrations. The storage type carries the compaction entry already.
- Any `packages/@openmaic` change and any i18n change.

## Further Notes

- Cross batch: 009 reuses the trace durability 008 ships. Nothing in 008 depends on 009. The fresh session completion starts with a small context, so 008 finishes without compaction.
- Operator setup: enabling compaction requires `OPENMAIC_AGENT_COMPACTION_ENABLED=true` and a `MODEL_ROUTES` entry for `maic-agent-compaction`. The driver route stays unchanged.
- The reference session 96cdbbfa remains the evidence artifact for token shapes. Its last assistant usage block is all zero, which is the fallback case S01 pins.
- Verifier note: all 009 gates are hermetic, so a hostile env run can execute them from a neutral cwd with absolute paths. The bun compiled rivr loads `.env.local` from its startup cwd, so gates that must stay clean run from a neutral cwd.
- Soundness expectation: the soundness review at the human checkpoint dry runs every gate against the current CLI and dry runs the round trip against the shipped reader.