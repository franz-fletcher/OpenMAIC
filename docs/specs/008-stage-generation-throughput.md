# Batch 008 spec: stage-generation-throughput

Spec status: closed

## Outcome

All four slices verified. The batch reached its verified state in round 2. S01, S03, and S04 were rejected in round 1 and certified in round 2 after rework. S02 was certified in round 1 and carried to the final state. Commits: `7844d653` (S01-S04) and `919413dd` (round-2 contract alignment). Ledger chain valid at 45 entries at stage `research_update`.

## Problem Statement

Production course generation for ENGE503 Statics Cram Prep stalled in agent session `96cdbbfa-31c1-4d21-9398-ef9059d36b24`. The user approved a build of 7 stages and 52 pages at event seq 2285 with the text `Approve as written. Build all 7 stages, 52 pages, in order.` The session built 15 pages, then stopped making progress. The user cancelled the session.

Three facts describe the stall.

1. Stage 1 (8 pages) and Stage 2 (7 pages) are complete. Their scene rows and titles are in the database, in folder `folder-sEcSTrX-mp`. The approved per-page tables enumerate 8 rows for Stage 1 and 7 rows for each of Stages 2 through 7. The tables sum to 50 pages. The plan text and the approval both say 52. That 2-page discrepancy is unresolved and must be pinned before the completion gate can be final. This spec treats the tables as the authoritative inventory and flags the discrepancy as a decision point.
2. Stage 3 exists with 0 pages. Its page 1 (`Slide a force off its line, and pay the couple toll`, an interactive simulation) exceeded the 900000 ms `generate_scene` execution budget twice (`tool_execution_end` at seq 5728 and 5764, both with the text `Tool "generate_scene" exceeded its 900000ms execution budget and was aborted`). The retry at seq 5837 ran 842751 ms and was aborted by the user cancel. Stages 4 through 7 were never created.
3. The driver model turn at seq 5836 carried 307323 input tokens for one turn. The driver re-sends the full message history every turn, and the history had grown to 356 stored messages and roughly 1 MB of JSON. The `tool_execution_start` for the failed page at seq 5763 carries a large `widgetOutline` and a 1913-character brief.

The page-generation cost model is the key fact. One `generate_scene` call runs exactly two LLM round trips through `aiCallFor`. The first is content generation (`generateSceneContent`, staged `scene-content:<type>`), routed to `xiaomi:mimo-v2.5` in this deployment. The second is action generation (`generateSceneActions`, staged `scene-actions`), also `xiaomi:mimo-v2.5`. Both run through `callLLM` with `maxRetries: 0` (pinned in `generation-ai-call.ts:30`). Completed pages took 198 to 724 seconds. Interactive widget pages dominate the long tail, because the widget content call produces a complete self-contained HTML/JS widget. The two aborts hit the flat 900-second watchdog ceiling on an interactive page that was progressing, not hung. The watchdog design assumed it protects against hung calls. It now aborts slow-but-alive interactive generation. This is the throughput fault this batch fixes.

The driver-side 307K-token context has a second, separate effect. It raises the cost of every driver turn and degrades model steering quality as the session grows. `tool_execution_end` rows also show the driver model was `qwen:qwen3.8-flash` on the token-plan endpoint for `maic-agent-driver`.

This batch must also decide how to finish the approved build. The options are to resume the cancelled session (carrying the 307K-token transcript) or start a fresh session that rebuilds context from the durable checkpoints and the pinned plan, and generate only the missing pages.

## Solution

Five changes plus one operator decision.

1. **Phase-progress observability.** `generate_scene` emits a progress line at each phase boundary: content start, content end, actions start, actions end, persist. The line flows onto the running tool card in the workbench through the existing durable `trace` channel, and lands in `agent_session_events` with no new event type and no new vendor dependency. The collapsed-row progress rail learns the same vocabulary so a running card moves. Full trace lines render after the call settles; the running row shows the current phase.
2. **Watchdog progress-reset heartbeat plus fetch-layer cap fix.** The tool-timeout wrapper resets the execution deadline whenever the tool reports progress through the pi `onUpdate` callback, with a hard ceiling above the base budget. A progressing interactive widget page survives. A genuinely hung call still aborts. The same change must raise or disable the undici `headersTimeout` and `bodyTimeout` on the LLM fetch path, because a provider silent for 5 or more minutes fails the fetch before the heartbeat can act.
3. **Plan-progress helper.** A small pure module computes per-stage page counts against the pinned plan, used by the completion gate and by the operator when starting the finishing session.
4. **Live completion gate.** A script asserts the database matches the pinned per-stage inventory and that no budget-abort string appears in the event log after the gate's start. This is the tier-4 adversarial gate of the completion slice.
5. **Completion strategy decision.** Recommendation: Option B, a fresh agent session with the pinned plan embedded in its prompt, generating only the missing pages. The 307K-token transcript is the reason to discard resume. All durable state the finish needs lives in the database, not in the transcript.

The compaction runtime is NOT implemented in this batch. It is split explicitly into companion batch 009 with its own cycle. This is a deliberate split under RIVR rule 5, not a silent deferral. The read-side scaffolding exists (`entry-tree-storage.ts` compaction entry handling, `config.ts` compaction block, `agent-driver-model.ts` context-window pinning, `skills.ts` post-compaction transcript view, `build-agent.ts` `transformContext` hook). The write side does not exist: no trigger, no summarizer, no compaction entry writer. `agentRuntimeConfig.compaction` is parsed in `config.ts:27-42` and consumed nowhere. Batch 009 owns the full write path. Batch 008 does not depend on it, because the recommended completion strategy uses a fresh session whose driver context starts small.

## User Stories

1. As an operator, I watch a running `generate_scene` call report which phase it is in, so a 12-minute widget page does not look like a hang.
2. As an operator, I see the same sub-phase progress after a page refresh, so the replayed tool card tells the same story as the live one.
3. As an agent model, my long interactive widget generation completes instead of being aborted at 900 seconds, so the page persists on the first real attempt.
4. As an operator, I query one table to see exactly which stages and pages exist versus the approved plan, so the completion state is unambiguous.
5. As an operator, I run one script after the finishing build that answers yes or no on completion, so the gate is mechanical and repeatable.
6. As the planner, I start a fresh session whose prompt embeds the approved plan, so the finishing build does not pay the 307K-token transcript cost on every driver turn.
7. As the maintainer, I know that the compaction runtime is a separate batch with its own spec, so nothing in this batch silently assumes it exists.

