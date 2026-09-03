# Meta-spec: rivr-stage-generation

Spec status: draft

## Purpose

This meta-spec runs two child batches and one live completion activity for the ENGE503 course build. The batches are 008 (stage generation throughput) and 009 (agent context compaction). The live completion is the tandem protocol. The meta-spec is the parent record and the architecture record for the agent runtime as it stands after both batches land.

The destination state: the ENGE503 Statics Cram Prep course has all 7 stages and the pinned page inventory built and visible in openMAIC. The agent runtime reports phase progress during `generate_scene`, survives slow interactive pages through the watchdog heartbeat, compacts driver context so a 35 page build does not repeat the 307K token failure, and finishes the course through a fresh session driven by the human in the workbench.

## Child Batches

| Batch | Kind | Scope | Depends on | Sequence |
| --- | --- | --- | --- | --- |
| 008 | bugfix:stage-generation-timeout | Phase progress observability for `generate_scene` (S01), watchdog progress-reset heartbeat (S02), plan progress helper (S03), live completion gate (S04), fresh session completion strategy. See `docs/specs/008-stage-generation-throughput.md`. | none | first |
| 009 | feature:agent-context-compaction | Compaction write side: trigger policy (S01), summarizer writing compaction entries through the entry tree via a `callLLM` stage route (S02), `transformContext` wiring with raw delivery cursors (S03), safety and observability (S04). See `docs/specs/009-agent-context-compaction.md`. | 008 | second |

Dependency edges: 009 reuses the trace durability that 008 ships (S01 phase lines and S04 compaction trace lines). 009 does not depend on the completion strategy. 008 does not depend on 009: the fresh session starts with a small driver context, so compaction is not needed for the finish. The split is batch 004 doctrine rule 5, recorded in 008.

The strict sequence is: 008 cycle complete, 009 cycle complete, tandem live completion, meta certify. The tandem run is a meta level acceptance activity. It is not a blocking gate inside either child certification. The children certify hermetic. The tandem run validates them in the hostile environment.

## Architecture Record

The agent runtime state after 008 and 009, with file:line anchors verified by reading code on 2026-09-03.

### Driver turn assembly

The runner claims a session and builds the driver turn in `runSession` (`lib/server/agent-runtime/runner.ts:889`). At claim it opens the entry tree (`runner.ts:942-951`) and loads the history: `loadEntryHistory` at `runner.ts:1143` returns `modelMessages` from `loadSessionEntryHistory` at `runner.ts:1164`. The plan decides start versus continue (`planResume`, `runner.ts:1144`). The model is resolved once: `resolveAgentDriverModel` at `runner.ts:1262` returns the pi model with the context window pin (`lib/server/agent-runtime/agent-driver-model.ts:39`). `buildAgent` runs at `runner.ts:1461` with `model: driver.piModel` (`runner.ts:1473`) and `history: modelMessages` on continue (`runner.ts:1492`). A pi subscriber forwards every event: `emit(event.type, event)` at `runner.ts:1506-1507`. Every finalized message appends to the durable tree on the serial write chain: `entrySession!.appendMessage` at `runner.ts:1518-1519`.

### Entry tree

The tree is a package owned append only structure. The runner adapter is `AgentSessionEntryStorage` (`lib/server/agent-runtime/entry-tree-storage.ts:163`) over `@openmaic/storage`. `loadSessionEntryHistory` (`entry-tree-storage.ts:43-121`) walks the branch, validates compaction entries (`entry-tree-storage.ts:64-73` requires `firstKeptEntryId` to point backward), finds the latest compaction entry (`entry-tree-storage.ts:76`), and slices the context view (`entry-tree-storage.ts:77-108`). The view the model sees is `messages`. The raw append only stream is `cursorMessages` (`entry-tree-storage.ts:119`). The storage entry shape is `AgentSessionCompactionEntry` (`packages/@openmaic/storage/src/agent-session/types.ts:224-228`). It carries `type: 'compaction'`, `firstKeptEntryId`, optional `summary`, on the base `id/parentId/timestamp/type` fields.

### Trace channel

