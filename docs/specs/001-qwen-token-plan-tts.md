# Batch 001 spec: qwen-token-plan-tts WebSocket provider

Spec status: research_update

## Problem Statement

The operator's token plan serves TTS only over a WebSocket protocol. OpenMAIC had no WebSocket client anywhere in `lib/` before this batch. Grep returned zero matches. The existing Qwen TTS provider is HTTP-only. It appends `/services/aigc/multimodal-generation/generation` to the base URL. That path does not exist on the plan for TTS. Classroom builds therefore could not use `qwen-audio-3.0-tts-plus`. The vendor offers no HTTP TTS endpoint on this host.

## Solution

This batch adds a new provider id `qwen-token-plan-tts`. It imports the `WebSocket` class from the existing direct dependency `undici` at `lib/audio/qwen-token-plan-ws.ts:19`. The init object carries `{headers:{Authorization}}`. The class typechecks against the pinned `undici-types`, and the engines floor Node >= 20.9 stays honored. The provider speaks the DashScope SpeechSynthesizer frame protocol. A module-level connection pool manages two connections by default. The provider registers in the TTS registry, the server env map, the route, and the classroom pipeline. A generated data file carries the 597 plus-model base voices. All five slices verified on 2026-08-31, and the audit chain holds 104 entries.

## User Stories

1. As a classroom builder, I want TTS synthesis to succeed with `qwen-token-plan-tts`, so that classroom scenes get audio from the plan.
2. As an operator, I want the voice picker to list curated system voices first, so that the common choices are one click away.
3. As an operator, I want search to find base voices by native name, so that the 597 base voices stay reachable without scrolling.
4. As a developer, I want the pool to survive Next dev hot reload, so that orphan sockets do not accumulate.
5. As an operator, I want per-modality configuration through `TTS_QWEN_TOKEN_PLAN_*` env vars, so that the provider works before the preset exists.
6. As a verifier, I want one opt-in live smoke test per batch, so that the protocol is proven against the real host.
7. As a classroom builder, I want failures mapped to clear route errors, so that the build shows an actionable message, not a stack trace.

## Slices

**S1: Registry and identity** (risk tier 1, no gate tag)
Delivers the provider id in the TTS union. Delivers the registry entry with models, default model, curated voices, and supported formats. Delivers default voice and model records. Delivers the provider display key, two voice description keys, and the `voiceListCapped` hint key across 12 locales. Delivers the generated base-voice data file.
Blockers: none. Status: verified.

**S2: WebSocket synthesis core and connection pool** (risk tier 2)
Delivers the frame client that opens the socket, sends the three frames, assembles binary audio, and maps server events. Delivers the dispatch case that routes the new provider id through the existing synthesis entry point. Delivers the pool that serializes tasks, reuses finished connections, discards failed ones, and reaps idle ones. Delivers typed errors that extend the existing Qwen TTS error class so the route maps them unchanged. Delivers timeout and abort handling that closes the socket.
Blockers: S1. Status: verified.

**S3: Server wiring and route** (risk tier 3, integration gate)
Delivers the env map entry, the `.env.example` section, and the neutrality guard update. Delivers the generate route serving the new provider through the existing error branch.
Blockers: S2. Status: verified.

**S4: Live smoke and protocol pin** (risk tier 4, adversarial gate)
Delivers the opt-in live test that proves the protocol once against the real host. Delivers the pin test that records the exact frame sequence and event names.
Blockers: S2. Status: verified.

**S5: Classroom pipeline acceptance** (risk tier 2, verification-only)
Delivers the classroom scene generation path accepting the new provider. Long texts split upstream. The mp3 format passes through the storage layer.
Blockers: S3. Status: verified.

## Implementation Decisions

**Provider identity.** Add `qwen-token-plan-tts` to the `BuiltInTTSProviderId` union at `lib/audio/types.ts:82-93`. Add `case 'qwen-token-plan-tts'` to the `generateTTS` dispatch switch at `lib/audio/tts-providers.ts:233-240`. The `default` branch throws `Unsupported TTS provider` at line 264, so the case is mandatory. The case uses a dynamic import to keep the module graph acyclic. Do not add a switch inside `qwen-tts`. The old adapter is HTTP-only and has different voice and error semantics. A separate id keeps the neutrality guard and the route mapping intact. Set `requiresApiKey: true` on the registry entry. The route key preflight reads it at `app/api/generate/tts/route.ts:112-119`, and enablement reads it at `lib/audio/provider-enablement.ts:78`. The per-provider settings default lives at `lib/store/settings.ts:492-497`.

