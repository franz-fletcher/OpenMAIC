# Verification report: batch 001 qwen-token-plan-tts (round 1)

Status: BLOCKED ON RESEARCH-STAGE LEDGER DEFECTS. The implementation itself verified sound.
Round: 1 of max 5. Audit chain: valid, 61 entries. Date: 2026-08-31.
Verifier: independent researcher, no implementation authorship.

## Verdict table

| Slice | Diff | Gates (fresh direct runs) | CLI verify result | Verdict |
| --- | --- | --- | --- | --- |
| S1 Registry and identity | 6/6 deviates (spurious, F3) | G1.1 exit 0; G1.2 exit 0; G1.3 = 12/12 | exit 3: 2 gates expect-mismatch | Sound, verdict blocked |
| S2 WS core and pool | 3/3 deviates (spurious) | G2.1 vitest 14/14 exit 0 | exit 3: expect-mismatch | Sound, verdict blocked |
| S3 Server wiring and route | 1/1 deviates (spurious) | G3.1 vitest 119/119 exit 0 | exit 3 | Sound, verdict blocked |
| S4 Live smoke and pin | 1/1 deviates (spurious) | G4.1 live 2/2, real bytes 22242 + 12211 | not re-run (vendor budget) | Sound, verdict blocked |
| S5 Classroom acceptance | 2/2 deviates (spurious) | G5.1 7163 pass / 1 allowed exclusion; G5.2 exit 0 | exit 3 | Sound, verdict blocked |

## Coverage highlights (file:line evidence)

- S1: `lib/audio/types.ts:93` union literal; registry `lib/audio/constants.ts:711-743` single plus model, `requiresApiKey: true`, mp3 only; defaults `:1382` `longanlingxin`, `:1396` plus; `provider-display.ts:36`; data file 597 records, zero flash remnants; picker cap `components/agent/agent-bar.tsx:32` (50 rows) and hint `:342`; 12/12 locales carry provider key, 2 voice keys, and `voiceListCapped`.
- S2: `lib/audio/qwen-token-plan-ws.ts` frame client plus pool. Seven behavior spot-checks pass: fresh 32-hex task_id per task; 20000-char guard before socket open; finish-task immediately after continue-task; binary concat in receive order; 60s idle reaper; env override read; shutdown drain at `instrumentation.ts:85-86`. Tests non-tautological.
- S3: env map `lib/server/provider-config.ts:92`; `.env.example:133-137`; neutrality pins qwen 22; route preflight `route.ts:113`; error branch `route.ts:173-175` unchanged.
- S4: live smoke `tests/audio/qwen-token-plan-tts-live.test.ts`: plus synthesis 22242 mp3 bytes, adversarial unknown-voice rejection plus pool recovery 12211 bytes, clean skip without the env gate. Pin at `tests/audio/qwen-token-plan-tts.test.ts:201-241`.
- S5: provider flows generically (`use-scene-generator.ts:313, 506-507, 545`); `scene-tts.ts:40-41` maps mp3 to audio/mpeg with no conversion. Full suite sole red is the allowed pre-existing `tests/server/classroom-media-generation.test.ts:137`, untouched by batch commits.

## Findings

| # | Severity | Scope | Finding |
| --- | --- | --- | --- |
| F1 | major | research | Gate `expect` oracles said "exit code 0". The runner matches expect as a substring of command output, so silent-success commands can never satisfy it. Oracles must be real output substrings. |
| F2 | major | research | Tier gate depth unmet: tier 2 needs 2 gates (S2 has 1), tier 3 needs 3 plus integration (S3 has 1), tier 4 needs 4 plus adversarial (S4 has 1). `slice verify` exits 3 on tier even with green gates. |
| F3 | major | research | Postconditions stored only `{exists: true}` without kind/signature, so `rivr diff` reports deviates for correctly present symbols. Re-write postconditions with `--after-kind`. |
| F4 | minor | research | Stale symbol-level expectation text for S1 `TTS_PROVIDERS` (dual model) and `qwenTokenPlanBaseVoices` (1194). The corrected slice-level expectation is satisfied. Update symbol text. |
| F5 | minor | pre-existing | The allowed-exclusion test failure output exposed a live bearer key in a fetch-mock capture. Not batch code. Orchestrator note: key-printing risk in that harness. |

## Deviations adjudication

Dynamic-import dispatch case: conforms. globalThis pool anchor: conforms (hot-reload story). undici module import: conforms (approved engines fix). 502 on task-failed: conforms (extends `QwenTTSError`, route unchanged). Generator plus-only: conforms (frozen scope).

## No rejections

No slice is rejected: the implementer has no gap to close. No slice is marked verified: the tooling refuses until the ledger is repaired at the research stage. Orchestrator action: repair F1-F4, re-advance, re-verify.