The trace channel is durable and replayable. The runner emits every non throttled event through `emit` (`runner.ts:983-1044`) and `appendEvent` persists it on the ordered chain (`runner.ts:960-981`). Only `message_update` is throttled (`runner.ts:1028-1032`). `slimEventDataForLog` strips `args` and `partialResult` from durable `tool_execution_update` rows (`runner.ts:244-249`). The workbench folds `trace` onto the running tool card at `lib/workbench/session-store.ts:1184-1203`, capped at `TRACE_RING_MAX`. The card renders traces at `components/workbench/chat/tool-card.tsx:92`: the collapsed row shows one derived progress line while running (`tool-card.tsx:187-195`), and the full lines render in the expanded body only after the tool finishes (`tool-card.tsx:258-265`). The derived rail for `generate_scene` matches the trace lines `generating content|llm[scene-content` and `generating actions|llm[scene-actions` (`components/workbench/chat/tool-progress.ts:52-53`). The amended 008 S01 makes the rail learn the `generate_scene phase <name>` vocabulary alongside the legacy patterns, so the running card moves. The reference session 96cdbbfa carries no trace rows today.

### Watchdog

Every tool runs through `withAgentToolTimeout` (`lib/agent/runtime/tool-timeout.ts:98`), applied in `buildAgent` (`lib/agent/runtime/build-agent.ts:77`). `generate_scene` carries a 15 minute base budget in `AGENT_TOOL_TIMEOUT_OVERRIDES` (`tool-timeout.ts:38-45`). Batch 008 S02 adds the progress reset heartbeat: an `onUpdate` callback resets the deadline to the base budget, and a hard ceiling of 3 times the base caps the total. A progressing interactive page survives past 900 seconds. A silent call still aborts at the base. S02 also raises or disables the undici `headersTimeout` and `bodyTimeout` on the LLM fetch path, because undici's 300 second defaults kill a silent provider before any heartbeat acts (`lib/ai/providers.ts` uses `globalThis.fetch` with no dispatcher override).

### Compaction read side (shipped before 009)

The read side ships. `loadSessionEntryHistory` consumes compaction entries. The hooks exist. `agentRuntimeConfig.compaction` is parsed (`lib/server/agent-runtime/config.ts:27-42`) and consumed nowhere. `buildPiDriverModel` documents the context window chain and compaction reservation (`agent-driver-model.ts:34-44`). `resolveAgentDriverModel` exposes `reservedOutputTokens` (`agent-driver-model.ts:84-89`). `buildAgent` accepts `transformContext` (`build-agent.ts:55`, passed at `:69`) and no caller passes it. The resume wiring reads intent from durable rows, never from the compaction view (`runner.ts:1694-1703`). The skill loaders treat the transcript as the post compaction view (`lib/server/agent-runtime/skill-preload.ts:73-76,215-217`, `lib/server/agent-runtime/skills.ts:518-520`).

### Compaction write side (009)

009 adds the write side. The reference implementation is `createDirectorCompactionRuntime` (`lib/chat/pi/director-compaction.ts:106-233`), which wraps pi primitives: `shouldCompact`, `estimateContextTokens`, `prepareCompaction`, `findCutPoint`, and the canonical `Session.appendCompaction` (`node_modules/@earendil-works/pi-agent-core/dist/harness/session/session.js:134`). Pi invokes `transformContext` before each LLM call (`dist/agent-loop.js`, `messages = await config.n(messages, signal)`). The 009 summarizer diverges from the director on one hard point: the director uses pi `generateSummary` with a raw model and api key, which bypasses `callLLM`. The 009 summarizer calls `callLLM` with a new provider neutral stage. The write lands through the runner's critical chain, so a failed write trips lease loss exactly like a message write.

## Tandem Completion Protocol

Roles: the human drives the openMAIC pro workbench UI at `http://localhost:3000/workspace`. The orchestrator monitors read only with `psql` against `agent_session_events` and `agent_session_entries`, scoped to the fresh session id. No code change and no write to the database happens during the run.

Start conditions: 008 certified, 009 certified, and the orchestrator has pre-staged the fresh session. Pre-stage means: the pinned plan text embedded in the session prompt, the folder `folder-sEcSTrX-mp` named, Stages 1 and 2 marked complete, Stages 3 through 7 requested in order, and the workspace URL handed to the human. The prompt respects `MAX_SESSION_TEXT_LENGTH` (`lib/server/agent-runtime/limits.ts:9`). Before the run, set `OPENMAIC_AGENT_COMPACTION_ENABLED=true` in `.env.local`, add a `MODEL_ROUTES` entry for the `maic-agent-compaction` stage, and restart `pnpm dev`. Without that flip the run shows no compaction entry and fails meta acceptance.