**Transport.** Import the `WebSocket` class from `undici` at `lib/audio/qwen-token-plan-ws.ts:19`. `undici` is already a direct dependency, so no new package lands. The init object accepts `{headers:{Authorization}}`, and `WebSocketInit.headers` typechecks against the installed `undici-types`. The global variant is stable only from Node 22.4, while `engines.node` allows >= 20.9.0 (`package.json:7`). Importing from `undici` avoids that floor conflict. The repo had zero prior WebSocket code before this batch, confirmed by grep over `lib/`.

**Endpoint.** `wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference`.

**Model.** The single model is `qwen-audio-3.0-tts-plus`. Its system voices are `longanlingxin` and `longanlufeng`. The earlier dual-model premise is corrected. Live probes on 2026-08-31 show `qwen-audio-3.0-tts-flash` is not provisioned on the personal plan. The vendor returns `Model not exist` for three voice combinations. The probe evidence is recorded at `docs/meta-specs/qwen-token-plan-integration.md:40`. Flash may return in a later batch if the plan adds it.

**Base voices.** Ingest the 597 plus-model voices from vendor XLSX into a generated data file at `lib/audio/data/qwen-token-plan-base-voices.ts`. The file is imported at `lib/audio/constants.ts:46`. The directory holds pure data with no logic. `lib/audio` already owns TTS constants. The generator output is prettier-clean and type-valid, because `pnpm check` covers `lib/` and `npx tsc --noEmit` includes it. The file is typed as `TTSVoiceInfo[]`. Base voices use native names only and get no i18n keys. Each base voice record sets `compatibleModels` to its model id. The voice resolver filter at `lib/audio/voice-resolver.ts:317` then restricts voices by model.

**Picker strategy.** The first page shows the curated system voices. Search narrows the full 597-entry list by native name. No virtualization. The picker maps every voice of an expanded model group to a row, so the batch adds a display cap of 50 rows per group at `components/agent/agent-bar.tsx:32` with a visible hint at `:340-346` to search for more. The 597-record data file adds a 94,506 B isolated client bundle delta through the `lib/audio/constants.ts:46` import. The verification report records the measurement.

**Connection pool.** A module-level singleton. The pool class is `QwenTokenPlanWsPool` at `lib/audio/qwen-token-plan-ws.ts:273-501`. Anchor its shutdown in `instrumentation.ts` alongside the other drains at `instrumentation.ts:84-89`. The default pool size is two connections. Env knob `OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE` overrides the count (`:113-117`). Reuse a connection after `task-finished` with a fresh `task_id`. Discard a connection after `task-failed`. Reap idle connections at 60 seconds. Serialize one task per connection.

**Frame flow.** Send `run-task{}`, then one `continue-task{input.text}` with the full text, then `finish-task`. The client waits for `task-started` before sending the text. Classroom texts are usually 200 characters or fewer. The vendor limit per instruction is 20,000 characters. Add `TTS_MAX_TEXT_LENGTH['qwen-token-plan-tts'] = 20000` at `lib/audio/tts-utils.ts:12-15`. Without an entry, `splitLongSpeechActions` returns actions unsplit (`:83-85`), so this registration is what makes the upstream splitter act. The client-side 20,000-character guard at `lib/audio/qwen-token-plan-ws.ts:34` and `:642-646` rejects anything longer with a typed error as the last bound.

**Output.** mp3 at 22050 Hz. No conversion happens. The run-task frame sets `format: 'mp3'` and `sample_rate: 22050` at `lib/audio/qwen-token-plan-ws.ts:187-195`. `audioMime` at `lib/server/agent-runtime/scene-tts.ts:40-41` maps mp3, and Dexie stores the format string.

**Error mapping.** Throw a typed error class that extends `QwenTTSError` at `lib/audio/tts-providers.ts:134-143`. `QwenTokenPlanTTSError` at `lib/audio/qwen-token-plan-ws.ts:48-62` extends it and defaults to HTTP 502. A task-failed frame maps to 502 with the vendor error fields at `:202-212`. The route branch is an `instanceof QwenTTSError` check at `app/api/generate/tts/route.ts:173-175`. A look-alike class would fall through to the 500 `GENERATION_FAILED` path. Extending keeps the route untouched and preserves code plus httpStatus mapping.

**Abort and timeout.** Reuse the `ttsRequestSignal` pattern at `lib/audio/tts-providers.ts:176-179`. Default timeout is 30 seconds (`:152`). An abort closes the socket. `timeoutOrAbortError` at `lib/audio/qwen-token-plan-ws.ts:133-142` maps a timed-out signal to `TTSRequestTimeoutError` and a caller cancel to the standard AbortError.

