# Qwen Token Plan Integration (meta-spec)

Meta-spec status: research

## 1. Purpose

This work body integrates the operator's Qwen Cloud token plan into OpenMAIC. The plan is a single `sk-sp-` key on host `token-plan.ap-southeast-1.maas.aliyuncs.com`. The key spans LLM, image, video, ASR, and TTS. The meta-spec records the verified endpoint truth table, the error taxonomy, and the child batch register. Each child batch runs its own full RIVR cycle with its own spec, ledger, branch, and merge. The first two batches deliver a WebSocket TTS provider and a synchronous ASR provider. Later batches register the plan as a one-click preset and extend video inputs.

## 2. Operator context

The operator holds an individual token-plan account. Keys use the `sk-sp-` prefix. The service host is `token-plan.ap-southeast-1.maas.aliyuncs.com`. The plan catalog lists these models exactly:

- LLM: `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-plus`, `qwen3.7-max`, `qwen3.6-flash`, `deepseek-v4-pro-0813`, `deepseek-v4-pro`, `deepseek-v4-flash-0731`, `glm-5.2`
- Image: `qwen-image-3.0-pro`, `wan2.7-image`, `wan2.7-image-pro`
- Speech: `qwen-audio-3.0-asr-flash`, `qwen-audio-3.0-tts-plus`, `qwen-audio-3.0-realtime-plus`
- Video: `happyhorse-1.1-i2v`, `happyhorse-1.1-t2v`, `happyhorse-1.1-r2v`

## 3. Verified endpoint truth table (probes dated 2026-08-31)

| Modality | Endpoint | Result |
| --- | --- | --- |
| LLM | `/compatible-mode/v1/chat/completions` | 200. Includes `qwen3.8-max` with reasoning output. |
| TTS | `wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference` | 200 task. WebSocket only. |
| ASR | `/api/v1/services/aigc/multimodal-generation/generation` | 200 sync. |
| Image | `/api/v1/services/aigc/multimodal-generation/generation` | 200 sync. |
| Video t2v | `/api/v1/services/aigc/video-generation/video-synthesis` | 200 async. |
| Voice enrollment | `/api/v1/services/audio/tts/customization` | 404 for all models. Vendor gap. |
| Realtime | no app surface | not integrated. |

TTS protocol facts, from the SpeechSynthesizer frame protocol:

- Frames: `run-task{}`, then `continue-task{input.text}`, then `finish-task`.
- Server events: `task-started`, `result-generated`, `task-finished`.
- Audio arrives as binary mp3 frames. The client concatenates frames in receive order.
- One serialized task per connection. Idle timeout is 60 seconds. The fragment gap limit is 23 seconds.
- A `task-failed` event kills the connection.
- Model: `qwen-audio-3.0-tts-plus`.
- System voices for plus are `longanlingxin` and `longanlufeng`. The vendor doc example `longxiaochun` is an error. It returns engine 411.
- Base voices: 597 for the plus model from vendor XLSX. Ids look like `qwen-audio-3.0-tts-plus-longcanzhuyue`.
- The sibling model `qwen-audio-3.0-tts-flash` is NOT provisioned on the personal plan. Live probes on 2026-08-31 return `Model not exist` for three voice combinations. Batch 001 was corrected to plus-only scope.
- No HTTP TTS endpoint exists on this host. `qwen3-tts-flash` returns 404 model-not-exist.

ASR protocol facts:

- Content item type `input_audio`. The `parameters.format` and `parameters.sample_rate` fields are mandatory.
- Response text sits at top-level `.text`. It is not under `output.choices`. The repo parser at `lib/audio/asr-providers.ts:421-425` reads `output.choices`, so it throws on this shape.
- `qwen3-asr-flash` and all `filetrans` variants are 404 absent.

Image protocol facts:

- Both `qwen-image-3.0-pro` and `wan2.7-image` return 200 on the shared path.
- Content part shapes differ: `{image}` versus `{type:image,image}`.
- `lib/media/adapters/qwen-image-adapter.ts:116` reads `.image` with `content.find`, so both shapes work.

