# Verification report: batch 004 happyhorse i2v and r2v media input (round 1)

Verifier: independent, no authorship. Date 2026-09-02.
Ledger: `.rivr/specs/004-video-i2v-r2v.ledger.json`. Spec: `docs/specs/004-video-i2v-r2v.md`. Branch: `feat/happyhorse-i2v-r2v`.

## Verdict

**Batch NOT verified. 4 of 5 slices rejected. S04 verified.** One root cause: the prettier format gate fails on six changed TypeScript files. All logic gates pass. The live zero-quota proofs pass fresh. The paid completion proof is deferred to the fix round to preserve the operator budget. No spec defect, no phantom target, no logic defect.

## Per-slice verdicts

| Slice | Tier | Verdict | Evidence |
| --- | --- | --- | --- |
| S01 Adapter media input | 4 | REJECTED | Format gate fails on the adapter test file; logic gates pass standalone |
| S02 Route preflight and pass-through | 2 | REJECTED | Format gate fails on route + preflight test; logic gates pass |
| S03 Registry capability, model list, preset | 2 | REJECTED | Format gate fails on `lib/media/video-providers.ts`; grep gates pass |
| S04 Yml example and docs rows | 3 | VERIFIED | G4.1, G4.2, G4.3 pass fresh, recorded via `slice verify --run-gates` |
| S05 Live protocol proof | 4 | REJECTED | Format gate fails on the live test file; G5.2/G5.3 fresh pass; G5.1 deferred |

Chain: valid, 39 entries. Retry 1 of 5, cause `format-gate`.

## Diff outcomes

| Slice | Diff | Classification |
| --- | --- | --- |
| S01 | 1/4 match | Three whitespace-only signature deviates (F7-class cosmetic, resolved by formatting) |
| S02 | 1/1 match | — |
| S03 | 2/3 match | New-helper kind-only postcondition shows the empty-to-real signature transition; expected by design |
| S04 | 1/1 match | — |
| S05 | 1/1 match | — |

## Gate outputs (fresh where required)

Recorded: G4.1/G4.2/G4.3 `pass` for S04. Standalone diagnostics: G1.1 6/6, G1.4 adversarial 1/1, G2.1 7/7, G2.2 12/12, G3.1 `REGISTRY_OK`, G3.2 `PRESET_OK`, G5.2 live 1488 ms `Failed to download` observed, G5.3 live 1106 ms `InvalidParameter` observed, G5.4 25/25.

G5.1 decision: not re-run this round; a paid run during a rejecting round discards its evidence and exhausts the single budgeted generation before certification. The implementation-round record (82 s, passed) stays as corroboration. The fix round must re-mark S05 and run G5.1 fresh as the certification evidence.

## Extra checks

- t2v byte-identical body claim: PASS (pinned test unchanged; adapter adds `input.media` only when a source field is present).
- Route vendor tokens: PASS (no `happyhorse` literal; neutrality guard holds).
- Six mdx files: PASS (identical four-model row at line 54; translations untouched).
- Yml parses via real loader: PASS (`tests/server/server-providers-example.test.ts:109-121`).
- Helper signature drift: FOUND (see F3).

## Findings

| ID | Severity | Finding |
| --- | --- | --- |
| F1 | Major | Prettier fails on six changed files; main baseline clean; CI would block the merge |
| F2 | Minor | `server-providers.yml.example:55-56` duplicate video header comment |
| F3 | Minor | Spec names type `VideoModelSourceRequirement`; the code inlines the identical union; alias undeclared |
| F4 | Informational | S01 diff whitespace deviates (cosmetic subset of F1) |
| F5 | Informational | `tests/media/happyhorse-registry.test.ts` is new but tests exactly the S03 symbols; the spec's apply-token-plan models-assertion claim is loose |
| F6 | Informational | Paid G5.1 deferred to the certification round; budget preserved |

## Deficiency list and next steps

Rejected slices carry one shared deficiency: run `pnpm format` on the touched files, verify clean, fold the F2 duplicate comment. Orchestrator advances back to verification; the verifier re-runs chain, diffs, and all gates fresh, including the paid G5.1 certification run.

Status: Round 1 complete. Batch back in implementation. Retry 1 of 5.