**Environment.** Add `TTS_QWEN_TOKEN_PLAN_API_KEY`, `TTS_QWEN_TOKEN_PLAN_BASE_URL`, and `TTS_QWEN_TOKEN_PLAN_MODELS` at `.env.example:132-137`. Add entry `TTS_QWEN_TOKEN_PLAN: 'qwen-token-plan-tts'` to the `TTS_ENV_MAP` at `lib/server/provider-config.ts:92`. The neutrality debt table pins qwen at 22 after the new entry and resolver lines raise the count from 20.

**Registry records.** Add entries to `DEFAULT_TTS_VOICES` at `lib/audio/constants.ts:1382` and `DEFAULT_TTS_MODELS` at `:1396`. Add the per-provider settings default at `lib/store/settings.ts:492-497` with the pinned plus model.

**i18n.** Add provider display key `settings.providerQwenTokenPlanTTS` across 12 locales. Add voice description keys `qwenTpVoiceLonganlingxin` and `qwenTpVoiceLonganlufeng`. Add the `voiceListCapped` hint key per locale for the picker cap. Add the map entry `'qwen-token-plan-tts': 'settings.providerQwenTokenPlanTTS'` to `TTS_PROVIDER_NAME_KEYS` at `lib/audio/provider-display.ts:36`. Without it the settings UI renders the raw id. Each locale file ships 4 keys.

**Base-voice ingestion.** Commit the generated data file. Add generator script `scripts/generate-qwen-token-plan-voices.mjs`. The script re-downloads the vendor XLSX and rebuilds the data file deterministically. License note: the vendor artifact redistributes inside the app repo. The vendor states no explicit license. Record this as an accepted risk for a local fork.

## Testing Decisions

Hermetic tests mock the `undici` module with `vi.mock('undici')` and a scripted fake WebSocket class. The fake scripts event frames and binary chunks. The shared fake lives at `tests/audio/helpers/qwen-tp-fake-ws.ts`. The transport imports the class from `undici`, so stubbing the global would not intercept it. The analog is `tests/audio/doubao-tts.test.ts`. The S2 suite at `tests/audio/qwen-token-plan-tts.test.ts` runs 14 tests.

Route-level tests follow `tests/server/tts-route-missing-key.test.ts`. The prefix list at `tests/server/tts-route-missing-key.test.ts:84` grows by `TTS_QWEN_TOKEN_PLAN`. The suite also proves `QwenTokenPlanTTSError` maps through the route branch (`:180-193`).

The env prefix list at `tests/server/provider-config.test.ts:8-60` grows by `TTS_QWEN_TOKEN_PLAN`. The provider resolves keys, base URLs, and the pinned model (`:1002-1009`).

One opt-in live smoke test is gated by `TEST_LOAD_LOCAL_ENV=1`. The test at `tests/audio/qwen-token-plan-tts-live.test.ts` must skip when `TEST_LOAD_LOCAL_ENV` is not `1` or when the plan key is absent. No other test consumes this loader today (`tests/setup-env.ts:23-41`), and CI runs without `.env.local`. When enabled, it synthesizes `你好，世界` with `longanlingxin` on the plus model and rejects an unknown voice with a typed error. It then proves the pool recovered by synthesizing once more. The live gate observed 22242 bytes for the happy synthesis and 9704-12211 bytes for the recovery synthesis. The test asserts only that bytes exceed 1000. It is S4 tier 4.

A protocol pin test at `tests/audio/qwen-token-plan-tts-protocol.test.ts` records the exact frame sequence and event names from the probes.

The success criteria all met: the classroom pipeline synthesizes mp3 audio, the picker filters by model, the pool reaps and reuses, and every failure maps to a typed route error. Round 3 gate results: S2 14/14, S3 119/119, S5 7156 passed with 0 failed.

### Gate mechanics convention (ledger repair rounds 1-3, per docs/research/001-verification-report.md)

The runner matches a gate's expect string as a literal substring of captured stdout+stderr, or as a `/regex/flags` pattern. A gate passes on exit code 0 AND a match. `'/^/'` therefore means "exit code governs". Silent-success commands use it. That was F1 of round 1.

Tier gate depth is enforced by the CLI: tier 1 needs 1 gate, tier 2 needs 2, tier 3 needs 3 with an integration tag, tier 4 needs 4 with an adversarial tag. The round-1 repair (commit 1a1e45aa) added the missing gates: S2 gained a protocol-suite gate, S3 gained tsc and route-test gates, S4 gained pin, skip-behavior, and neutrality-sentinel gates.

Gate runs must use `bun --no-env-file`. The bun CLI auto-loads `.env.local` into every process, and gate children inherit the keys. The `env -u` sanitized wrapper alone did not stop it. That was F6, root-caused in round 2 and fixed in round 3.

