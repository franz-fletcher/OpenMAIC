# Batch 002 spec: qwen-token-plan-asr synchronous provider

Spec status: research

## Problem Statement

The operator's token plan serves ASR on `qwen-audio-3.0-asr-flash`. The model works on the sync endpoint `/api/v1/services/aigc/multimodal-generation/generation`. The existing `qwen-asr` provider targets a different schema. It sends `content[].audio` and reads `output.choices[0].message.content`. The token plan rejects that shape with HTTP 200 bodies that throw the parser. The plan also lacks `qwen3-asr-flash` and all `-filetrans` variants. Live probes confirm 404 `Model not exist` for them. The plan's ASR response places text at top level, not under `output.choices`. Batch 002 adds a provider that speaks the plan's protocol.

## Solution

This batch adds provider id `qwen-token-plan-asr`. It sends the `input_audio` content shape with base64 data URIs. It sends `parameters.format` and `parameters.sample_rate` as strings on every request. It reads the transcript from top-level `.text`. The browser records `audio/webm` opus. Probe evidence from 2026-09-01 proves the vendor accepts that container directly with `format: 'webm'`. No client or server conversion is needed. The provider joins the ASR registry, the dispatch switch, the display map, the server env map, the store defaults, and the i18n keys. The local-media pipeline already feeds wav chunks, which the provider sends with `format: 'wav'` and a header-derived sample rate. All slices stay sync HTTP. No WebSocket.

## User Stories

1. As a classroom builder, I want a voice note transcribed by `qwen-token-plan-asr`, so that classroom content gets text from the plan.
2. As an operator, I want `ASR_QWEN_TOKEN_PLAN_*` env vars, so that the provider works before the preset exists in batch 003.
3. As a developer, I want the provider to accept the browser's native webm recording, so that no audio conversion happens anywhere.
4. As a developer, I want the provider to accept wav chunks from the local-media pipeline, so that media extraction can transcribe with the plan.
5. As an operator, I want clear error text when a non-400 status rejects my audio, so that the settings test shows an actionable message. A no-speech 400 returns empty text by design.
6. As a verifier, I want one opt-in live smoke test, so that the protocol is proven against the real host.
7. As a developer, I want the neutrality guard to stay green, so that the provider surface stays vendor-neutral.

## Slices

**S1: Registry and identity** (risk tier 1)
Intent: add the provider id to the ASR union, the `ASR_PROVIDERS` registry record, the display name map, the per-provider store default, and one i18n key across 12 locales.
Stories: 1, 2.
Blockers: none.
Proposed gates:
- G1.1 `npx vitest run tests/audio/qwen-token-plan-asr.test.ts` expect `passed`
- G1.2 `pnpm check:i18n-keys` expect `passed`
- G1.3 `npx tsc --noEmit` expect `/^/`

**S2: Synchronous provider core** (risk tier 2)
Intent: add the `transcribeAudio` dispatch case and the `transcribeQwenTokenPlanASR` function. The function builds the `input_audio` body, derives `format` and `sample_rate` from the audio bytes, parses the top-level `.text` response, and maps the vendor error shapes.
Stories: 1, 3, 4, 5.
Blockers: S1.
Proposed gates:
- G2.1 `npx vitest run tests/audio/qwen-token-plan-asr.test.ts` expect `passed`
- G2.2 `npx vitest run tests/audio/qwen-token-plan-asr-protocol.test.ts` expect `passed`

**S3: Server wiring, env, and neutrality** (risk tier 3, integration gate)
Intent: add the `ASR_ENV_MAP` entry, the `.env.example` section, the provider-config test coverage, and the neutrality guard debt update.
Stories: 2, 7.
Blockers: S2.
Proposed gates:
- G3.1 `npx vitest run tests/server/provider-config.test.ts` expect `passed` (type integration)
- G3.2 `npx vitest run tests/server/capability-force-off-routes.test.ts` expect `passed`
- G3.3 `npx vitest run tests/providers/provider-neutrality-guard.test.ts` expect `passed`

