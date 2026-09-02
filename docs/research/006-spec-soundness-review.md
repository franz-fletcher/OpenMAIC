# Soundness review: batch 006 asr-preflight-parity

Reviewer: fresh researcher, not the spec author. Date 2026-09-02. Target: `docs/specs/006-asr-preflight-parity.md`.

## Verdict

Not fit for approval as drafted: S01's first gate was unrunnable. Route facts, provider split, env-clear list, and neutrality claims all verify against shipped code. Blocker and concern folded into the spec.

## Blocker (folded)

**B1 — helper unit gate impossible.** The spec prescribed an inline, unexported helper AND a "helper unit truth-table" gate. The TTS precedent exports only `maxDuration` and `POST`; its missing-key test reaches behavior through `POST` (`tts-route-missing-key.test.ts:88,:98`). Folded: S01 gates re-shaped to route-level `-t` filters over the matrix file (`MISSING_API_KEY`, `never dispatches`), and those test names are now ledger contracts.

## Concerns (folded)

**C1 — insertion order.** Current route order: field check (`:34-36`), provider resolution (`:40-44`), disabled (`:50-52`), managed flag (`:55`), SSRF (`:57-62`), config build (`:64-74`), dispatch (`:79`). The key check needs `managed`, so placing it before `:55` forces a duplicated lookup. Folded: preflight placed after `managed` and the SSRF block, reusing the exact effective-key expression of the config build (`resolveASRApiKey(effectiveProviderId, managed ? undefined : apiKey || undefined)`), which is TTS's observable order.
**C2 — computability.** Confirmed: the route holds `apiKey` (form data `:31`) and `managed` (`:55`); the resolver is the same call the config build makes at `:72`.

## Minor (all verified true)

- Provider split exact: keyed `openai-whisper` (`constants.ts:1117`), `qwen-asr` (`:1196`), `qwen-token-plan-asr` (`:1241`), `azure-asr` (`:1285`); keyless `browser-native` (`:1311`), `funasr-asr` (`:1378`), `lemonade-asr` (`:1394`).
- Library guard confirmed at `asr-providers.ts:171-173`; message embeds provider id only.
- Env-clear list correct: six `ASR_ENV_MAP` prefixes (`provider-config.ts:100-106`) plus `ASR_BROWSER_NATIVE` (`:173`); TTS test pattern transfers.
- No existing test pins the current 500 (greps for `TRANSCRIPTION_FAILED`/transcription-500 in `tests/server`: zero matches).
- Neutrality: route is scanned at `provider-neutrality-guard.test.ts:70`; the check adds no vendor literal; no debt entry needed.
- Custom providers skip correctly (`?.requiresApiKey` undefined; library behaves identically at `:168-171`); intentional non-change confirmed.
- Two-layer design matches TTS exactly (library throw at `tts-providers.ts:214` + route preflight).
- Tier tags correct (t2/2 gates, t3/3 gates one integration).

**Fit for approval: yes, after the folded revision (this file documents the revision basis).**