The aggregate suite gate excludes `tests/server/classroom-media-generation.test.ts`. That file calls a live image endpoint and fails at the merge base. Finding F5 also flags a pre-existing key-printing risk in its harness, owned outside this batch.

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

i18n key math: 2 voice description keys plus 1 provider display key, times 12 locales, is 36 keys. The `voiceListCapped` hint key per locale brings the total to 48 keys, 4 per locale file. The shipped locale files carry exactly 4 keys each.

Neutrality guard: the debt table pins vendor token counts in `lib/server/provider-config.ts`. `qwen` counts 22 today, up from 20. The same slice updates `tests/providers/provider-neutrality-guard.test.ts:164-231`.

XLSX provenance: the vendor hosts the base-voice workbooks on `help-static-aliyun-doc.aliyuncs.com`. File names are `qwen-audio-3.0-tts-plus-base-voices-en.xlsx` and `qwen-audio-3.0-tts-flash-base-voices-en.xlsx`. The generator script resolves the full paths from the voice-list page `docs.qwencloud.com/api-reference/speech-synthesis/qwen-audio-tts/voice-list`.

---

Status: Implemented (Batch 001, commits 0c32d529..afd4e546). Post-impl learnings appended below.

## Post-implementation learnings

1. **undici import replaced the global WebSocket.** The module imports `WebSocket` from `undici` at `lib/audio/qwen-token-plan-ws.ts:19`. The global variant is stable only from Node 22.4 while `engines.node` allows >= 20.9.0 (`package.json:7`). Commit ffd70145.

2. **Dynamic-import dispatch case.** `generateTTS` loads the client with `await import('./qwen-token-plan-ws')` at `lib/audio/tts-providers.ts:238`. The client subclasses `QwenTTSError` from this file. A static import creates an ESM cycle, so the case loads the client lazily. Commit ffd70145.

3. **globalThis-anchored pool singleton.** The pool binding lives on `globalThis` at `lib/audio/qwen-token-plan-ws.ts:685-691`. A Next dev hot reload reuses the same pool instead of leaking orphan sockets per module re-evaluation. Commit ffd70145.

4. **QwenTokenPlanTTSError extends QwenTTSError, 502 on task-failed.** The class at `lib/audio/qwen-token-plan-ws.ts:48-62` defaults to HTTP 502. A task-failed frame maps to 502 with the vendor error fields at `:202-212`. The route branch at `app/api/generate/tts/route.ts:173-175` stayed untouched. Commit ffd70145.

5. **TTS_MAX_TEXT_LENGTH registration necessity.** The entry at `lib/audio/tts-utils.ts:14` is what makes the upstream splitter act. Without it `splitLongSpeechActions` returns actions unsplit at `:83-85`. This was soundness blocker B2. Commit ffd70145.

6. **generateTTS dispatch switch mandatory case.** The `default` branch throws `Unsupported TTS provider` at `lib/audio/tts-providers.ts:264`. A missing case fails every synthesis. This was soundness blocker B1. Commit ffd70145.

7. **provider-display map entry necessity.** The entry at `lib/audio/provider-display.ts:36` stops the settings UI from rendering the raw id. This was soundness concern C1. Commit 4bc388d6.

8. **Plus-only correction after flash probes.** Live probes on 2026-08-31 returned `Model not exist` for `qwen-audio-3.0-tts-flash` across three voice combinations. The probe evidence is recorded at `docs/meta-specs/qwen-token-plan-integration.md:40`. Correction commits: 3f466bc7 (spec and ledger rebind to plus scope) and 9c4fafa6 (drop flash records, keys, and the flash workbook from the data file).

9. **94,506 B isolated client bundle delta.** The 597-record data file enters the client bundle through `lib/audio/constants.ts:46`. The picker cap at `components/agent/agent-bar.tsx:32` and the hint at `:340-346` bound the rendering cost. Commit 4bc388d6.

10. **bun --no-env-file gate-runner requirement.** The bun CLI auto-loads `.env.local` into every `bun cli.ts` process, and gate children inherit the keys. The `env -u` wrapper alone did not stop it. The operative fix is `bun --no-env-file` for ledger invocations that run gates. That was F6, root-caused in round 2 and fixed in round 3. The `'/^/'` oracle semantics mean "exit code governs", F1 of round 1.

11. **Live-verified bytes.** The live gate observed 22242 bytes for the happy plus synthesis and 9704-12211 bytes for the recovery synthesis. The test asserts only that bytes exceed 1000.

12. **Open items.** F7: five function postconditions lack signature fields, so diffs show spurious deviates only. F5: the pre-existing harness at `tests/server/classroom-media-generation.test.ts` prints a live bearer key in one excluded test's failure output. Both are outside this batch's code.