**S4: Live smoke and protocol pin** (risk tier 4, adversarial gate)
Intent: add the opt-in live test that proves the protocol once against the real host, the clean skip behavior, and the request-shape pin test.
Stories: 6.
Blockers: S2.
Proposed gates:
- G4.1 `TEST_LOAD_LOCAL_ENV=1 npx vitest run tests/audio/qwen-token-plan-asr-live.test.ts` expect `[qwen-token-plan-asr-live] ok` (type adversarial)
- G4.2 `npx vitest run tests/audio/qwen-token-plan-asr-protocol.test.ts` expect `passed`
- G4.3 `npx vitest run tests/audio/qwen-token-plan-asr-live.test.ts` expect `skipped`
- G4.4 `npx vitest run tests/providers/provider-neutrality-guard.test.ts` expect `passed`

## Implementation Decisions

**Provider identity.** Add `'qwen-token-plan-asr'` to the `BuiltInASRProviderId` union at `lib/audio/types.ts:180-186`. Add `case 'qwen-token-plan-asr'` to the `transcribeAudio` switch at `lib/audio/asr-providers.ts:175-204`. The `default` branch throws `Unsupported ASR provider` at line 203, so the case is mandatory. This is the batch-001 B1 lesson applied to ASR. Do not modify `transcribeQwenASR`. The old provider keeps its schema and its errors.

**Registry record.** Add the record to `ASR_PROVIDERS` at `lib/audio/constants.ts:1113-1365`. Set `requiresApiKey: true`. Set `defaultModelId: 'qwen-audio-3.0-asr-flash'` (the field is required by `ASRProviderConfig` at `lib/audio/types.ts:200`). Set `defaultBaseUrl` to `https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1`. The transcribe function appends `/services/aigc/multimodal-generation/generation`, matching the `qwen-asr` convention at lines 1197 and 396. Set `models` to `qwen-audio-3.0-asr-flash`. Set `supportedFormats` to `['wav', 'webm', 'mp3', 'opus']`. Set `supportedLanguages` to the model's `language_hints` codes from the vendor docs. The S4 protocol pin test asserts this exact list, so vendor-doc drift breaks the pin instead of the live gate. The codes are `auto`, `zh`, `en`, `ja`, `ko`, `vi`, `th`, `id`, `ms`, `tl`, `hi`, `ar`, `fr`, `de`, `es`, `pt`, `ru`, `it`, `nl`, `sv`, `da`, `fi`, `no`, `el`, `pl`, `cs`, `hu`, `ro`, `bg`, `hr`, `sk`.

**Request body.** Mirror the probe payload. Send `model`, then `input.messages[0].content[0]` with `type: 'input_audio'` and `input_audio.data` as `data:<mime>;base64,<bytes>`. Send `parameters.format` and `parameters.sample_rate` as strings. Always send both. The frozen probe facts record that a missing parameter yields an opaque `400 {}`.

**Format derivation.** Read the audio bytes to pick `format`. Wav starts with `RIFF....WAVE` at offsets 0 and 8. Webm starts with the EBML magic `0x1A45DFA3`. Mp3 starts with `ID3` or an `0xFF` sync byte. Ogg starts with `OggS`. The wav and webm detectors reuse the existing helpers `detectWavBuffer` and `detectWavBytes` at `lib/audio/asr-providers.ts:283-297`. Default to `wav` when the container is unknown. The recorder produces webm. Local-media chunks are wav.

**Sample rate derivation.** For wav, read the unsigned 32-bit little-endian value at header offset 24. For webm, search for the `OpusHead` marker and read the unsigned 32-bit little-endian value 12 bytes after it. Fall back to `48000`. Send the value as a string. Probe 3 proves the vendor tolerates a wrong value for webm. Probe 1 proves `48000` works for wav.

**Response parsing.** Read the transcript from top-level `data.text` first. Probe 2 confirms the key exists. Fall back to `data.sentence?.text`, which probe 2 also returns. Fall back to `data.output?.output?.sentence?.text`, which the vendor docs document. Return `{ text }`.