## Slices

### S01 Phase-progress observability for generate_scene (tier 3)

**Target symbols.**

- `lib/server/agent-runtime/generation-tools.ts` :: `buildGenerationTools` (kind variable, the exported tool-set constructor at line 221).
- `lib/server/agent-runtime/tool-progress.ts` :: `traceMessageForUpdate` (kind function, new exported helper).
- `components/workbench/chat/tool-progress.ts` :: `sceneProgress` (kind function, existing, line 40).

**Before-state capture facts.**

- `generateScene.execute` is declared `async execute(_callId, params, signal)` at `generation-tools.ts:232`. It does not use the fourth parameter (`onUpdate`), and no phase information is emitted anywhere in the 900-second window. The only durable events around a call are `tool_execution_start`, `tool_execution_end`, and the final `checkpoint` after the page persists.
- The workbench already folds a running tool's progress. `lib/workbench/session-store.ts:1184-1203` (`case 'trace'`) appends `data.message` to the running tool card's `toolTraces` ring, capped at `TRACE_RING_MAX = 200` (session-store.ts:692). The `trace` lifecycle event is durable: `runner.ts` `emit()` calls `appendEvent()` for every non-throttled type, and the events route replays durable rows. So the observability channel exists end to end. Only the emission is missing.
- The runner's pi subscriber forwards every pi event through `emit(event.type, event)` at `runner.ts:1506-1507`. `tool_execution_update` events reach that subscriber with a `partialResult`, but `slimEventDataForLog` (`runner.ts:244-249`) strips `args` and `partialResult` from the durable copy. The workbench has no `tool_execution_update` fold case. It reads only `trace`.
- The derived rail is the only live progress surface while a tool runs. `sceneProgress` at `components/workbench/chat/tool-progress.ts:40` advances the collapsed card line only on the regexes at lines 52-55, which match `generating content|llm[scene-content` and `generating actions|llm[scene-actions`. The `generate_scene phase <name>` vocabulary matches neither, so without a rail change the running card stays pinned to its first step. The expanded card body renders trace lines only when the tool is finished (`tool-card.tsx:258`). `tests/workbench/tool-progress.test.ts` already pins the legacy patterns.
- Existing tests build the toolset through `deps(current.store)` and `find(tools, 'generate_scene')` (`tests/agent-runtime/generation-tools.test.ts:104-186`). The deps factory at line 89 sets `onCheckpoint: vi.fn()`.

**Postcondition (per target symbol).**

- `buildGenerationTools`: after-exists true. after-kind variable. Signature unchanged.
- `generate_scene.execute` accepts the fourth parameter and calls it at five phase boundaries with a short message: `content` start, `content` done, `actions` start, `actions` done, `persist`. The message text uses the form `generate_scene phase <name>`, e.g. `generate_scene phase content done`.
- `tool-progress.ts::traceMessageForUpdate`: after-exists true. after-kind function. after-signature `(update: ToolUpdateWithMessage): { message: string } | null`.
- `ToolUpdateWithMessage` is a minimal structural type declared in `lib/server/agent-runtime/tool-progress.ts`: an object with an optional unknown `partialResult`. It replaces the pi `ToolExecutionUpdateEvent` name because that type does not exist in the installed `pi-agent-core` dist types. The function maps an update whose `partialResult.message` is a non-empty string to that message, and null otherwise.
- `sceneProgress`: after-exists true. after-kind function. Signature unchanged. The rail regexes at `components/workbench/chat/tool-progress.ts:52-55` gain the alternatives `generate_scene phase content`, `generate_scene phase actions`, and `generate_scene phase persist`. The existing alternatives `generating content`, `llm[scene-content`, `generating actions`, and `llm[scene-actions` stay.

**Per-target success expectations.**

- A widget page's tool card shows at least the content and actions phase lines while running, live and after replay.
- The runner calls the mapping for `tool_execution_update` events and emits the resulting message on the `trace` channel without changing any other pi event behavior.
- `args` and `partialResult` remain stripped from durable `tool_execution_update` rows. The trace row carries the phase line instead.
- The existing `generate_scene` validation tests keep passing.

**Evidence strings.**

- Stalled call end text: `Tool "generate_scene" exceeded its 900000ms execution budget and was aborted`.
- Workbench trace fold: `case 'trace'` at `session-store.ts:1184`.
- Runner event forward: `emit(event.type, event)` at `runner.ts:1507`.

**Delivered versus spec.**

- The named type `ToolUpdateWithMessage` was added at `tool-progress.ts:1-7`, with `traceMessageForUpdate` at line 14. The contract originally named the pi type `ToolExecutionUpdateEvent`, which does not exist in the installed dist types. The round-1 verifier rejection pinned the deviation, and the clarification plus correction amends rebound the contract to the structural type.
- The five phase emissions are verified at `generation-tools.ts:396, 425-426, 433-434` through the `notify` helper at line 394: `content start`, `content done`, `actions start`, `actions done`, `persist`, each with the `generate_scene phase <name>` prefix.
- The runner mapping sits next to the pi forwarding line: `emit(event.type, event)` at `runner.ts:1507`, then `traceMessageForUpdate(event)` at `runner.ts:1509-1512` emits on the `trace` channel. `args` and `partialResult` stay stripped.
- The rail alternatives live at `components/workbench/chat/tool-progress.ts`: `generate_scene phase content` joins the `hasContent` regex, `generate_scene phase actions` joins `hasActions`, and `generate_scene phase persist` is the new `hasPersist` test. The legacy alternatives stay.

**Round-2 evidence.**

