# Batch 008 spec soundness review

Reviewer: independent spec-soundness reviewer. The reviewer did not write the
spec. The reviewer read the code on 2026-09-03.

Reviewed documents:

- `docs/meta-specs/rivr-stage-generation.md` (draft)
- `docs/specs/008-stage-generation-throughput.md` (draft)
- `docs/specs/009-agent-context-compaction.md` (draft)
- `docs/specs/007-agent-session-friction.md` (closed)

Method: gate dry-runs, contract symbol audit, assumption probes against the
shipped code, and a contradiction hunt. No code changed. No ledger written.

## Verdict

Blocked. Three blockers must return to the spec author before approval.

## BLOCKERS

### B1. S01 does not make a running page observable. User story 1 is unmet.

- Spec: `docs/specs/008-stage-generation-throughput.md` lines 59 to 71 (S01
  postcondition) and lines 35 to 36 (user stories 1 and 2).
- Evidence: the only live progress surface while a tool runs is the collapsed
  card line derived by `sceneProgress`.
  `components/workbench/chat/tool-progress.ts:52-53` matches only
  `generating content|llm[scene-content` and `generating actions|llm[scene-actions`.
  No code in `lib/` emits those substrings today.
  The S01 emission form `generate_scene phase <name>` cannot match the rail.
  With no match the rail stays on the first step (`tool-progress.ts:57-58`).
  The expanded card body renders trace lines only when
  `!running && traces.length > 0` (`components/workbench/chat/tool-card.tsx:258`).
  So a running 12-minute page shows the same fixed line as today.
  The meta spec records the identical risk (`docs/meta-specs/rivr-stage-generation.md`
  lines 36 and 87) and says the spec text must align them before certification.
  The 008 text does not do it. The rail is not an S01 target.
- Recommended fix (exact wording): amend S01 as follows.
  Add receiver `components/workbench/chat/tool-progress.ts` :: `sceneProgress`
  (kind function, existing, line 40).
  Add to the S01 postcondition: "The rail regexes at
  `components/workbench/chat/tool-progress.ts:52-55` gain the alternatives
  `generate_scene phase content`, `generate_scene phase actions`, and
  `generate_scene phase persist`. The existing alternatives `generating content`,
  `llm[scene-content`, `generating actions`, and `llm[scene-actions` stay."
  Add gate G05 (unit): `npx vitest run tests/workbench/tool-progress.test.ts`
  expect `passed`.

### B2. The fetch layer carries a 5-minute cap below the heartbeat ceiling.

- Spec: `docs/specs/008-stage-generation-throughput.md` lines 26, 37, and 232
  (user story 3 and the acceptance targets).
- Evidence: undici defaults `headersTimeout` and `bodyTimeout` to `300e3` ms
  (`node_modules/.pnpm/undici@7.22.0/node_modules/undici/lib/dispatcher/client.js:253-254`).
  The LLM fetch path uses `globalThis.fetch` with no timeout and no dispatcher
  override (`lib/ai/providers.ts:2142` and `lib/ai/providers.ts:1887,1894,1897,1906`).
  No `AbortSignal.timeout` exists in `lib/ai/`.
  The agent route handlers set no `maxDuration`
  (`app/api/agent/sessions/[id]/route.ts:11`, `app/api/agent/sessions/route.ts:23`,
  `app/api/agent/runtime/route.ts:16`).
  A provider that sends no bytes for 5+ minutes aborts the fetch.
  `generateText` throws. `callLLM` surfaces the error with `maxRetries: 0`
  (`lib/server/agent-runtime/generation-ai-call.ts:30`).
  The heartbeat resets only at phase boundaries, not per token.
  The reference session survived the caps, which is consistent with the
  streaming-compat path (`fetchCustomOpenAIChat` rewrites `stream:false` to
  SSE at `lib/ai/providers.ts:1906-1913`), but the 007 transcript records two
  real `Headers Timeout Error` rows (007 spec lines 11, 140), so the caps do
  fire on this deployment.
- Recommended fix (exact wording): amend S02, Implementation Decisions, add:
  "A provider silent for 5 or more minutes fails the fetch before the heartbeat
  can act. The same change must raise or disable the undici `headersTimeout`
  and `bodyTimeout` on the LLM fetch path, or the tandem run must prove that
  the SSE keep-alive path resets both timers."

### B3. The S04 target symbol sits in a `.mjs` file that rivr cannot capture.

- Spec: `docs/specs/008-stage-generation-throughput.md` lines 160 to 163
  (target symbol `scripts/check-stage-completion.mjs :: main`).