**Error mapping.** A `400` with an empty body means no speech or a rejected payload. Return `{ text: '' }` for it, mirroring the existing empty-audio handling at `lib/audio/asr-providers.ts:406-412`. Any other non-OK status throws `Error` with the status and the response text. The transcription route at `app/api/transcription/route.ts:87-92` already maps every thrown error to `TRANSCRIPTION_FAILED` with the message. No new error class. The ASR surface has no typed error classes, and the route has no `instanceof` branch.

**Display name.** Add `'qwen-token-plan-asr': 'settings.providerQwenTokenPlanASR'` to `ASR_PROVIDER_NAME_KEYS` at `lib/audio/provider-display.ts:16-23`. Without it, the settings UI renders the raw id. This is the batch-001 C1 lesson applied to ASR.

**Store default.** Add the provider to `asrProvidersConfig` defaults at `lib/store/settings.ts:521-528`. Set `apiKey: ''`, `baseUrl: ''`, `modelId: 'qwen-audio-3.0-asr-flash'`, `enabled: false`. The shape mirrors the `qwen-asr` default plus the modelId field (the old entry has none). The optional `modelId` on the state interface at `lib/store/settings.ts:127` typechecks the settings read. `asrProvidersConfig` is an interface property, not a standalone export, so the ledger covers this default at the S1 slice-expectation level, following the batch-001 precedent.

**i18n.** Add `settings.providerQwenTokenPlanASR` to all 12 locale files. The key sits beside `settings.providerQwenASR` at `en-US.json:1455`. One key per locale. Total 12 keys.

**Environment.** Add `ASR_QWEN_TOKEN_PLAN: 'qwen-token-plan-asr'` to `ASR_ENV_MAP` at `lib/server/provider-config.ts:100-106`. The `DISABLE_ENV_MAPS` asr spread at lines 170-173 picks up the prefix automatically, so `ASR_QWEN_TOKEN_PLAN_ENABLED=false` force-off works. Add `ASR_QWEN_TOKEN_PLAN_API_KEY`, a commented `ASR_QWEN_TOKEN_PLAN_BASE_URL`, and a commented `ASR_QWEN_TOKEN_PLAN_MODELS` to the ASR section of `.env.example` at lines 161-178. The base URL comment reads `https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1`.

**No audio conversion.** The recorder hook at `lib/hooks/use-audio-recorder.ts:47` calls `normalizeASRUploadAudio`. The default branch at `lib/audio/wav-utils.ts:80-82` passes webm through unchanged. The settings test flow at `components/settings/asr-settings.tsx:146` does the same. Probe 2 proves the vendor accepts the webm bytes. No change to `wav-utils.ts`. No server-side transcoder. No ffmpeg-class dependency.

**No route change.** The transcription route is generic. It resolves keys and base URLs through `resolveASRApiKey` and `resolveASRBaseUrl` at `lib/server/provider-config.ts:784-790`, then calls `transcribeAudio`. Nothing provider-specific lands in `app/api/transcription/route.ts`.

## Testing Decisions

The hermetic suite at `tests/audio/qwen-token-plan-asr.test.ts` mocks global `fetch`. It asserts the request body shape: the model, the `input_audio` content type, the base64 data URI prefix, and both parameters as strings. It scripts response shapes: top-level `text`, `sentence.text` fallback, `400 {}` to empty text, and non-OK to throw. It feeds a wav Buffer and asserts `format: 'wav'` with a header-derived rate. It feeds a webm Buffer and asserts `format: 'webm'`. It proves a missing key throws the required-key error.

The protocol pin test at `tests/audio/qwen-token-plan-asr-protocol.test.ts` records the exact request shape and response keys from the 2026-09-01 probes. It follows the batch-001 pattern at `tests/audio/qwen-token-plan-tts-protocol.test.ts`.

The route and server tests mirror batch 001. Add `ASR_QWEN_TOKEN_PLAN` to the clear list at `tests/server/provider-config.test.ts:8-61`. Add a test that mirrors the TTS token-plan block at lines 992-1010. It stubs the three env vars and asserts `isServerConfiguredProvider`, server-key precedence, server-base-url precedence, and the model pin. The force-off route suite at `tests/server/capability-force-off-routes.test.ts` keeps its `ASR_QWEN` coverage and gains no new tests. The new prefix works through the generic disable map.

