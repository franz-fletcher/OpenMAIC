# Soundness review: batch 005 media-test redaction

Reviewer: fresh researcher, not the spec author. Date 2026-09-02. Target: `docs/specs/005-media-test-redaction.md`.

## Verdict

Not fit for approval as drafted: one phantom target. All other facts check out, including the guard-test recipe, proven writable by micro-experiment. Every blocker and concern below is now folded into the spec text.

## Blockers

**B1 — `qwen-voice-route.test.ts:141,238` is a phantom.** The file is 172 lines, has no whole-init `toMatchObject`, and its cited lines are a fetch spy setup and nothing. The real whole-init site is `tests/audio/qwen-voice-clone.test.ts:141,238`, already listed under S03. Class A server sites are two, not three (classroom `:137`, capability-force-off `:301`). Folded: removed from S02, count corrected.

## Concerns (all folded)

**C1 — S03 five-file claim.** Only `qwen-voice-clone` carries the whole-init idiom. The other four use partial matchers or destructured reads with test-literal keys; their conversion is hygiene, not security. S03 reworded accordingly.
**C2 — S03 grep gate scope.** The `! grep -qF "mock.calls[0][1]).toMatchObject" tests/audio` canary was dry-run both ways: present → exit 1 silent; absent → prints `AUDIO_SCALARS_OK` exit 0. It proves the dangerous site, not the four hygiene files; gate wording corrected.
**C3 — guard capture mechanism pinned by experiment.** A caught `AssertionError` from a failing whole-init matcher embeds the serialized call, including `Authorization: "Bearer sk-..."`, in `err.message`. Recipe folded into Implementation Decisions; scalar legs must assert on non-secret fields only.
**C4 — sensitivity pair.** The guard must first prove capture by asserting the fixture key DOES appear in a deliberately failed whole-init message, then prove closure on the scalar leg. Folded.

## Minor

- `let yamlOverride` at module level is an outline-capturable symbol (confirmed against `provider-config.test.ts:6`).
- `capability-force-off-routes.test.ts` needs a NEW fs mock; the classroom test merges into its existing one. Noted for the implementer.
- Full-suite baseline: `npx vitest run` without exclusion passes today on a machine with no `server-providers.yml` (656 files, 70 s). Gate is green-but-weak there; the guard carries the hermetic proof. Correct as designed.
- Only the batch-001 ledger references the exclusion (verified across all four ledgers).
- Neutrality impact zero; live table pins `qwen` at 24.
- Pre-existing dirty meta-ledger (orchestrator amend seq 18) noted; not reviewer's.

## Per-section outcome

Problem/Solution/stories sound after B1 fix; S01 sound; S02 guard-only now, recipe pinned; S03 reworded, gates proven; ledger notes compatible with batch 001-004 discipline; Out of Scope counts corrected.

**Fit for approval: yes, after the folded revision (this file documents the revision basis).**
