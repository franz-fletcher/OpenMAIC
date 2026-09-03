# Rivr Correctness for Course Artifacts (meta-spec)

Meta-spec status: draft, pending human approval

work_id: `feature:rivr-artifact-correctness`

## 1. Purpose

This meta-spec governs the work of bringing rivr-style correctness to the
class and course artifacts that the agent chat loop generates. It records the
assessed state of the loop, the rivr primitive mapping, the integration
decision, and the child batch register. Each child batch runs its own full
RIVR cycle with its own spec, ledger, and merge.

The central finding: the agent loop already contains partial analogs of most
rivr primitives. The right integration is not to run the rivr CLI inside the
server. It is to finish the native analogs of the two primitives with the
largest measured gaps, and to keep rivr as the dev-time governance layer for
every batch that hardens the loop.

## 2. Assessed architecture (verified 2026-09-02, HEAD 74edf8e4)

### 2.1 Main chat loop

The loop is a durable, Postgres-backed worker system.

| Step | Location | Fact |
| --- | --- | --- |
| Session create | `app/api/agent/sessions/route.ts:37` | Control plane only. A worker claims the session after the request returns. |
| User message | `app/api/agent/sessions/[id]/messages/route.ts:20` | Persists the message, returns 202. Never runs the model inline. |
| Event stream | `app/api/agent/sessions/[id]/events/route.ts:62` | SSE reads the durable event log. The log is the single source of truth. |
| Claim + run | `lib/server/agent-runtime/runner.ts:1861` | Poll loop claims sessions with a 10s lease, max 5 attempts. |
| LLM turn | `lib/agent/runtime/stream-fn.ts:258` | One `streamLLM` call per turn (`stopWhen: stepCountIs(1)`). The pi loop drives multi-step and executes tools. |
| Tool wrap | `lib/agent/runtime/build-agent.ts:77` | Every tool gets a timeout, an allowlist gate, and an after-hook. |
| Turn end | `runner.ts:1729-1789` | Idle win-down, then `finishSession`. Cancel and failure paths are explicit. |

Retry layers today: LLM wrapper connection retry (`lib/ai/llm.ts:384-473`),
tool timeout converted to a retryable error result
(`lib/agent/runtime/tool-timeout.ts:63-87`), session attempt cap
(`runner.ts:1070-1088`), transcript repair on resume
(`lib/server/agent-runtime/resume.ts:93-167`,
`lib/server/agent-runtime/tool-call-integrity.ts:109-182`).

### 2.2 Artifact writers

Course artifacts persist in Postgres (`document_scenes`, `document_stages`,
`document_outlines`). Media bytes persist on the local filesystem under
`data/classrooms/<stageId>/media`.

| Tool | Artifact | Pre-persist validation |
| --- | --- | --- |
| `generate_scene` (`generation-tools.ts:226`) | Scene | None at tool level. Store assert throws as a generic error. |
| `generate_actions` (`generation-tools.ts:491`) | Scene + audio | None at tool level. |
| `duplicate_scene` (`generation-tools.ts:559`) | Scene clone | None. |
| `patch_stage` (`dsl-tools.ts:771`) | Patched scene | Yes. `validationError` (`dsl-tools.ts:431-517`) runs before persist and returns a structured error. |
| `create_stage` (`curriculum-tools.ts:192`) | Stage envelope | Empty by construction. Idempotent deterministic id. |
| `set_roster` (`roster-tools.ts:202`) | Agent configs | Catalog membership only. No structural validation. |
| `rename_stage` / `move_to_folder` (`curriculum-tools.ts`) | Metadata | Name and owner checks only. |
| `generate_video` job (`generate-video.ts:312-367`) | Placeholder patch | Store boundary only. |
| `generate_image` (`generate-image.ts:195`) | Media bytes, no doc write | Provider gates. SHA-256 filename. |

Storage boundary: the owner-scoped store injects `validateAppScene` /
`validateAppStage` into every write (`lib/document-store/validators.ts:27-158`
via `pg.ts:1006`, `pg.ts:666`). Nothing reaches a stored document without
passing it. Only `patch_stage` converts those errors into structured model
feedback. Every other writer surfaces the assert as an opaque throw.

### 2.3 Existing correctness machinery

