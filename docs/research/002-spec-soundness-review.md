# Soundness review: Batch 002 spec `qwen-token-plan-asr`

Reviewer: independent researcher, no authorship stake (round 1, 2026-09-01). Method: dry-run every claim against the live repo on branch main. Verdict: BLOCKERS (1). All 20+ file:line citations resolve. No phantom files or symbols. All existing-suite gate oracles pass a literal match on real runs.

## Blockers

**B1. Vendor sample URL not recorded.** The live test names `hello_world_female2.wav` but the spec held no URL. RESOLVED before the human gate: the author researcher recovered and re-verified the object live. URL, size, sample rate, transcript, and drift caveat are now in the spec's Testing Decisions. Evidence: fresh fetch HEAD 200 (audio/wav, 128480 bytes) plus one masked transcription call returning `hello world，这里是阿里巴巴语音实验室。`.

## Concerns (all folded into the spec in the same pass)

- **C1** Registry decision omitted the required `defaultModelId`. Added (`qwen-audio-3.0-asr-flash`, field required by `ASRProviderConfig` at `lib/audio/types.ts:200`).
- **C2** The 31-code `supportedLanguages` list is vendor-doc sourced and unverifiable offline. Fix applied: the S4 protocol pin asserts the exact list, so drift breaks the pin, not the live gate. (Review copy said 30; the enumerated list carries 31 codes. Corrected after the S1 implementation finding.)
- **C3** User story 5 clashed with the no-speech empty-400 design. Reworded.
- **C4** "Mirror the qwen-asr default" was imprecise (old entry has no modelId). Clarified.
- **C5** The env clear list is not ASR-exhaustive (pre-existing; no action).
- **C6** `asrProvidersConfig` is an interface property, not a ledger-resolvable symbol. Covered via the S1 slice expectation, following the batch-001 precedent.

## Citation audit (all correct unless noted)

`types.ts:180-186` union; `asr-providers.ts:175-204` switch with the default throw at 203; `:283-297` detectWavBuffer/detectWavBytes (module-private, reuse inside the file works); `:396` URL append; `:406-412` empty-audio convention; `constants.ts:1113-1365` ASR_PROVIDERS (1197 qwen-asr baseUrl); `provider-display.ts:16-23`; `settings.ts:521-528` + auto-inject loop `:718-724`; `provider-config.ts:100-106` ASR_ENV_MAP, `:170-173` disable spread auto-covers new prefixes, `:784-790` resolvers; `app/api/transcription/route.ts:17` maxDuration and `:87-92` TRANSCRIPTION_FAILED mapping (no preflight exists, claim verified); `.env.example:159-178` ASR section; `en-US.json:1455` neighbor key; `provider-config.test.ts:8-61` clear list and `:992-1010` TTS mirror block; neutrality guard `:339-355` GENERIC_ID_PARTS (`asr` present; `token`/`plan` absent so they become debt) and `:164-218` debt rows (qwen 22, token 3, plan 2); `capability-force-off-routes.test.ts` exists with ASR coverage; `wav-utils.ts:80-82` webm pass-through; `use-audio-recorder.ts:47` and `asr-settings.tsx:146` call sites; `setup-env.ts` loads `.env.local` by test-root path.

Meta-spec drift corrected by this review: batch 006 path is `app/api/transcription/route.ts`; the repo-parser throw sits at `asr-providers.ts:421-425`.

## Fact-check table

| Claim | Method | Result |
| --- | --- | --- |
| EBML magic `0x1A45DFA3` | ffmpeg-generated webm | VERIFIED |
| OpusHead rate at marker+12 | ffmpeg-generated webm | VERIFIED (`readUInt32LE` at 363 returns 48000) |
| `pnpm check:i18n-keys` prints `passed` | real run | VERIFIED |
| Gates G3.1/G3.2/G3.3/G4.3/G1.3 oracles | real runs of existing suites | VERIFIED (108 passed; 10 passed; 3 passed; 1 skipped; exit-0 silent) |
| New-file gates G1.1/G2.x/G4.1/G4.2 | inspection | RED-by-design, acceptable |
| G4.1 oracle shape | batch-001 print pattern | matches; fixture resolved via B1 |
| rivr `.env.local` auto-load (F6 doctrine in the mechanics paragraph) | batch-001 evidence | plausible, consistent with round 2-3 findings |

## Ledger feasibility

Contract symbols all resolve as outline symbols. `transcribeQwenTokenPlanASR` uses the exists:false capture flow (batch-001 precedent `generateQwenTokenPlanTTS`). Tier depths are met: S1 3 gates, S2 2, S3 3 with integration on G3.1, S4 4 with adversarial on G4.1. `asrProvidersConfig` covered at slice level per C6.

## Contradiction hunt

Gate cwd doctrine consistent with the batch-001 certification record. No route preflight exists; batch 006 owns that parity gap. No residual `bun --no-env-file` contradiction inside the 002 spec. Neutrality claim correct: the constants.ts registry key is authority vocabulary under REGISTRY_SOURCES and does not count; the new debt lands only in provider-config.ts.

## Status after fold-in

B1 resolved. C1-C4, C6 folded. Spec is fit for the human approval gate. C5 recorded, no action.