- Evidence: the capture source table lists `.rs`, `.md`, `.markdown`, `.txt`,
  `.text`, `.ts`, `.tsx`, `.js`, `.jsx`
  (`rivr-ledger/SOURCES.md` extension table). An unknown extension exits 1 and
  names the extension. `.mjs` is not listed. The installed CLI is `rivr 0.16.0`.
  The before-state capture for the slice would fail at ledger build.
- Recommended fix (exact wording): rename the script to
  `scripts/check-stage-completion.js`, keep an exported `main`, and update the
  four references in 008 (lines 160, 162, 173, and the gates at 192 to 195) and
  the one reference in the meta spec (line 60). If the rename is refused,
  record the S04 contract as gate-only with no captured symbol.

## CONCERNS

### C1. A ceiling abort will not match the pinned abort string.

The ceiling abort fires at 45 minutes. The error message uses the running
budget (`lib/agent/runtime/tool-timeout.ts:63-75`). It would say
`exceeded its 2700000ms execution budget` and would not contain the pinned
string `exceeded its 900000ms execution budget and was aborted`.
The S04 gate scans only that string (008 lines 168 and 186). The meta
acceptance pins the same string (meta line 79). A 45-minute ceiling abort is
the exact failure the tandem protocol must detect (meta line 58).
Fix: scan the stable fragment `execution budget and was aborted` in the gate
and in the meta acceptance text. Pin in S02 that the ceiling message keeps
that fragment.

### C2. The gate start marker is not defined.

S04 scans for abort rows "with a timestamp after the gate's start marker"
(008 lines 168, 174). The meta repeats the phrase (meta lines 58, 60).
No marker is defined. The gate is read-only and no write happens during the run
(meta line 52), so the marker cannot be a row the gate writes.
Fix: define it in S04. "The start marker is the `ts` of the first lifecycle
event of the finishing session. Scan only rows with that session id and with
`ts` at or after the marker."

### C3. The adversarial flag `--expect-incomplete` is not in the script contract.

S04 G04 runs `node scripts/check-stage-completion.mjs --expect-incomplete`
and expects the exit code 0 through the `echo` marker (008 line 195).
The postcondition lists no flag semantics (008 lines 171 to 175).
Without the flag the script must exit nonzero on the incomplete database.
With the flag the gate needs exit 0. That inversion is implementation-defined.
Fix: add to the S04 postcondition: "The option `--expect-incomplete` inverts
the outcome. The script exits 0 when the database does not match the pinned
inventory, and still prints the per-stage diff."

### C4. The meta spec has no operator step that enables compaction.

009 ships the flag default OFF (009 lines 24, 225, 235). The tandem run must
flip it with environment (meta line 71). The meta Start Conditions and Run
steps (meta lines 54 to 56) name no env step and no restart step.
A run without the flip shows no compaction entry and fails meta acceptance.
Fix: add to the meta Start Conditions: "Set
`OPENMAIC_AGENT_COMPACTION_ENABLED=true` in `.env.local`, add a
`MODEL_ROUTES` entry for `maic-agent-compaction`, and restart `pnpm dev`
before the run."

### C5. S02 gates omit the existing wrapper test that the change edits.

The change edits `executeWithToolBound`
(`lib/agent/runtime/tool-timeout.ts:111-201`). The direct unit pin
`tests/lib/agent/runtime/tool-timeout.test.ts` exists and asserts timeout,
cancel, update-forwarding, and timer cleanup. It is not in the S02 gate list
(008 lines 117 to 121). A regression there passes certification.
Fix: add gate: `npx vitest run tests/lib/agent/runtime/tool-timeout.test.ts`
expect `passed`.

### C6. S01 G03 references a test file that does not exist.

`tests/workbench/session-store.test.ts` is absent today. The gate is
`npx vitest run tests/workbench/session-store.test.ts -t "trace"` (008 line 83).
A new file satisfies the RED-first rule, but the spec does not mark it new.
The `-t "trace"` filter must name at least one test, or vitest exits 1.
Fix: mark the file new in Testing Decisions (008 line 211) and pin one test
name that carries the literal `trace`.

## MINOR

### M1. Behavior sentences sit inside postconditions.

The S01, S02, and S04 postconditions carry behavior that rivr diff cannot see
(008 lines 62, 101 to 102, 174 to 175). Diff compares signatures only. The
behavior belongs in Per-target success expectations. This matches the 007
precedent, so it is a style note, not a gate risk.
Fix: move the behavior sentences to the success expectations.

### M2. The 009 env-example citation drifts by four lines.