| Mechanism | Catches | Misses |
| --- | --- | --- |
| `tool-call-integrity.ts` | Provider-illegal transcripts, orphaned calls | Artifact semantics |
| `mutation-fence.ts` | Aborts inside persistence transactions | Payload correctness |
| `stage-limits.ts`, `limits.ts` | Size and name bounds | Content quality |
| `course-stage.ts:14-25` | Replay idempotency via SHA-256 derived ids | Provenance chain |
| `@openmaic/dsl` `validate.ts` | Structural shape of stages, scenes, actions, PBL, interactive content | Semantic and cross-scene invariants |
| `lib/document-store/validators.ts` | The write barrier for the scene union and actions | Structured feedback for most writers |
| TypeBox tool schemas | Type-invalid args before execute | `Type.Unknown` holes. See `widgetOutline` in batch 007. |

## 3. rivr primitive mapping

The six rivr correctness primitives, their runtime analogs, and status.

| rivr primitive | Runtime analog today | Status |
| --- | --- | --- |
| (a) Postcondition proven before persist | `validateAppScene` write barrier + `patch_stage` local proof | PARTIAL. Uniform invocation missing. |
| (b) Executable gates with expected output | None at runtime. Skill-constraint check is advisory (`generation-tools.ts:437-441`). | ABSENT |
| (c) Hash-chained provenance ledger | Session event log (append-only, monotonic seq) + entry tree transcript. Per session, not per artifact. | PARTIAL |
| (d) Generator / verifier separation | None. One model generates and reacts to rejections. | ABSENT |
| (e) Bounded retry budget with escalation | LLM connection retries, attempt cap, timeout budget. Nothing at artifact level. | PARTIAL |
| (f) Before/after capture (diff) | Entry tree preserves message appends. `DocumentVersionError` is a concurrency fence, not a diff. | ABSENT for documents |

Evidence for the gaps: production session 96cdbbfa (batch 007).
`generate_scene` rejected a stringified `widgetOutline` five identical times
because rejections were non-actionable and there was no per-artifact budget.
`set_roster` failed atomically on one bad voice and dumped 599 bindings into
the transcript. Transport errors surfaced with no visible recovery. All three
batch-007 fixes were reactive applications of exactly the missing primitives.

## 4. Integration decision

Three options were assessed against primary sources.

### Option A. Shell out to the rivr binary from the server runtime

REJECTED. Four independent disqualifiers:

1. Env leak hazard. The bun-compiled CLI auto-loads `.env.local` from its
   startup cwd into every gate child (documented in memory #36 and batch 007).
   Unacceptable in a server deployment.
2. No machine-consumable output. Verified from `--help` on v0.16.0: there are
   no `--json` or output-format flags. The contract is exit codes 0/1/2/3/4
   plus literal stdout substrings.
3. Actor and stage model mismatch. Gate runs are restricted to verifier or
   orchestrator identities and are blocked at stage=implementation. A server
   cannot honestly hold those identities.
4. Ledger paths derive from the startup cwd and serialize behind a file lock.
   A server would contend with itself.

### Option B. Port the rivr primitives natively, including a hash-chained artifact ledger

DEFERRED, conditional. Architecturally honest and the natural follow-on. The
postcondition engine already exists in `validate.ts` and
`lib/document-store/validators.ts`. What is new is a per-mutation content-hash
chain table in `@openmaic/storage`. Costs: a published-package change forces
a version bump and CI gate. The chain partially duplicates the session event
log. No corruption-forensics incident has yet demanded it. It becomes a live
batch the first time an operator needs to prove which tool call wrote a
document state.

### Option C. Dev-time rivr governance plus a thin native runtime gate

SELECTED. Two runtime primitives, both with proven patterns already in the
codebase:

1. Uniform validate-before-persist with structured feedback. Extend the
   `patch_stage` pattern (`dsl-tools.ts:827-834`) to every artifact writer.
   Each rejection returns a machine-readable code that names the failing path,
   in the shape of `invalid-widget-outline`.
2. Bounded artifact-retry budget with escalation. The runner counts
   consecutive validation rejections per artifact within a session. Past the
   budget the tool refuses with a different next action instead of an
   identical message: summarize and ask the user. This mirrors the existing
   attempt cap (`runner.ts:1070-1088`) and the retryable-error doctrine
   (`tool-timeout.ts:63-87`).

Rivr itself stays exactly where it has proven effective: the meta-spec and
ledger governance for each batch below.

Rationale: the loop's demonstrated failure modes (batch 007) map to primitives
(a) and (e). Option C closes those two with the least risk and reverts
nothing. Attack test: option C fails to help when an artifact is structurally
valid but semantically wrong. That failure class needs a verifier model pass
(primitive d), which is deliberately out of scope here because no evidence
yet shows it pays for itself.

### Weakest points of the selected option (recorded honestly)

1. No per-artifact hash chain. Forensics after a bad persist depend on
   replaying the session entry tree and event log. If "prove which tool call
   wrote this state" becomes a requirement, promote option B to a live batch.
2. Correctness still depends on model cooperation. Structured rejections plus
   an escalation budget mitigate the five-identical-rejections class but do
   not eliminate it. There is no runtime oracle asserting expected content.

## 5. Child batch register

Numbering continues the repo-wide sequence. Each batch gets its own spec in
`docs/specs/`, its own approval, its own ledger, and its own full cycle. No
batch starts before its spec is approved.

| # | Name | Primitives | Tier | Status |
| --- | --- | --- | --- | --- |
| 008 | `uniform-validate-before-persist` | (a) | 3 | PROPOSED |
| 009 | `artifact-retry-budget` | (e) | 3 | PROPOSED |
| 010 | `tool-schema-hole-audit` | (a) support | 2 | PROPOSED |
| cond | `artifact-provenance-ledger` | (c)(f) | 4 | CONDITIONAL, promote only on a forensics requirement (option B) |
| cond | `verifier-pass` | (d) | 4 | CONDITIONAL, promote only if semantically-valid-but-wrong artifacts are evidenced |

Scope notes for drafting the batch specs:

- 008: one shared structured validation-error helper. Wire it into
  `generate_scene`, `generate_actions`, `duplicate_scene`, `set_roster`,
  `rename_stage`, `move_to_folder`, and the video placeholder patch in
  `generate-video.ts`. Keep error codes stable contracts, like
  `invalid-widget-outline` in 007.
- 009: counter lives in the runner next to the existing call counting at
  `runner.ts:1493-1499`. Budget value is an operator-facing env knob added to
  `.env.example` in the same PR.
- 010: systematic audit of TypeBox tool params for `Type.Unknown` and
  `Type.Any` holes, plus a pinning test that rejects new holes, in the style
  of `tests/lint-llm-entry-guard.test.ts`.

## 6. Out of scope

- Running the rivr binary, its ledger format, or its gate runner inside the
  server or browser runtime.
- LLM-as-judge verification of artifact content.
- Editor-path validation (`lib/edit/content-validation.ts` wiring) beyond
  what batch 008 shares with the agent path.
- Changes to the pi loop, the stream contract, or `streamLLM` semantics.
- Provider-neutrality debt: none of 008-010 adds provider ids, so
  `tests/providers/provider-neutrality-guard.test.ts` counts stay pinned.

## 7. Governance and meta-ledger plan

- This document is the architecture record. It stays as the historical plan
  when reality diverges. Batch specs and research updates carry the deltas.
- On human approval, the orchestrator runs `rivr metaspec init` for this
  document, then `rivr metaspec amend --link <batch>:<ledger>` as each child
  batch lands, and `rivr metaspec certify` when the register is complete.
- Every ledger read and write goes through the rivr CLI. No direct JSON edits.
- Gate doctrine from prior batches applies: run gate-executing rivr commands
  from a neutral cwd with absolute ledger paths, use `bun --no-env-file` where
  the bun form is invoked, and use echo-marker oracles instead of exit-code
  expectations for silent-success commands.

## 8. Further notes

- Source assessment: remote-researcher report of 2026-09-02 against HEAD
  `74edf8e4`, plus batch 007 transcript evidence and memories #33, #36, #122,
  #125.
- The entry-tree storage comment (`tool-call-integrity.ts:105`) already calls
  the transcript "an immutable audit trail." That is the seam a future
  provenance ledger should extend rather than duplicate.
- If `@openmaic/storage` gains the provenance table (conditional batch),
  remember it is a published package: version bump in the same PR, and the
  app consumes built `dist/`.
