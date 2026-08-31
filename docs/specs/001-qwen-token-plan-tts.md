# Batch 001 spec: qwen-token-plan-tts WebSocket provider

Spec status: implementation

## Problem Statement

The operator's token plan serves TTS only over a WebSocket protocol. OpenMAIC has no WebSocket client anywhere in `lib/`. Grep returns zero matches. The existing Qwen TTS provider at `lib/audio/tts-providers.ts:739` is HTTP-only. It appends `/services/aigc/multimodal-generation/generation` to the base URL. That path does not exist on the plan for TTS. Classroom builds therefore cannot use `qwen-audio-3.0-tts-plus`. The vendor offers no HTTP TTS endpoint on this host.

## Solution

This batch adds a new provider id `qwen-token-plan-tts`. It imports the `WebSocket` class from the existing direct dependency `undici`. The init object carries `{headers:{Authorization}}`. The class typechecks against the pinned `undici-types`, and the engines floor Node >= 20.9 stays honored. The provider speaks the DashScope SpeechSynthesizer frame protocol. A module-level connection pool manages two connections by default. The provider registers in the TTS registry, the server env map, the route, and the classroom pipeline. A generated data file carries 597 plus-model and 597 flash-model base voices.

## User Stories

1. As a classroom builder, I want TTS synthesis to succeed with `qwen-token-plan-tts`, so that classroom scenes get audio from the plan.
2. As an operator, I want the voice picker to list curated system voices first, so that the common choices are one click away.
3. As an operator, I want search to find base voices by native name, so that the 1,194 base voices stay reachable without scrolling.
4. As a developer, I want the pool to survive Next dev hot reload, so that orphan sockets do not accumulate.
5. As an operator, I want per-modality configuration through `TTS_QWEN_TOKEN_PLAN_*` env vars, so that the provider works before the preset exists.
6. As a verifier, I want one opt-in live smoke test per batch, so that the protocol is proven against the real host.
7. As a classroom builder, I want failures mapped to clear route errors, so that the build shows an actionable message, not a stack trace.

## Slices

**S1: Registry and identity** (risk tier 1, no gate tag)
Delivers the provider id in the TTS union. Delivers the registry entry with models, default model, curated voices, and supported formats. Delivers default voice and model records. Delivers the provider display key in 12 locales. Delivers the generated base-voice data file.
Blockers: none.

**S2: WebSocket synthesis core and connection pool** (risk tier 2)
Delivers the frame client that opens the socket, sends the three frames, assembles binary audio, and maps server events. Delivers the dispatch case that routes the new provider id through the existing synthesis entry point. Delivers the pool that serializes tasks, reuses finished connections, discards failed ones, and reaps idle ones. Delivers typed errors that extend the existing Qwen TTS error class so the route maps them unchanged. Delivers timeout and abort handling that closes the socket.
Blockers: S1.

**S3: Server wiring and route** (risk tier 3, integration gate)
Delivers the env map entry, the `.env.example` section, and the neutrality guard update. Delivers the generate route serving the new provider through the existing error branch.
Blockers: S2.

**S4: Live smoke and protocol pin** (risk tier 4, adversarial gate)
Delivers the opt-in live test that proves the protocol once against the real host. Delivers the pin test that records the exact frame sequence and event names.
Blockers: S2.

**S5: Classroom pipeline acceptance** (risk tier 2, verification-only)
Delivers the classroom scene generation path accepting the new provider. Long texts split upstream. The mp3 format passes through the storage layer.
Blockers: S3.

## Implementation Decisions

**Provider identity.** Add `qwen-token-plan-tts` to the `BuiltInTTSProviderId` union at `lib/audio/types.ts:82-92`. Add `case 'qwen-token-plan-tts'` to the `generateTTS` dispatch switch at `lib/audio/tts-providers.ts:220-256`; the `default` branch throws `Unsupported TTS provider` at line 255, so the case is mandatory. Do not add a switch inside `qwen-tts`. The old adapter is HTTP-only and has different voice and error semantics. A separate id keeps the neutrality guard and the route mapping intact. Set `requiresApiKey: true` on the registry entry; the route key preflight reads it at `app/api/generate/tts/route.ts:112-119`, and enablement reads it at `lib/audio/provider-enablement.ts:78`.