- 6 tests in `tests/agent-runtime/tool-progress.test.ts`, 18 in `tests/agent-runtime/generation-tools.test.ts` (3 of them in the `generate_scene phase progress` block at line 101), 2 in `tests/workbench/session-store.test.ts -t "trace"`, and 8 in `tests/workbench/tool-progress.test.ts`. The 6 plus 18 plus 2 plus 8 plus 3 grouping is the round-2 evidence line. All pass.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/tool-progress.test.ts` expect `passed`.
- G02 (unit): `npx vitest run tests/agent-runtime/generation-tools.test.ts` expect `passed`.
- G03 (integration, new file): `npx vitest run tests/workbench/session-store.test.ts -t "trace"` expect `passed`. The file does not exist today and must contain at least one test name carrying the literal `trace`, or vitest exits 1.
- G04 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.
- G05 (unit): `npx vitest run tests/workbench/tool-progress.test.ts` expect `passed`.

### S02 Watchdog progress-reset heartbeat (tier 3)

**Target symbol.**

- `lib/agent/runtime/tool-timeout.ts` :: `withAgentToolTimeout` (kind function, exported wrapper at line 98).

**Before-state capture facts.**

- The flat budget for `generate_scene` is pinned in `AGENT_TOOL_TIMEOUT_OVERRIDES` at `tool-timeout.ts:38-45`: `generate_scene: 15 * 60_000` and the same for `generate_actions` and `extract_material`.
- `executeWithToolBound` (`tool-timeout.ts:111-201`) sets one timer at line 188 (`setTimeout(onTimeout, timeoutMs)`) and never resets it. The `guardedUpdate` wrapper at lines 190-194 forwards updates only when the race is unsettled. It does not touch the timer.
- The two observed aborts were `899992 ms` and `900020 ms` (`tool_execution_end` seq 5728 and 5764), i.e. exactly at the flat ceiling, on a page whose content generation was running its normal widget pipeline. A flat raise only moves the cliff later.
- The fetch layer caps below the ceiling. undici defaults `headersTimeout` and `bodyTimeout` to `300e3` ms (`node_modules/.pnpm/undici@7.22.0/node_modules/undici/lib/dispatcher/client.js:253-254`). The LLM fetch path uses `globalThis.fetch` with no timeout and no dispatcher override (`lib/ai/providers.ts:2142` and `lib/ai/providers.ts:1887,1894,1897,1906`). No `AbortSignal.timeout` exists in `lib/ai/`. The agent route handlers set no `maxDuration` (`app/api/agent/sessions/[id]/route.ts:11`, `app/api/agent/sessions/route.ts:23`, `app/api/agent/runtime/route.ts:16`). The 007 transcript records two real `Headers Timeout Error` rows, so the caps fire on this deployment. The `generateText` throw surfaces through `callLLM` with `maxRetries: 0` (`generation-ai-call.ts:30`) as a tool error.

**Postcondition (per target symbol).**

- `withAgentToolTimeout`: after-exists true. after-kind function. after-signature `(tool: AgentTool): AgentTool` (unchanged, name and async stripped). The rivr diff gate is signature-only for this target, exactly as in the batch 001 through 006 precedent. Behavioral postconditions live in Per-target success expectations and are proven by the gates and the verifier round.
- When the wrapped tool calls its `onUpdate` callback, `executeWithToolBound` resets the deadline timer to the base `timeoutMs`. A hard ceiling of 3 times the base budget caps the total. The reset never extends past the ceiling.
- An update after the race settles is still dropped. A caller abort still wins the race exactly as before. A tool that never reports progress still aborts at the base budget.
- The timeout error text keeps the stable fragment `execution budget and was aborted` at the ceiling too, so the S04 scan and the tandem monitor detect a ceiling abort at any budget value.
- The undici `headersTimeout` and `bodyTimeout` are raised or disabled on the LLM fetch path used by scene generation, so a progressing stream is not killed at 300 s. The change touches `lib/ai/providers.ts` fetch wiring only; `callLLM` semantics, usage accounting, and the `LLM_THINKING_DISABLED` switch stay untouched.

**Per-target success expectations.**

- A tool that reports progress every few minutes exceeds the base budget and still completes.
- A tool that reports no progress still aborts at the base budget.
- A tool that reports progress past the ceiling aborts at the ceiling, and the abort message contains `execution budget and was aborted`.
- Caller cancellation still aborts immediately with `AgentToolAbortedError`.
- With the fetch-layer change active, a scene-generation request whose provider pauses bytes beyond 300 s does not fail with a headers or body timeout.

**Evidence strings.**

- Budget override: `generate_scene: 15 * 60_000` at `tool-timeout.ts:41`.
- Abort error text: `exceeded its 900000ms execution budget and was aborted`. The S02 change keeps the stable fragment `execution budget and was aborted` present at any budget value, including the 2700 s ceiling.
- Abort class name: `AgentToolTimeoutError` at `tool-timeout.ts:63`.

**Delivered versus spec.**

- The heartbeat lives inside `executeWithToolBound`. The `guardedUpdate` wrapper resets `deadlineTimer` to the base `timeoutMs` at `tool-timeout.ts:228-231`. The fixed 3x ceiling timer arms at line 211 with `HEARTBEAT_CEILING_MULTIPLIER = 3` (line 93) and raises `AgentToolTimeoutError(toolName, ceilingMs)` at line 216.
- The abort error text keeps the fragment `execution budget and was aborted` at every budget value (`tool-timeout.ts:69`), so the S04 scan detects a ceiling abort at 900000 ms or 2700000 ms alike.
- The undici no-timeout agent applies to BOTH wrappers in `lib/ai/providers.ts`: `new UndiciAgent({ headersTimeout: 0, bodyTimeout: 0 })` at lines 1888-1890, injected as the `dispatcher` at line 2154 (streaming-compat) and at line 2274 (Anthropic). `callLLM` stays untouched.
- Round-1 test hygiene: `tests/agent-runtime/tool-timeout-heartbeat.test.ts` attaches the rejection handler before advancing fake timers (lines 116, 149-150), because vitest 4 fakes `setTimeout` and the ceiling timer rejects during `advanceTimersByTimeAsync`. The repo caveat stands: vitest 4 does not fake `AbortSignal.timeout`.

**Round-2 evidence.**

- Certified in round 1 (2026-09-03T01:37) and carried to the final state. Round-2 rerun: 4 tests in `tests/agent-runtime/tool-timeout-heartbeat.test.ts`, 2 in `tests/agent-runtime/runner-tool-timeout-cancel.test.ts`, 9 in the existing `tests/lib/agent/runtime/tool-timeout.test.ts`, and 2 in `tests/ai/llm-fetch-timeouts.test.ts`. All pass plus the TSC smoke.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/tool-timeout-heartbeat.test.ts` expect `passed`.
- G02 (integration): `npx vitest run tests/agent-runtime/runner-tool-timeout-cancel.test.ts` expect `passed`.
- G03 (unit): `npx vitest run tests/lib/agent/runtime/tool-timeout.test.ts` expect `passed`. This existing suite pins the wrapper directly and must stay green.
- G04 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.
- G05 (unit, new file): `npx vitest run tests/ai/llm-fetch-timeouts.test.ts` expect `passed`. The test asserts the scene-generation fetch path carries raised or disabled undici `headersTimeout` and `bodyTimeout`, following the `tests/ai/llm-connection-retry.test.ts` mock-fetch precedent.