The live test at `tests/audio/qwen-token-plan-asr-live.test.ts` is opt-in. It skips unless `TEST_LOAD_LOCAL_ENV` is `1` and `ASR_QWEN_TOKEN_PLAN_API_KEY` is present. The skip message mirrors batch 001. The audio source is the vendor's public sample, fetched at test time and sent as a base64 data URI (operator decision Q1-a): `https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav`. Public-read object, 128480 bytes, 16 kHz mono PCM16, about 5 seconds, no auth. The verified 2026-09-01 call returned the transcript `hello world，这里是阿里巴巴语音实验室。`. The test asserts non-empty text and prints the expected transcript prefix `hello world`. If the CDN object ever drifts, the S4 live gate breaks and the URL needs a refresh. When enabled, the test prints `[qwen-token-plan-asr-live] ok`. The adversarial gate runs it with the env loader. The skip gate runs it without.

Success criteria: the webm recorder path returns text, the wav local-media path returns text, every failure maps to an actionable message, and the neutrality guard passes with recorded counts.

### Gate mechanics convention (inherited batch-001 lessons, refined for the installed CLI)

Expect strings match literal substrings of captured stdout+stderr, or a `/regex/flags` pattern. A gate passes on exit code 0 AND a match. `'/^/'` means the exit code governs. The installed `rivr` binary still auto-loads `.env.local` from its startup directory into gate children. Gate runs therefore start `rivr` from a neutral directory with no `.env.local`, pass absolute ledger paths, and pin each gate's `cwd` to the repo root. Live gates still see their key because `tests/setup-env.ts` loads `.env.local` by test-root path inside the vitest process. This replaces the round-3 `bun --no-env-file` recipe.

## Out of Scope

- No streaming ASR. The `-streaming` variant is absent from the plan catalog.
- No WebSocket transport. The meta-spec freezes sync HTTP for batch 002.
- No changes to `qwen-asr`. The old provider keeps its schema.
- No `-filetrans` variants. Live probes return 404 for them.
- No voice cloning. The vendor gap is a blocked record.
- No server-side audio transcoding. Probe evidence proves webm works direct.
- No language_hints UI work. The existing language select maps through the registry list.
- No preset registration. That is batch 003.
- No new error class and no route preflight. The ASR surface stays plain-Error.

## Further Notes

Dependency: batch 003 consumes the provider id and the env prefix.

Rollback: revert the merge. No stored data references the provider id.

Env migration: the operator must add `ASR_QWEN_TOKEN_PLAN_API_KEY` to `.env.local` before the S4 live gate. The value is the same `sk-sp-` key as `TTS_QWEN_TOKEN_PLAN_API_KEY`. The stale `ASR_QWEN_*` hybrid URL stays untouched.

Probe record: three requests on 2026-09-01. Wav 48k with `format: 'wav'` returned 200. Webm opus with `format: 'webm'` returned 200. Webm 48k declared as 16000 returned 200. Response keys are `sentence`, `text`, `request_id`, `output`, `usage`. No key material was printed.

Response shape drift: top-level `text` is verified. The parser keeps two documented fallbacks.

`400 {}` semantics: missing parameters and no speech both produce it. The provider always sends both parameters, so a runtime `400 {}` means no speech.

Sample-rate risk for non-wav containers: probe 3 proves tolerance for webm only. The wav path derives from the header. Unknown containers default to 48000.

Neutrality: the derived terms from `qwen-token-plan-asr` are `qwen`, `token`, and `plan`. The word `asr` is generic, so `GENERIC_ID_PARTS` at `tests/providers/provider-neutrality-guard.test.ts:339-355` excludes it. New occurrences land in `lib/server/provider-config.ts` only. The debt rows for `qwen`, `token`, and `plan` at lines 164-218 grow. The exact counts come from running the guard after the edits. S3 owns that update.

maxDuration: the transcription route sets 60 seconds at `app/api/transcription/route.ts:17`. The vendor sync limit is 5 minutes of audio. Voice notes are seconds long. No action.

i18n math: 1 key times 12 locales is 12 keys.