Video protocol facts:

- Submission sends header `X-DashScope-Async: enable`.
- The client polls `/api/v1/tasks/{id}` for the result.

## 4. Error taxonomy

| Class | Shape | Meaning |
| --- | --- | --- |
| 404 | `Model not exist` | The model is absent from the registry. |
| 400 | `url error, please check url！` | The model exists, the endpoint is wrong. |
| 400 | empty `{}` | The payload was rejected. Missing `parameters` and no speech in the audio both produce it. |

## 5. Child batch register

| Batch | Name | Status |
| --- | --- | --- |
| 001 | `tts-ws-provider` | **Closed and certified 2026-08-31.** All 5 slices verified, live protocol proven, proof hash 955fea98. |
| 002 | `asr-sync-provider` | **Closed and certified 2026-09-01.** All 4 slices verified in 2 rounds, live transcript proof, proof hash 1b751a68. |
| 003 | `token-plan-preset-registration` | **Closed and certified 2026-09-01.** Five-target preset, asr modality, 4/4 slices, hermetic cycle, proof 1389e23f. |
| 004 | `video-i2v-r2v` | queued. |
| 005 | `media-test-redaction` | queued. |
| 006 | `asr-preflight-parity` | queued. Final batch. |
| blocked | `voice-cloning` | vendor gap, probe evidence. |
| documented-only | `realtime` | no app surface. |

Batch 002 scope: a synchronous provider for `qwen-audio-3.0-asr-flash` on the multimodal-generation path. The parser reads top-level `.text`. Provider id `qwen-token-plan-asr`. Env prefix `ASR_QWEN_TOKEN_PLAN_*`. The store already has `setASRProviderConfig` at `lib/store/settings.ts:303`.

Batch 003 scope: the `TokenPlanModality` union gains `asr`. Today the union at `lib/config/token-plan-presets.ts:20` is `llm | image | video | tts | webSearch`. The apply and remove switch cases live in `lib/config/apply-token-plan.ts`. The union growth also forces entries in `MODALITY_LABEL_KEYS` and `MODALITY_ICONS` (`components/settings/token-plan-settings.tsx:40, :48`) and a `setASRProviderConfig` action in `TokenPlanActions` (`lib/config/apply-token-plan.ts:21-61`, absent today). The UI tab lives at `components/settings/token-plan-settings.tsx`. The preset declares the `llm`, `image`, `video`, `tts`, and `asr` modality targets. The video target serves `happyhorse-1.1-t2v` until batch 004 adds i2v and r2v. Targets reuse provider ids `qwen`, `qwen-image`, `happyhorse`, plus batch-001 id `qwen-token-plan-tts` and batch-002 id `qwen-token-plan-asr`. The batch adds token-plan preset pointers inside existing `.env.example` sections (batches 001 and 002 already added the TTS and ASR sections). It adds a new `server-providers.yml.example` file. None exists today. Samples live at `README.md:141-158` and `packages/docs/content/docs/configuration.mdx:254-296`. It updates the README and docs provider tables. Batch 003 adds no new i18n keys. Batch 001 added 48 and batch 002 added 12 (see their specs).

Batch 004 scope: `lib/media/adapters/happyhorse-adapter.ts:104-115` sends `input.prompt` only. The batch adds first-frame and reference-image inputs for `happyhorse-1.1-i2v` and `happyhorse-1.1-r2v`, the registry capability metadata, and the model rows in the yml example plus the six `supported-models*.mdx` docs files. It updates the model list at `lib/media/video-providers.ts:112-122`.

Batch 005 scope (closes finding F5): `tests/server/classroom-media-generation.test.ts` prints a live bearer key in its failure output. The trigger is vitest serializing the fetch-mock call init when an assertion fails while a host `server-providers.yml` beats env stubs (`resolveSectionApiKey` returns YAML first); the sentinel reproduction is recorded in the batch-005 spec. The batch makes the affected server tests hermetic against the YAML file, replaces whole-init matchers with scalar reads, and adds a hermetic guard test proving a fixture key never reaches output. Operator extension: five same-shape `tests/audio` sites are fixed in the same batch, so the leak class closes program-wide. No product code changes. The full-suite gate runs without the batch-001 exclusion as the retirement proof; the closed 001 ledger text stays untouched. Evidence: `docs/research/001-verification-report.md` finding F5.