### S03 Plan-progress helper (tier 2)

**Target symbol.**

- `lib/server/agent-runtime/plan-progress.ts` :: `computePlanProgress` (kind function, new exported helper).

**Before-state capture facts.**

- The approved per-stage inventory lives only as markdown tables in the durable transcript (assistant message text at seq 2276) and in this spec. No code today computes a stage-progress report against it.
- The database facts are directly queryable: `document_stages (id, name, folder_id)`, `document_scenes (stage_id, id, scene_order, data)`. Folder `folder-sEcSTrX-mp` holds the three created stages. Stage 1 has 8 scenes, Stage 2 has 7, Stage 3 has 0.
- Built scene titles diverge from the plan titles (for example plan `Drag the angle, watch the components change` became built `Drag the angle, watch the components split`). The gate therefore asserts counts per stage, never title equality.

**Postcondition (per target symbol).**

- `computePlanProgress`: after-exists true. after-kind function. after-signature `(plan: StagePagePlan, stages: StagePageSummary[]): PlanProgressReport`. The canonical text is the prettier-wrapped multi-line form at 100 columns: `(
  plan: StagePagePlan,
  stages: StagePageSummary[],
): PlanProgressReport`.
- The report lists, per stage, the pinned page count, the actual scene count, and a `complete` boolean for each of missing, matching, and over-built states.
- The pinned plan default is the table inventory from the approved plan: Stage 1 = 8, Stages 2 through 7 = 7 each. The 52-versus-50 label discrepancy is surfaced as a flag on the report, not silently resolved.

**Per-target success expectations.**

- The report for the current database shows Stage 1 complete (8/8), Stage 2 complete (7/7), Stage 3 missing (0/7), Stages 4 through 7 absent.
- A stage with more scenes than pinned is reported as over-built, not complete.
- No database access happens inside the helper. The caller passes summaries in.

**Evidence strings.**

- Plan table totals line: `Totals: 7 stages, 52 pages, 20 interactive widgets, 9 quiz pages, 11 slide pages.` (the tables enumerate 50 rows: 34 interactive, 8 quiz, 8 slide).
- Folder id: `folder-sEcSTrX-mp`.
- Built Stage 2 page 2 title: `Slide r along the line, the moment refuses to move`.

**Delivered versus spec.**

- Unchanged from the plan. `computePlanProgress` ships at `plan-progress.ts:103` with the multi-line signature exactly as captured. The stored contract is the prettier-wrapped form, because tree-sitter stores TS signatures verbatim in their wrapped shape. The round-1 deficiency named the multi-line print. The round-2 postcondition makes the wrapped form canonical.

**Round-2 evidence.**