Run: the human opens the URL, launches the session, and watches the tool cards. The orchestrator watches the event stream live: phase lines appear on `generate_scene`, no budget abort text appears, per page times stay inside targets, and the final `session_end` reports `succeeded`.

Abort criteria map observations to child slices. A budget abort fragment (`execution budget and was aborted`) after the gate start maps to 008 S02. No phase lines on a long page maps to 008 S01. A rail stuck on its first step while phases log maps to the 008 S01 rail alternative. A driver turn that still exceeds the window after compaction maps to 009 S01 and S03. Repeated summarizer failures or tree errors map to 009 S02 and S04. A page past the 45 minute ceiling maps to 008 S02. Any of these aborts the tandem run and returns the observation to the owning slice. The gate start marker is the `ts` of the first lifecycle event of the finishing session.

Meta acceptance: a fresh execution of `scripts/check-stage-completion.js --session <finishing session id>` prints `COMPLETION_GATE_PASS` and exits 0. The per page times observed in the event log stay inside the time targets. The compaction entry appears in the tree with the flags enabled. No row carrying `execution budget and was aborted` appears for the finishing session at or after the start marker. Then the orchestrator certifies the meta ledger.

## ADR List

The meta ledger holds these records under `docs/adrs/`.

- heartbeat-over-flat-raise: 008 S02 chooses the progress reset heartbeat with a 3 times ceiling over a flat raise or per phase budgets.
- trace-channel-reuse: 008 S01 reuses the durable `trace` channel instead of a new event type or vendor.
- fresh-session-completion: 008 finishes the build in a fresh session with the plan embedded, not by resuming the 307K token transcript.
- compaction-write-side-placement: 009 writes through pi `Session.appendCompaction` on the runner critical chain, and summarizes through `callLLM` with the `maic-agent-compaction` stage, never through pi `generateSummary`.
- tandem-validation-model: the live human paced build validates both batches in production, while child gates stay hermetic.
- compaction-default-off: 009 ships the flag default OFF. The tandem run flips it with environment and orchestrator monitoring.

## Acceptance Parameters

- Per stage inventory from the approved tables: Stage 1 = 8, Stages 2 through 7 = 7 each, total 50. The tables are authoritative.
- The 52 versus 50 page label discrepancy stays an open human pin. The completion gate uses 50 until the human rules.
- Per page wall time: at most 15 minutes for interactive widget pages, at most 6 minutes for slide and quiz pages, with 45 minutes as the absolute ceiling.
- Total band: a 35 page build (Stages 3 through 7) fits roughly 4 to 8 hours of continuous agent runtime.
- The event log after the gate start marker carries no budget abort text. The scanned fragment is `execution budget and was aborted`, which covers both the 900 s base abort and the 2700 s ceiling abort. The marker is the `ts` of the first lifecycle event of the finishing session.
- The tandem session completes with the completion gate PASS and observable compaction.

## Open Risks

- Widget phase timing attribution is unmeasurable until 008 S01 lands. Before S01, the event log has no phase timing rows, so a long page cannot be attributed to content or actions.
- Compaction quality degradation: a summary can drop facts the driver needs. The keep recent tail and the focus prompt mitigate it, and the tandem run observes it directly.
- The 52 versus 50 discrepancy is unresolved. The gate counts tables, the plan text says 52.
- The workbench progress rail gap is closed by the amended 008 S01: the rail learns the phase vocabulary and `tests/workbench/tool-progress.test.ts` pins both the new and legacy patterns. The remaining display limit is honest and stated: full trace lines render after the call settles, while the running row shows the current phase.
- Token accounting: the last assistant usage block of a run can be all zero (`agent_session_entries` message blobs, 96cdbbfa). The trigger must use the trailing heuristic fallback, not the last block alone.

## Further Notes

- The reference session is `96cdbbfa-31c1-4d21-9398-ef9059d36b24`. It holds 359 entries, 141 turns, and 137 nonzero assistant usage blocks. The max input token count is 307323.
- The orchestrator monitors by read only `psql`. Secret values stay in `.env.local` and never appear in artifacts.
- Child gates run hermetic with the cwd pinned to the repo root. The completion gate is the one legitimate database consumer.