Batch 006 scope (final batch, operator request 2026-09-01): transcription route key preflight parity. `app/api/transcription/route.ts` has no missing-key contract. A request without a configured ASR key takes the generic 500 error path for every ASR provider. The batch adds the 400 `MISSING_API_KEY` preflight that `app/api/generate/tts/route.ts:112-119` already enforces for TTS, then adds the per-provider missing-key test matrix across the ASR registry. It changes route behavior for all ASR providers, so it ships as its own cycle with its own approval.

Blocked record `voice-cloning`: every enrollment model returns 404. The re-check trigger is an enrollment model appearing in the plan catalog.

Documented-only record `realtime`: the re-check trigger is the app building a realtime voice surface.

## 6. Governance

The meta-ledger lives at `.rivr/meta-specs/qwen-token-plan-integration.ledger.json`, kind `metaspec`. Each child has one ledger at `.rivr/specs/`. Each child runs its own full RIVR cycle. The human approves each spec before its ledger builds. Each batch works on branch `feat/qwen-token-plan-<child>`. Each child ledger accept is followed by a local no-fast-forward merge to `main`. The operator holds merge authority. No push happens.

## 7. Cross-cutting constraints

Publishable-package exemption: no touched file lives under `packages/@openmaic/*`. The version-bump check does not apply. The claim is grounded in grep over `lib/`, which finds zero WebSocket usage and no package references.

Neutrality debt table: `tests/providers/provider-neutrality-guard.test.ts` pins vendor token counts in `lib/server/provider-config.ts`. Since batches 001-003 the live guard reads `qwen` 24, `minimax` 13, plus `token` and `plan` rows. The same slice that adds an env prefix updates the table.

Route status-code boundary (batch 006 note): capability routes answer the missing-key case with 400 (tts, transcription) or 401 (image, video). Program-wide normalization is a future operator decision, not deferred batch work.

i18n parity: `pnpm check:i18n-keys` enforces key parity across 12 locales.

`.env.example` rule: `CONTRIBUTING.md` requires new operator-facing variables in the same PR.

Preset clobber caveat: re-apply and remove overwrite per-modality edits on the same provider ids. The precedent test is `tests/config/token-plan-apply-persist.test.ts`.

Precedence chain: server env and yml win per field over the client store. `resolveSectionApiKey` and `resolveSectionBaseUrl` at `lib/server/provider-config.ts:602-620` return the managed server value first. A managed provider key beats the client key.

Per-modality independence: individual per-modality configuration must keep working without the preset. This is an operator requirement.

## 8. Naming decisions (frozen by operator)

- Provider ids: `qwen-token-plan-tts`, `qwen-token-plan-asr`.
- Env prefixes: `TTS_QWEN_TOKEN_PLAN_*`, `ASR_QWEN_TOKEN_PLAN_*`.
- Preset id: `qwen-token-plan`.
- Pool knob: `OPENMAIC_QWEN_TOKEN_PLAN_WS_POOL_SIZE`. The draft name `OPENMAIC_QWEN_TP_WS_POOL_SIZE` is retired for consistency.
- Voices: i18n via description keys, per operator answer Q3-b.

## 9. Risks

Connection pool concurrency quota: the vendor does not document it. The quota is support-gated. The default pool of 2 is conservative.

WS binary frame ordering: the client concatenates frames in receive order. The vendor documents this ordering.

Realtime vision flags: `capabilities.vision` is not present for the new LLM ids in the catalog. This stays out of batch scope and is recorded here.

---

Status: Reviewed for soundness (docs/research/001-spec-soundness-review.md). Blockers B1-B3 and concerns C1-C5 folded in. Awaiting human approval.