**Transport.** Import the `WebSocket` class from `undici` (already a direct dependency, no new package). The init object accepts `{headers:{Authorization}}`, and `WebSocketInit.headers` typechecks against the installed `undici-types`. The global variant is stable only from Node 22.4, while `engines.node` allows >= 20.9.0 (`package.json:7`); importing from `undici` avoids that floor conflict. The repo has zero prior WebSocket code, confirmed by grep over `lib/`.

**Endpoint.** `wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference`.

**Model pair.** Primary model `qwen-audio-3.0-tts-plus`. Fallback model `qwen-audio-3.0-tts-flash`. Flash has 12 system voices: `longanfengyue`, `longanyuanfei`, `longanlingxi`, `longanxiaoxin`, `longanhuan_v3.6`, `longjielidou_v3.6`, `longpaopao_v3.6`, `longhuohuo_v3.6`, `longchuanshu_v3.6`, `loongmary`, `loongeva_v3.6`, `loongjohn`. Plus-model system voices are `longanlingxin` and `longanlufeng`.

**Base voices.** Ingest 597 plus-model and 597 flash-model voices from vendor XLSX into a generated data file under `lib/audio/data/`. The directory holds pure data with no logic. `lib/audio` already owns TTS constants. The generator output must be prettier-clean and type-valid, because `pnpm check` covers `lib/` and `npx tsc --noEmit` includes it; the file is typed as `TTSVoiceInfo[]`. Base voices use native names only and get no i18n keys. Each base voice record sets `compatibleModels` to its model id. The voice resolver filter at `lib/audio/voice-resolver.ts:317` then restricts voices by model. The ids carry the model prefix, so the mapping stays one-to-one.

**Picker strategy.** The first page shows the curated system voices. Search narrows the full 1,194-entry list by native name. No virtualization. The picker maps every voice of an expanded model group to a row (`components/agent/agent-bar.tsx:267-339`), so the batch adds a display cap of 50 rows per group with a visible hint to search for more. The slice records the client bundle delta caused by importing 1,194 records into the client-rendered registry; the delta lands in the verification report.

**Connection pool.** A module-level singleton. Anchor its shutdown in `instrumentation.ts` alongside the other drains at `instrumentation.ts:57-98`. The default pool size is two connections. Env knob `OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE` overrides the count (name aligned with the frozen `TOKEN_PLAN` spelling; the draft name `OPENMAIC_QWEN_TP_WS_POOL_SIZE` is retired). Reuse a connection after `task-finished` with a fresh `task_id`. Discard a connection after `task-failed`. Reap idle connections at 60 seconds. Serialize one task per connection.

**Frame flow.** Send `run-task{}`, then one `continue-task{input.text}` with the full text, then `finish-task`. Classroom texts are usually 200 characters or fewer. The vendor limit per instruction is 20,000 characters. Add `TTS_MAX_TEXT_LENGTH['qwen-token-plan-tts'] = 20000` at `lib/audio/tts-utils.ts:12-14`; without an entry, `splitLongSpeechActions` returns actions unsplit (`:82-84`), so this registration is what makes the upstream splitter act. The client-side 20,000-character guard rejects anything longer with a typed error as the last bound.

**Output.** mp3 at 22050 Hz. No conversion happens. `audioMime` at `lib/server/agent-runtime/scene-tts.ts:40` maps mp3, and Dexie stores the format string.

**Error mapping.** Throw a typed error class that extends `QwenTTSError` at `lib/audio/tts-providers.ts:134-143`. The route branch is an `instanceof QwenTTSError` check at `app/api/generate/tts/route.ts:173-175`; a look-alike class would fall through to the 500 `GENERATION_FAILED` path. Extending keeps the route untouched and preserves code plus httpStatus mapping.

**Abort and timeout.** Reuse the `ttsRequestSignal` pattern at `lib/audio/tts-providers.ts:176-179`. Default timeout is 30 seconds. An abort closes the socket.

**Environment.** Add `TTS_QWEN_TOKEN_PLAN_API_KEY`, `TTS_QWEN_TOKEN_PLAN_BASE_URL`, and `TTS_QWEN_TOKEN_PLAN_MODELS`. Add entry `TTS_QWEN_TOKEN_PLAN: 'qwen-token-plan-tts'` to the `TTS_ENV_MAP` at `lib/server/provider-config.ts:87-97`. Add a `.env.example` section. Update the neutrality debt table in the same slice.