009 cites `.env.example:397-403` (009 line 11). The compaction flags sit at
`.env.example:401-403`. The 007 citation for the tool timeout knob at
`.env.example:395` is exact. No functional impact.
Fix: correct the citation.

### M3. The ratio knob is future work.

008 says the ceiling is configurable through the
`OPENMAIC_AGENT_TOOL_TIMEOUT_MS` mechanism family "if an operator wants a
different ratio later" (008 line 200). Today only the base budget env exists
(`.env.example:395`). The sentence is forward-looking, not a promise.
No change needed.

## Verified accurate

The following probes passed.

- Gate oracles. Vitest prints `Tests  N passed`. The `passed` substring fits.
  The `npx tsc --noEmit && echo TSC_OK` pattern is the live doctrine.
  All new test files named in 008 and 009 are absent today, so the gates are
  RED-first.
- Contract anchors. `buildGenerationTools` at
  `lib/server/agent-runtime/generation-tools.ts:221`. `generateScene.execute`
  declared `async execute(_callId, params, signal)` at line 232 with no fourth
  parameter. `withAgentToolTimeout` at
  `lib/agent/runtime/tool-timeout.ts:98`, overrides at lines 38 to 45,
  single `setTimeout` at line 188, `guardedUpdate` at lines 190 to 194.
  `runSession` at `runner.ts:889`.
- Pi tool contract. The 4th parameter exists:
  `execute(callId, params, signal?, onUpdate?)` at
  `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:328`, with
  `AgentToolUpdateCallback` at line 317. S01 is implementable as specced.
  The `transformContext` seam exists at `build-agent.ts:55` and is passed at
  line 69. Pi calls it at `dist/agent-loop.js:175-176`.
- Trace channel. `emit` persists through `appendEvent`
  (`runner.ts:960-1044`). Only `message_update` is throttled (lines 1028 to
  1032). `tool_execution_update` drops `args` and `partialResult` (lines 244
  to 249). The subscriber forwards every event
  (`emit(event.type, event)` at lines 1506 to 1507). The fold case is
  `session-store.ts:1184-1203` with `TRACE_RING_MAX = 200` (line 692).
  Replay keeps the trace ring (`session-store.ts:1758, 1815-1817`).
- Completion gate schema. `agent_session_events (session_id, seq, ts, attempt,
  type, data JSONB)` at `packages/@openmaic/storage/src/agent-session/pg.ts:126-135`.
  `document_stages (id, name, folder_id, data)` at
  `packages/@openmaic/storage/src/document/pg.ts:76-86`.
  `document_scenes (stage_id, scene_order, data)` at
  `packages/@openmaic/storage/src/document/pg.ts:102-106`.
  The counts query is expressible. The abort string is findable with
  `data::text LIKE '%execution budget and was aborted%'`.
- Sequencing. 009 depends on 008 trace durability only. 008 declares it does
  not depend on 009 (008 line 31, meta line 18). No circularity.
  The tandem protocol maps each abort observation to a child slice (meta
  line 58).
- The 52-versus-50 handling matches. The gate uses 50 in 008 (lines 139, 203,
  226) and in the meta (lines 75, 76, 86). The flag surfaces the discrepancy.
- Provider neutrality. No new stage or vendor term enters a neutral file.
  The `scene-content:<type>` and `scene-actions` stages exist in `LLM_STAGES`
  (`lib/server/model-routes.ts:131-152`). The model-routes pin prints
  `toEqual` with the full list ending at `maic-agent-driver`
  (`tests/server/model-routes.test.ts` around lines 361 to 378).
- i18n claims. Trace lines render raw (`tool-card.tsx:263`). The rail labels
  use existing keys `workbench.tool.progress.scene.*`
  (`lib/i18n/workbench.ts:328-341`). No locale JSON change is needed.
- Config anchors. `MAX_SESSION_TEXT_LENGTH = 100_000` at
  `lib/server/agent-runtime/limits.ts:9`. The compaction parse at
  `lib/server/agent-runtime/config.ts:27-42`. The context window chain at
  `lib/server/agent-runtime/agent-driver-model.ts:39`. The read side anchors
  at `lib/server/agent-runtime/entry-tree-storage.ts:66-69, 119`.
- Environment behavior. The installed binary is `rivr 0.16.0` at
  `/Users/franky/.local/bin/rivr`. The `.env.local` loading claim was not
  re-verified. It is consistent with the 007 verbatim record (007 line 190).

## Bottom line

The watchdog, trace durability, plan-progress, and completion gate designs are
sound against the shipped code. The spec must close the live-observability
gap, the fetch-layer caps, and the `.mjs` capture gap before certification.