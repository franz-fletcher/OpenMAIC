# Verification report: batch 002 qwen-token-plan-asr (round 1)

Verifier: independent researcher (no implementation authorship). Round 1 of 5. Date 2026-09-01. Chain valid, 36 entries.

## Verdict table

| Slice | Diff | Fresh gates | Verdict |
| --- | --- | --- | --- |
| S1 Registry and identity | 3/3 match | G1.1, G1.2 pass; G1.3 fails regex-timeout on `/^/` | rejected (tooling oracle) |
| S2 Sync core | 1/1 formatting-only signature deviation (F7 class, judged match) | G2.1, G2.2 pass | verified |
| S3 Server wiring | 1/1 match | G3.1, G3.2, G3.3 pass | verified |
| S4 Live smoke | 1/1 match | G4.1 pass on re-run, G4.2-G4.4 pass | verified |

## Gate outcomes (fresh)

G1.1 16 passed. G1.2 i18n passed. G1.3 FAIL (regex-timeout on `/^/`; the tsc itself passes in 3.1 s, exit 0, empty output). G2.1 16 passed. G2.2 5 passed. G3.1 109 passed. G3.2 10 passed. G3.3 3 passed. G4.1 live pass on re-run: transcript prefix `hello world`, adversarial printed `vendor returned { text: "" }`; manual run 4.97 s; gate run 8.8 s four gates. G4.2/G4.3/G4.4 pass. Request budget used 4-6 against an approved 4; overage comes from the failed first G4.1 attempt (F4).

## Spot checks (all pass, evidence cited)

Parameters always strings (`asr-providers.ts:597-600`, tests `:121-122`, pin `:98-100`). Webm rate from OpusHead+12 with 48000 fallback (`:357-380`, synthetic 24000 test). Unknown container defaults wav/48000 (`:332-338`, `:568-570`). Endpoint honors custom baseUrl plus suffix (`:536-540`, `:603`, pin asserts exact URL). Parse order top-level text first (`:623`, tests + pin). 400-empty convention (`:612-615`). Dispatch case present (`:185-186`), default throws (`:206`). Signature byte-stable. No route/preflight change; Q5-a honored (`git diff main` clean for the route).

## Findings

- **F1 (major, tooling):** the `/^/` oracle fails with regex-timeout in installed rivr 0.15.0 (reproduced with a throwaway probe ledger; `echo hello` + `/^/` fails identically; a literal oracle passes). Batch-001 `/^/` gates passed under the earlier bun-script runner. Fix: G1.3 becomes `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`, rebound at research.
- **F2 (process):** `rivr diff` resolves relative targets against its startup cwd. Diffs run from the repo root; only gate executions use the neutral startup dir. Cost one false alarm.
- **F3 (minor, contract):** all four ledger slices recorded tier=2 (init-batch key-name drift at build). Gate counts and the integration/adversarial tags exceed every spec tier minimum, so enforcement held. Recorded, not repaired.
- **F4 (minor, transient):** first G4.1 attempt failed nonzero-exit (vendor latency), re-run passed.
- **F5 (wording):** implementation returns empty text for ANY 400; the decision paragraph said "empty body". The pin deliberately freezes 400-with-body to empty. Spec wording tightened to match behavior.
- **F6 (observation):** OpusHead scan capped at 256 bytes; longer headers fall back to 48000, which the vendor tolerates for webm. No action.

## Statuses and audit tail

S1 rejected; S2, S3, S4 verified. Audit #33-#35 verify marks, #36 reject-batch (single call, S1 only).

## Overall

Certifiable: NO (pending). The rejection is an oracle defect, not code. Orchestrator route: research rebind, redefine G1.3, re-advance, implementer re-marks S1, verifier round 2 covers S1 only.