**Registry records.** Add entries to `DEFAULT_TTS_VOICES` at `lib/audio/constants.ts:1336-1347` and `DEFAULT_TTS_MODELS` at `lib/audio/constants.ts:1349-1360`.

**i18n.** Add provider display key `settings.providerQwenTokenPlanTTS` across 12 locales. Add the map entry `'qwen-token-plan-tts': 'settings.providerQwenTokenPlanTTS'` to `TTS_PROVIDER_NAME_KEYS` at `lib/audio/provider-display.ts:25-36`; without it the settings UI renders the raw id. Add voice description keys for the 14 system voices only.

**Base-voice ingestion.** Commit the generated data file. Add generator script `scripts/generate-qwen-token-plan-voices.mjs`. The script re-downloads the vendor XLSX and rebuilds the data file deterministically. License note: the vendor artifact redistributes inside the app repo. The vendor states no explicit license. Record this as an accepted risk for a local fork.

## Testing Decisions

Hermetic tests stub the global with `vi.stubGlobal('WebSocket', fake)`. The fake scripts event frames and binary chunks. The analog is `tests/audio/doubao-tts.test.ts`.

Route-level tests follow `tests/server/tts-route-missing-key.test.ts`. The prefix list at `tests/server/tts-route-missing-key.test.ts:35-46` grows by `TTS_QWEN_TOKEN_PLAN`.

The env prefix list at `tests/server/provider-config.test.ts:8-60` grows by `TTS_QWEN_TOKEN_PLAN`.

One opt-in live smoke test is gated by `TEST_LOAD_LOCAL_ENV=1`. The test must skip when `TEST_LOAD_LOCAL_ENV` is not `1` or when the plan key is absent, because no other test consumes this loader today (`tests/setup-env.ts:23-41`) and CI runs without `.env.local`. When enabled, it synthesizes `你好，世界` with `longanlingxin` on the plus model and runs one request against a flash system voice to validate the flash voice ids. The operator approved it. It is S4 tier 4.

A protocol pin test records the exact frame sequence and event names from the probes.

The success criteria: the classroom pipeline synthesizes mp3 audio, the picker filters by model, the pool reaps and reuses, and every failure maps to a typed route error.

## Out of Scope

- No switch inside `qwen-tts`. The old provider stays untouched.
- No HTTP TTS endpoint. The vendor offers none on this host.
- No voice cloning or enrollment. The vendor gap is a blocked record.
- No base-voice i18n keys. Native names only.
- No virtualization in the picker.
- No realtime voice surface.
- No preset registration. That is batch 003.
- No ASR work. That is batch 002.
- No audio conversion. mp3 passes through.

## Further Notes

Dependency: none blocking. Batch 003 consumes the new provider id.

Rollback: revert the merge. Dropping the provider id leaves no stored data that references it.

Open 400 semantics: an empty `400 {}` means the payload was rejected. Missing `parameters` and no speech in the audio both produce it.

Pool size name: the decision is `OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE`, aligned with the frozen `TOKEN_PLAN` naming. The draft name `OPENMAIC_QWEN_TP_WS_POOL_SIZE` is retired.

maxDuration boundary: the default 30-second provider timeout equals the route `maxDuration = 30` at `app/api/generate/tts/route.ts:32`. A platform that enforces maxDuration can cut the request before the typed timeout error fires. Local dev is unaffected. Recorded, no action.

i18n key math: 14 voice description keys plus 1 provider display key, times 12 locales, is 180 keys. Flag this count for approval.

Neutrality guard: the debt table pins vendor token counts in `lib/server/provider-config.ts`. `qwen` counts 20 today. The new env map entry and resolver lines raise the count. The same slice updates `tests/providers/provider-neutrality-guard.test.ts:164-213`.

XLSX provenance: the vendor hosts the base-voice workbooks on `help-static-aliyun-doc.aliyuncs.com`. File names are `qwen-audio-3.0-tts-plus-base-voices-en.xlsx` and `qwen-audio-3.0-tts-flash-base-voices-en.xlsx`. The generator script resolves the full paths from the voice-list page `docs.qwencloud.com/api-reference/speech-synthesis/qwen-audio-tts/voice-list`.

---

Status: Reviewed for soundness (docs/research/001-spec-soundness-review.md). Blockers B1-B3 and concerns C1-C5 folded in. Awaiting human approval.