- 11 tests in `tests/agent-runtime/plan-progress.test.ts`, including the 8/8, 7/7, 0/7 fixture, the over-built case, and the 52-versus-50 flag. All pass plus the TSC smoke.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/plan-progress.test.ts` expect `passed`.
- G02 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S04 Live completion gate (tier 4)

**Target symbol.**

- `scripts/check-stage-completion.js` :: `main` (kind function, the exported entry of the new script. The contract is the printed output and exit code). The `.js` extension is mandatory: the rivr capture source table lists `.js` but not `.mjs`, and an unknown extension exits 1 at ledger build.

**Before-state capture facts.**

- No completion check exists. The verifier can only compare transcript rows by hand.
- The gate contract, pinned from the approved tables: Stage 1 = 8 pages, Stages 2 through 7 = 7 pages each, total 50. Other owner stages can live in the same folder. The script scopes to the ENGE503 folder by name match on stage names (`Stage 1:` through `Stage 7:`).
- The abort marker for the event-log assertion is the stable fragment `execution budget and was aborted`. The 900 s abort and the 2700 s ceiling abort both contain it; a scan pinned to `900000ms` would miss the ceiling abort this batch can now produce. A run that logs that fragment after the start marker fails.
- No start marker exists today. The gate is read-only, so it cannot write a marker row. The marker must be derived from the event log itself.
- The installed rivr is a bun binary that auto-loads `.env.local` from its startup cwd into gate children. The completion gate needs `DATABASE_URL`, so this gate must run from a cwd where `.env.local` is present, and the spec records that requirement in Further Notes.

**Postcondition (per target symbol).**

- `scripts/check-stage-completion.js`: after-exists true. after-kind function. after-signature `(argv)`. The database-injection test seam lives on a separate exported function; `main` takes only `argv`.
- The script reads `DATABASE_URL` from the environment, counts scenes per stage for the folder, compares against the pinned inventory, and scans `agent_session_events` for the fragment `execution budget and was aborted`. The start marker is the `ts` of the first lifecycle event of the finishing session, passed via `--session <id>`. The scan covers only rows with that session id and with `ts` at or after the marker.
- On full match with no aborts it prints the literal marker `COMPLETION_GATE_PASS` and exits 0. On any mismatch it prints `COMPLETION_GATE_FAIL` plus a per-stage diff and exits nonzero.
- The option `--expect-incomplete` inverts the outcome. The script exits 0 when the database does not match the pinned inventory, and still prints the per-stage diff.

**Per-target success expectations.**

- main(argv) parses the CLI flags. The database-injection test seam lives on a separate exported function, never on main. main reads the environment or a module-level seam set by the exported runner, not an extra main parameter.
- A database with 8/7/7/7/7/7/7 scenes in the seven named stages and no fresh budget-abort rows passes.
- A database missing any page count fails with the diff.
- A database with an abort-fragment row after the start marker fails.
- `--expect-incomplete` against the pre-finish database exits 0 and prints the known 8/7/0 diff.
- The script is idempotent and read-only against the database.

**Evidence strings.**

- Abort fragment: `execution budget and was aborted`.
- Approval text: `Approve as written. Build all 7 stages, 52 pages, in order.` (seq 2285).
- Folder id: `folder-sEcSTrX-mp`.

**Delivered versus spec.**

- The seam moved to the exported `runWithConnection(clientFactory, argv)` at `scripts/check-stage-completion.js:238` (exported at line 374). `main(argv)` at line 336 matches the frozen `(argv)` contract. The round-1 deficiency (a second optional parameter) was stripped by commit `919413dd`.
- No-session mode derives the most-recent session marker (`:243-265`) so the abort scan scopes to the finishing session. Historical aborts in older sessions cannot false-flag a clean finish. This round-2 behavior fix came from the operator's own live report.
- G04 live evidence, run read-only against the pre-finish database after certification: `mode: most-recent-session=96cdbbfa-31c1-4d21-9398-ef9059d36b24 marker=1788328456138`, then `COMPLETION_GATE_FAIL` with the per-stage diff `8/8, 7/7, 0/7 x5, total 15 (pinned 50)`, `ABORT DETECTED`, then `GATE_REACHABLE` with exit 0 under `--expect-incomplete`. The ABORT DETECTED line is correct: the derived marker belongs to the original stalled session, which contains its own historical aborts after its start.

**Round-2 evidence.**

- 21 tests in `tests/agent-runtime/completion-gate.test.ts`, plus the shared 11 in `tests/agent-runtime/plan-progress.test.ts`. The adversarial G04 ran live with `.env.local` sourced and reached the real schema (see Delivered versus spec).

**Proposed gates (cwd: repo root for every gate, and the adversarial gate needs `.env.local`).**

- G01 (integration): `npx vitest run tests/agent-runtime/completion-gate.test.ts` expect `passed`.
- G02 (unit): `npx vitest run tests/agent-runtime/plan-progress.test.ts` expect `passed`.
- G03 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.
- G04 (adversarial): `node scripts/check-stage-completion.js --expect-incomplete && echo GATE_REACHABLE` expect `GATE_REACHABLE`. The adversarial property is that the gate reaches a live read-only database check and, against the pre-finish database, reports the known incomplete state without crashing, while asserting the abort-fragment scanner runs.

## Implementation Decisions

- **Observability seam is the existing `trace` channel.** `LIFECYCLE.trace` already flows from `emit` in `runner.ts`, is durable, is folded onto the running tool card in `session-store.ts:1184`, and is replayed. Batch 008 adds emission only. No new event type and no new vendor dependency. The runner subscriber maps the surviving `message` from a `tool_execution_update` to a trace via the new `traceMessageForUpdate` helper, so the phase line is durable without re-adding `args` or `partialResult` to the log.
- **Heartbeat lives in the watchdog wrapper, not in each tool.** `withAgentToolTimeout` resets the deadline on `onUpdate`, so every tool gets the behavior for free. The ceiling is 3 times the base budget; only the base budget env exists today, and a ratio knob is future work, not a promise. `generate_scene` keeps its 15-minute base from the override map but now survives past it while it reports progress.
- **The fetch layer is part of the heartbeat fix.** A provider silent for 5 or more minutes fails the fetch before the heartbeat can act: undici defaults `headersTimeout` and `bodyTimeout` to 300 s and the LLM path sets neither. The same change must raise or disable the undici `headersTimeout` and `bodyTimeout` on the LLM fetch path, or the tandem run must prove that the SSE keep-alive path resets both timers. The raising option is the one that can be certified hermetically, so the slices take it. Streaming-compat (`lib/ai/providers.ts:1906-1913`) already rewrites `stream:false` to SSE, which keeps bytes flowing and is consistent with the reference session surviving 12-minute calls; the caps remain the acute failure for any provider silence, and 007 recorded them firing twice.
- **Budget policy is progress-reset heartbeat, not a flat raise and not per-phase budgets.** A flat raise moves the cliff later and rewards hung calls. Per-phase budgets add machinery for a two-phase pipeline whose phases are already covered by the mid-call updates, and the observed 842 s success-vs-abort spread shows the ceiling, not the phase split, is the fault. The heartbeat is grounded in the cost model: the content round trip legitimately exceeds 900 s on widget pages, and those calls were progressing at abort time.
- **No model-route change in code.** The cost model shows content and actions both use `xiaomi:mimo-v2.5`. An operator who wants a faster content phase can tune `MODEL_ROUTES` `scene-content` or add `scene-content:interactive`. This batch does not hardcode a vendor or a model. Provider neutrality holds.
- **Completion gate pins counts, not titles.** The agent paraphrased titles on the fly, so the completion contract is per-stage scene counts, verified by SQL counts plus the event-log abort assertion. The 52-versus-50 label discrepancy is reported, not resolved, and appears on the operator's decision list.
- **Fresh session, not resume, is the recommended finish path.** The 307K-token driver context is the concrete cost of resume. Every resumed driver turn re-sends the full history through `streamLLM`. The durable checkpoint architecture (`resume.ts`, 11 `session_resumed` rows) makes a fresh session cheap: the database already holds stages, scenes, roster, and materials, and this spec pins the plan that the fresh prompt embeds. `POST /api/agent/sessions` accepts a prompt up to `MAX_SESSION_TEXT_LENGTH = 100_000` characters (limits.ts:9), and the plan text is far below that.
- **Compaction is companion batch 009, stated explicitly.** The read-side scaffolding exists. The write side (trigger, summarizer, entry writer) does not. `agentRuntimeConfig.compaction` is dead configuration (`config.ts:27-42`, no consumers). Implementing a compaction runtime here roughly doubles the batch and adds a second risk axis. Splitting is the rule-5 process, not silent deferral. Batch 008's finish works without it because the fresh session starts with a small driver context.
- **Repository constraints honored.** Every new model call flows through `callLLM`/`streamLLM`. This batch adds no LLM call, so the entry guard and provider-neutrality debt tables stay untouched. No `packages/@openmaic` changes, so no version bumps. All gates are hermetic except the completion gate, which needs `DATABASE_URL` and is documented accordingly.
- **No i18n keys.** Tool card phase lines are generated diagnostics, agent-facing and operator-facing, matching the batch 006 and 007 precedent. No locale JSON changes.
- **Postconditions freeze at the research edge.** Contract text corrections must ride `rivr spec amend --action correction`. The clarification action only rebinds the hash. The round-1 rejections proved it: the pi-type name fix, the wrapped-signature fix, and the `main(argv)` fix each needed a correction-level amend before re-capture (`spec_amend` entries 2026-09-03T01:52 and 02:00).
- **Tree-sitter stores multi-line TS signatures verbatim.** The stored postconditions for `sceneProgress` and `computePlanProgress` embed the pretty-printed wrapped text. Wrapped captures are canonical, not a deviation to flatten.
- **Slice expectation text has a 300-character cap.** Drafting during staging hit the cap. The staging worktree scheme never touched the main ledger and was abandoned. Expectations ride the ledger directly.

## Testing Decisions

- S01 test homes: `tests/agent-runtime/tool-progress.test.ts` for the mapping helper with the exact pi `tool_execution_update` shapes. The postcondition type name is `ToolUpdateWithMessage`. And additions to `tests/agent-runtime/generation-tools.test.ts` asserting the tool calls `onUpdate` at each phase with the exact message prefix `generate_scene phase`. A `tests/workbench/session-store.test.ts` case (new file, test name carries the literal `trace`) folds a synthetic trace sequence and asserts the running card's `toolTraces` ring gains the lines, proving the workbench surface. `tests/workbench/tool-progress.test.ts` gains cases pinning that the `generate_scene phase <name>` lines advance the rail and that the legacy patterns still advance it.
- S02 test home: `tests/agent-runtime/tool-timeout-heartbeat.test.ts`, using fake timers with a configurable base budget, asserting three cases: progress restarts the timer, silence aborts at base, and the ceiling binds total time. The runner cancel-linkage gate reruns the existing `runner-tool-timeout-cancel.test.ts` to prove caller cancellation is untouched. `tests/lib/agent/runtime/tool-timeout.test.ts` stays green unchanged. The fetch-cap change lands with a new `tests/ai/llm-fetch-timeouts.test.ts` asserting the raised or disabled undici timeouts on the LLM fetch path.
- S03 test home: `tests/agent-runtime/plan-progress.test.ts`, with a fixture `StagePageSummary` list reflecting the current database (8/7/0/absent) and mutated cases (over-built, partial, foreign stages ignored). The 52-versus-50 flag is asserted on the exact pinned default.
- S04 test home: `tests/agent-runtime/completion-gate.test.ts`, driving `check-stage-completion.js` against an in-memory or fenced staging database with `PG_CONTRACT_URL` semantics where available, asserting pass/fail/diff output shapes and the abort-string scanner.
- Gate oracle doctrine: expect strings are literal substrings of stdout plus stderr. Silent-success commands echo a literal marker. No regex oracles. Every gate pins `cwd` to the repo root. The tier-4 adversarial gate is defensive: it proves the gate executes against the live schema and reports the pre-finish incomplete state, while the final live completion run happens after the operator finishes the build and is recorded as a fresh gate execution by the verifier.
- Zero paid gates. The completion gate hits a local database only. All other gates are hermetic.
- **Two pre-existing failures are allowed.** `tests/server/classroom-media-generation.test.ts` and `tests/agent-runtime/runner-skills-registration.test.ts` are outside batch scope. `runner-skills-registration` deterministically fails its registered-tool-set assertion (36 vs 34 tools) when the gate runner inherits `.env.local` provider keys. Neither failure is attributable to batch 008.
- **Zero-env hermeticity proof.** The unit gates pass with no environment. The proof runs a gate from a neutral cwd such as `/tmp` with the absolute ledger path, so the bun-built rivr loads no `.env.local`, and the outcome matches the repo-root run.
- **Gate doctrine as executed.** Silent-success gates echo literal markers (`&& echo TSC_OK`, `&& echo GATE_REACHABLE`). The adversarial G04 ran from the repo root with `.env.local` sourced in the same shell before `node scripts/check-stage-completion.js --expect-incomplete`.

## Out of Scope

- The compaction runtime. Split to companion batch 009. This batch ships no summarizer, no trigger, and no compaction entry writer.
- Resuming the cancelled session with its 307K-token transcript. The recommended finish path is a fresh session. The operator decision point below is where the human ratifies that.
- Changing the model routes or adding vendor-specific tuning for `xiaomi:mimo-v2.5`. Operator-side `MODEL_ROUTES` tuning is documented, not coded.
- Per-phase budget splitting into independent watchdog windows, beyond the heartbeat's ceiling.
- TTS synthesis behavior inside `generate_scene`. `generate_scene` does not synthesize narration. `generate_actions` does, and that tool's budget is untouched.
- Any `packages/@openmaic` change and any i18n change.
- The 2-page discrepancy between the plan label (52) and the tables (50). The gate uses 50. The human resolves whether two pages are added to the inventory.
- The live PASS run of the completion gate. S04 certified the mechanism (GATE_REACHABLE plus inversion), not course completion. The finishing build still has to happen.

## Further Notes

- **Gate env hygiene.** The installed rivr is a bun binary that loads `.env.local` from its startup cwd into gate children. Every gate in this spec pins `cwd` to the repo root, so `.env.local` is present when a gate needs it. The tier-4 `G04` gate for S04 runs from the repo root because it reads `DATABASE_URL`. A verifier that wants hostile-env proof runs the S01 to S03 gates from a neutral cwd such as `/tmp` with absolute paths. Those gates need no environment. The completion gate cannot run without the database and must be documented as the one gate that legitimately consumes `.env.local`.
- **The finishing build is operator-driven.** After the human approves the completion strategy, the operator creates a fresh session via `POST /api/agent/sessions` with a prompt that names the folder, states that Stages 1 and 2 are complete, embeds the pinned stage and page inventory, and asks the agent to build Stages 3 through 7 in order. The completion gate then verifies the result. The exact prompt text is a deliverable of implementation, not this spec.
- **Per-page and total time targets.** After the heartbeat, the per-page wall-time target is at most 15 minutes for interactive widget pages and at most 6 minutes for slide and quiz pages, with the 45-minute ceiling as the absolute bound. The remaining build is 35 pages under the table inventory (Stages 3 through 7). At the observed 198 to 724 second per-page spread, a 35-page build completes in roughly 4 to 8 hours of continuous agent runtime. The gate does not assert wall time. It asserts the database result and the absence of fresh budget aborts.
- **Decision points for the human.** (1) Completion strategy: Option A resume versus Option B fresh session. This spec recommends B. (2) Budget policy: flat raise versus progress-reset heartbeat versus per-phase budgets. This spec recommends heartbeat. (3) Compaction: in-batch versus companion batch 009. This spec recommends 009, stated explicitly under rule 5. (4) The 52-versus-50 page-count label discrepancy. The gate uses the table inventory of 50 until the human rules otherwise. (5) Per-page and total time targets as acceptance guidance, refinable after the first finished build.
- **Session evidence stays reproducible.** The transcript of session `96cdbbfa-31c1-4d21-9398-ef9059d36b24` is the reference artifact. Timing pairs, abort texts, and the plan tables are recoverable from `agent_session_events`.
- **Cross-batch dependency.** Batch 009 (compaction) consumes the same `trace` durability and reuses `plan-progress.ts` if it wants a pre-compaction progress snapshot. Nothing in batch 008 blocks 009.
- **The tandem completion protocol is unchanged.** The operator-driven finishing build stays queued behind batch 009. Compaction remains batch 009's write-path scope.
- **The tandem acceptance marker.** The finishing session passes when `scripts/check-stage-completion.js --session <finishing session id>` prints `COMPLETION_GATE_PASS` and exits 0. That live PASS has not run yet against a finished build.

## Deviations and Surprises

- The pi type `ToolExecutionUpdateEvent` does not exist in the installed `pi-agent-core` dist types. The contract's first draft named it. The clarification and correction amends replaced it with the structural `ToolUpdateWithMessage`.
- Prettier re-wraps TS signatures past 100 columns. Tree-sitter stores the wrapped text verbatim, so the round-1 single-line expectation collided with the stored multi-line form. Wrapped text is canonical.
- The ceiling abort text carries the dynamic budget value (2700000 ms), not the pinned `900000ms` string. The fragment rule keeps `execution budget and was aborted` stable so scans still match.
- Unhandled rejections flip a gate process to exit 1 before the oracle can match. The completion script guards its own `main(argv)` promise with a `FATAL:` catch (`check-stage-completion.js:360-364`). Heartbeat tests attach rejection handlers before advancing fake timers.
- Without a session marker the abort scan false-flags aborts from older sessions. Round 2 derives the most-recent session marker from `agent_session_events` to scope the scan.
- `rivr ledger init-batch` is orchestrator-only. The researcher's refusal to run it was correct. The CLI enforces the role boundary.
- Verification has no stage edge back to research. The correction amend is the only return path for contract text. Round-1 rejections came home through `spec_amend`, never a reopen.
- The S04 script must be `.js`. The rivr capture source table lists `.js` but not `.mjs`, and an unknown extension exits 1 at ledger build. Hence `scripts/check-stage-completion.js`.
## Certification Report

Certified: 2026-09-03T02:36:26.099Z
Signature: 8c278af20ed264e8e51afa57305bad6b22e05e42b92a4d1377dcdca37edd59d2

### Summary

Slices: 4
Symbols: 6
Gates: 16

### Implemented Symbols

- **S01** (Phase-progress observability for generate_scene):
  - lib/server/agent-runtime/generation-tools.ts::buildGenerationTools
  - lib/server/agent-runtime/tool-progress.ts::traceMessageForUpdate
  - components/workbench/chat/tool-progress.ts::sceneProgress
- **S02** (Watchdog progress-reset heartbeat and fetch-layer cap fix):
  - lib/agent/runtime/tool-timeout.ts::withAgentToolTimeout
- **S03** (Plan-progress helper):
  - lib/server/agent-runtime/plan-progress.ts::computePlanProgress
- **S04** (Live completion gate):
  - scripts/check-stage-completion.js::main

### Gates Passed

- **S01**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/tool-progress.test.ts \u001b[2m(\u001b[22m\u001b[2m6 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 2\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m6 passed\u001b[39m\u001b[22m\u001b[90m (6)\u001b[39m\n\u001b[2m   Start at \u001b[22m 14:20:46\n\u001b[2m   Duration \u001b[22m 88ms\u001b[2m (transform 18ms, setup 16ms, import 10ms, tests 2ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n\u001b[90mstdout\u001b[2m | tests/agent-runtime/generation-tools.test.ts\u001b[2m > \u001b[22m\u001b[2mgenerate_scene phase progress\u001b[2m > \u001b[22m\u001b[2mrenumbers scenes and outline entries together for reorder and delete\n\u001b[22m\u001b[39m[2026-09-03T02:20:47.871Z] [INFO] [ServerProviderConfig] [ServerProviderConfig] Loaded (server-providers.yml): 3 LLM, 1 TTS, 1 ASR, 1 PDF, 0 Image, 1 Video, 2 WebSearch providers\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/generation-tools.test.ts \u001b[2m(\u001b[22m\u001b[2m18 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 16\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m18 passed\u001b[39m\u001b[22m\u001b[90m (18)\u001b[39m\n\u001b[2m   Start at \u001b[22m 14:20:46\n\u001b[2m   Duration \u001b[22m 1.31s\u001b[2m (transform 582ms, setup 14ms, import 1.22s, tests 16ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/workbench/session-store.test.ts \u001b[2m(\u001b[22m\u001b[2m2 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 2\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m\n\u001b[2m   Start at \u001b[22m 14:20:48\n\u001b[2m   Duration \u001b[22m 171ms\u001b[2m (transform 82ms, setup 15ms, import 91ms, tests 2ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G04: {"id":"G04","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/workbench/tool-progress.test.ts \u001b[2m(\u001b[22m\u001b[2m8 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 3\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m8 passed\u001b[39m\u001b[22m\u001b[90m (8)\u001b[39m\n\u001b[2m   Start at \u001b[22m 14:20:48\n\u001b[2m   Duration \u001b[22m 139ms\u001b[2m (transform 55ms, setup 13ms, import 60ms, tests 3ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G05: {"id":"G05","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S02**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/tool-timeout-heartbeat.test.ts \u001b[2m(\u001b[22m\u001b[2m4 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 5\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m\u001b[90m (4)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:37:29\n\u001b[2m   Duration \u001b[22m 201ms\u001b[2m (transform 26ms, setup 17ms, import 116ms, tests 5ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n\u001b[90mstdout\u001b[2m | tests/agent-runtime/runner-tool-timeout-cancel.test.ts\u001b[2m > \u001b[22m\u001b[2mrunner: global tool-call execution bound\u001b[2m > \u001b[22m\u001b[2mends a never-settling tool call with a timeout error result and keeps the session alive\n\u001b[22m\u001b[39m[2026-09-03T01:37:31.750Z] [INFO] [ServerProviderConfig] [ServerProviderConfig] Loaded (server-providers.yml): 3 LLM, 1 TTS, 1 ASR, 1 PDF, 0 Image, 1 Video, 2 WebSearch providers\n\n\u001b[90mstdout\u001b[2m | tests/agent-runtime/runner-tool-timeout-cancel.test.ts\u001b[2m > \u001b[22m\u001b[2mrunner: global tool-call execution bound\u001b[2m > \u001b[22m\u001b[2mends a never-settling tool call with a timeout error result and keeps the session alive\n\u001b[22m\u001b[39m[2026-09-03T01:37:36.750Z] [INFO] [AgentRunner] session session-1 -> succeeded (attempt 1, 1 tool calls)\n\n\u001b[90mstdout\u001b[2m | tests/agent-runtime/runner-tool-timeout-cancel.test.ts\u001b[2m > \u001b[22m\u001b[2mrunner: cancel of a hung tool\u001b[2m > \u001b[22m\u001b[2msettles the session as cancelled promptly without waiting for the tool\n\u001b[22m\u001b[39m[2026-09-03T01:37:36.769Z] [INFO] [AgentRunner] session session-1 -> cancelled (attempt 1, 1 tool calls)\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/runner-tool-timeout-cancel.test.ts \u001b[2m(\u001b[22m\u001b[2m2 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 22\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:37:30\n\u001b[2m   Duration \u001b[22m 1.49s\u001b[2m (transform 636ms, setup 14ms, import 1.40s, tests 22ms, environment 0ms)\u001b[22m\n\n\u001b[90mstderr\u001b[2m | tests/agent-runtime/runner-tool-timeout-cancel.test.ts\u001b[2m > \u001b[22m\u001b[2mrunner: global tool-call execution bound\u001b[2m > \u001b[22m\u001b[2mends a never-settling tool call with a timeout error result and keeps the session alive\n\u001b[22m\u001b[39m[2026-09-03T01:37:31.750Z] [ERROR] [AgentRunner] session session-1: message update prune failed TypeError: store.pruneMessageUpdates is not a function\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/lib/server/agent-runtime/runner.ts:976:23\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/lib/server/agent-runtime/runner.ts:921:14\n\n\u001b[90mstderr\u001b[2m | tests/agent-runtime/runner-tool-timeout-cancel.test.ts\u001b[2m > \u001b[22m\u001b[2mrunner: global tool-call execution bound\u001b[2m > \u001b[22m\u001b[2mends a never-settling tool call with a timeout error result and keeps the session alive\n\u001b[22m\u001b[39m[2026-09-03T01:37:31.750Z] [ERROR] [AgentRunner] session session-1: message update prune failed TypeError: store.pruneMessageUpdates is not a function\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/lib/server/agent-runtime/runner.ts:976:23\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/lib/server/agent-runtime/runner.ts:921:14\n\n\u001b[90mstderr\u001b[2m | tests/agent-runtime/runner-tool-timeout-cancel.test.ts\u001b[2m > \u001b[22m\u001b[2mrunner: global tool-call execution bound\u001b[2m > \u001b[22m\u001b[2mends a never-settling tool call with a timeout error result and keeps the session alive\n\u001b[22m\u001b[39m[2026-09-03T01:37:36.750Z] [ERROR] [AgentRunner] session session-1: message update prune failed TypeError: store.pruneMessageUpdates is not a function\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/lib/server/agent-runtime/runner.ts:976:23\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/lib/server/agent-runtime/runner.ts:921:14\n\n\u001b[90mstderr\u001b[2m | tests/agent-runtime/runner-tool-timeout-cancel.test.ts\u001b[2m > \u001b[22m\u001b[2mrunner: global tool-call execution bound\u001b[2m > \u001b[22m\u001b[2mends a never-settling tool call with a timeout error result and keeps the session alive\n\u001b[22m\u001b[39m[2026-09-03T01:37:36.750Z] [ERROR] [AgentRunner] session session-1: message update prune failed TypeError: store.pruneMessageUpdates is not a function\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/lib/server/agent-runtime/runner.ts:976:23\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/lib/server/agent-","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/lib/agent/runtime/tool-timeout.test.ts \u001b[2m(\u001b[22m\u001b[2m9 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 7\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m9 passed\u001b[39m\u001b[22m\u001b[90m (9)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:37:32\n\u001b[2m   Duration \u001b[22m 131ms\u001b[2m (transform 22ms, setup 12ms, import 56ms, tests 7ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G04: {"id":"G04","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/ai/llm-fetch-timeouts.test.ts \u001b[2m(\u001b[22m\u001b[2m2 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 2\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:37:32\n\u001b[2m   Duration \u001b[22m 185ms\u001b[2m (transform 54ms, setup 11ms, import 117ms, tests 2ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G05: {"id":"G05","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S03**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/plan-progress.test.ts \u001b[2m(\u001b[22m\u001b[2m11 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 3\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m11 passed\u001b[39m\u001b[22m\u001b[90m (11)\u001b[39m\n\u001b[2m   Start at \u001b[22m 14:21:00\n\u001b[2m   Duration \u001b[22m 96ms\u001b[2m (transform 22ms, setup 15ms, import 14ms, tests 3ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S04**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/completion-gate.test.ts \u001b[2m(\u001b[22m\u001b[2m21 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 4\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m21 passed\u001b[39m\u001b[22m\u001b[90m (21)\u001b[39m\n\u001b[2m   Start at \u001b[22m 14:21:13\n\u001b[2m   Duration \u001b[22m 108ms\u001b[2m (transform 33ms, setup 16ms, import 25ms, tests 4ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/plan-progress.test.ts \u001b[2m(\u001b[22m\u001b[2m11 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 3\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m11 passed\u001b[39m\u001b[22m\u001b[90m (11)\u001b[39m\n\u001b[2m   Start at \u001b[22m 14:21:13\n\u001b[2m   Duration \u001b[22m 97ms\u001b[2m (transform 20ms, setup 15ms, import 14ms, tests 3ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
  - G04: {"id":"G04","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"mode: most-recent-session=96cdbbfa-31c1-4d21-9398-ef9059d36b24 marker=1788328456138\nCOMPLETION_GATE_FAIL\nPer-stage diff:\n  Stage 1: 8/8 ok\n  Stage 2: 7/7 ok\n  Stage 3: 0/7 MISMATCH\n  Stage 4: 0/7 MISMATCH\n  Stage 5: 0/7 MISMATCH\n  Stage 6: 0/7 MISMATCH\n  Stage 7: 0/7 MISMATCH\nTotal scenes: 15 (pinned: 50, diff: -35)\nABORT DETECTED: agent_session_events contains the abort-fragment text after the marker.\nGATE_REACHABLE\n","passed":true}

Certification hash: 8c278af20ed264e8e51afa57305bad6b22e05e42b92a4d1377dcdca37edd59d2
Certified: 2026-09-03T02:36:26.099Z | Signature: 8c278af20ed264e8e51afa57305bad6b22e05e42b92a4d1377dcdca37edd59d2 | Certifier: verifier
