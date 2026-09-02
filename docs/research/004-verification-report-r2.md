# Verification report: batch 004 happyhorse i2v and r2v media input (round 2)

Verifier: independent, no authorship. Date 2026-09-02.
Ledger: `.rivr/specs/004-video-i2v-r2v.ledger.json`. Spec: `docs/specs/004-video-i2v-r2v.md`. Branch: `feat/happyhorse-i2v-r2v`.

## Verdict

**Batch NOT fully verified. 4 of 5 slices verified. S05 rejected.** One root cause remains. The prettier format gate still fails on `tests/media/happyhorse-live.test.ts:118-119`. The fix round left two poll-loop declarations at the old 6-space indent. Prettier requires 4. All logic gates pass fresh, including both zero-quota live proofs. The paid G5.1 completion proof is deferred again to preserve the operator budget. S04 stays verified. Its gate conditions re-confirmed fresh after a comment-only yml change.

## Per-slice verdicts

| Slice | Tier | Verdict | Fresh evidence, this round |
| --- | --- | --- | --- |
| S01 Adapter media input | 4 | VERIFIED | G1.1-G1.4 via `slice verify --run-gates`, 6.510 s total |
| S02 Route preflight and pass-through | 2 | VERIFIED | G2.1-G2.2 via `slice verify --run-gates`, 1.126 s total |
| S03 Registry capability, model list, preset | 2 | VERIFIED | G3.1-G3.2 via `slice verify --run-gates`, 0.050 s total |
| S04 Yml example and docs rows | 3 | VERIFIED, stays | G4.1 4/4 (154 ms), G4.2 `YML_OK`, G4.3 `DOCS6_OK`, re-confirmed fresh |
| S05 Live protocol proof | 4 | REJECTED | G5.2 pass 1366 ms. G5.3 pass 1363 ms. G5.4 pass 25/25 (584 ms). G5.1 paid run NOT executed |

G5.1 paid run: expected 82 s per the implementation-round record. Not executed this round. A rejecting round discards its evidence under the fresh-evidence rule. A run now would exhaust the single operator-budgeted paid generation before certification. G5.2 and G5.3 passed fresh standalone first, so the abort ordering is honored. The run is preserved for the certification round.

## Diff outcomes

| Slice | Diff | Classification |
| --- | --- | --- |
| S01 | 1/4 match | Three deviates, whitespace-only. Prettier-formatted multi-line signatures. Token-identical to the expectations. Resolved as the F1 fix output |
| S02 | 1/1 match | — |
| S03 | 2/3 match | One deviate. Empty-to-real signature transition. Helper now declares the contract-pinned signature. Expected by design |
| S05 | 1/1 match | — |

Whitespace deviates resolution: the round-1 expectations captured single-line signatures. The fix round ran `pnpm format`. It reformatted the signatures to multi-line. Compare the tokens: parameter names, types, and return types are identical. The deviates are the formatted output, not contract drift. `npx prettier --check --config .prettierrc` passes on every touched file except `tests/media/happyhorse-live.test.ts`.

## F2 and F3 confirmations

F2, one header: `server-providers.yml.example` now carries one `# --- Video Generation` header. The duplicate header comment is gone. The fix-round diff shows exactly one line removed. Confirmed in the file.

F3, alias declared and used: `VideoModelSourceRequirement` is declared at `lib/media/types.ts:307`. It is used at `lib/media/types.ts:214` for `VideoModelInfo.sourceRequirement`, imported at `lib/media/video-providers.ts:11`, and used in the helper return type at `lib/media/video-providers.ts:230`. The helper signature `(providerId: string, modelId: string): VideoModelSourceRequirement | undefined` matches spec line 72 exactly. Spec text now matches code.

## Findings carry-over

| ID | Severity | Round-1 finding | Round-2 disposition |
| --- | --- | --- | --- |
| F1 | Major | Prettier fails on six changed files; CI would block the merge | PARTIALLY CLOSED. Five files clean. `tests/media/happyhorse-live.test.ts:118-119` still fails. S05 rejected |
| F2 | Minor | Duplicate video header in `server-providers.yml.example` | CLOSED. Single header |
| F3 | Minor | Spec names `VideoModelSourceRequirement`; alias undeclared | CLOSED. Alias declared and used. Spec text matches code |
| F4 | Informational | S01 diff whitespace deviates | CLOSED. Resolved as formatting output, token-identical |
| F5 | Informational | `tests/media/happyhorse-registry.test.ts` is new but tests exactly the S03 symbols | UNCHANGED. Informational. Not scope creep |
| F6 | Informational | Paid G5.1 deferred to certification round; budget preserved | CARRIED FORWARD. Deferred again. Budget preserved |

## Ledger command verifications recorded

1. `rivr audit verify --actor verifier`: chain valid, 46 entries before writes, 50 entries after.
2. `rivr ledger validate --actor verifier`: chain valid, 46 entries. Mandatory gate before every verdict.
3. `rivr diff --slice S01`: 1/4 match, three whitespace-only deviates.
4. `rivr diff --slice S02`: 1/1 match.
5. `rivr diff --slice S03`: 2/3 match, one expected transition.
6. `rivr diff --slice S05`: 1/1 match.
7. `rivr slice verify --slice S01 --status verified --run-gates`: verified, 6.510 s.
8. `rivr slice verify --slice S02 --status verified --run-gates`: verified, 1.126 s.
9. `rivr slice verify --slice S03 --status verified --run-gates`: verified, 0.050 s.
10. `rivr slice reject-batch --rejections [S05]`: rejected, one batch call. Gap `partial`, cause `format-gate`.

Retry state after writes: count 2 of 5, consecutive same-cause 2, escalate at 3.

## Phantom hunt

No `missing` lines in any diff. No `unexpected` lines in any diff. The fix-round commit `ea7665bc` touched 12 files. Two are tooling or docs artifacts (`.cortexkit/.gitignore`, the ledger, the round-1 report). One spec status line. One yml header removal, the F2 fix. One alias declaration, the F3 fix. Six formatting passes. One incomplete formatting pass, S05. No new public symbols outside the targets. No scope creep.

Route neutrality: no `happyhorse` literal in `app/api/generate/video/`. Spec line 72 guard holds.

## Quality review

No stubs in the touched production files. Coverage is complete: happy path G1.1, adversarial poll-failure G1.4, route matrix G2.1, pass-through G2.2, registry and preset G3.1 and G3.2, example G4.1, live proofs G5.2 and G5.3, suite re-run G5.4. Tests assert concrete behavior: exact request bodies, error message substrings, http codes.

## Deficiency list

S05: the prettier format gate still fails on `tests/media/happyhorse-live.test.ts:118-119`. The two poll-loop declarations carry a 6-space indent. Prettier requires 4. The CI gate `pnpm check` (`prettier . --check`) fails on merge. Fix: run `pnpm format` on the file, confirm `npx prettier --check --config .prettierrc tests/media/happyhorse-live.test.ts` exits 0, then re-mark S05. G5.2 and G5.3 pass fresh this round. The certification round runs the paid G5.1 once, after G5.2 and G5.3 pass fresh again.

## Status

Round 2 complete. 4 of 5 slices verified. S05 back in implementation. Retry 2 of 5, cause `format-gate`, consecutive same-cause 2, escalate at 3.