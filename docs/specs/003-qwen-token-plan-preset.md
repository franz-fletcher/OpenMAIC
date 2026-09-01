# Batch 003 spec: qwen-token-plan preset registration

Spec status: implementation

## Problem Statement

The operator holds one `sk-sp-` key. The key spans LLM, image, video, TTS, and ASR. The providers exist. The env prefixes exist. The Settings Token Plan page still has no preset for the plan. A user must configure five providers by hand. The preset system supports multi-modal plans. The union at `lib/config/token-plan-presets.ts:20` lacks an `asr` member. Batch 003 registers the plan as a one-click preset.

## Solution

The batch adds the `qwen-token-plan` preset to `TOKEN_PLAN_PRESETS`. The union `TokenPlanModality` gains `asr`. The apply and remove switches gain `asr` cases. The settings tab gains the asr label and icon. The preset declares five modality targets. The video target serves `happyhorse-1.1-t2v` only until batch 004. The batch adds env and yml examples. It updates the README and docs provider tables. No new keys for the preset itself. The 48 batch-001 and 12 batch-002 keys cover provider and voice labels (standing Q3-b naming policy: provider and system-voice labels are i18n keys). No provider code changes. Server env precedence stays untouched.

## User Stories

1. As a token-plan user, I want to paste one key in Settings Token Plan, so that all five modalities configure at once.
2. As an operator, I want env and yml examples that show the token-plan shape, so that a deployment configures the plan without the UI.
3. As an existing Qwen user, I want my individual env config to keep working, so that server precedence is unchanged.
4. As a developer, I want the precedence rule pinned by tests, so that a future refactor cannot break it.
5. As a docs reader, I want the provider tables to list the token-plan providers, so that the catalog is complete.

## Slices

**S1: Union growth, ASR apply and remove, and the Qwen preset** (risk tier 2)
Intent: add the `asr` union member, the asr apply and remove cases, the UI label and icon, and the full preset entry. Existing apply/remove test expectations that enumerate modality results must gain `asr` in `MODALITY_ORDER` position.
Stories: 1, 4.
Blockers: none.
Proposed gates:
- G1.1 `npx vitest run tests/config/apply-token-plan.test.ts` expect `passed`
- G1.2 `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`
- G1.3 `pnpm check:i18n-keys` expect `passed`

**S2: Precedence and clobber pins** (risk tier 3, integration gate)
Intent: pin the rule that a server-managed env or yml value wins over the client preset store, per field. The new test file exposes the covered section list as a top-level `const PRECEDENCE_SECTIONS` so the ledger can anchor a symbol.
Stories: 3, 4.
Blockers: S1.
Proposed gates:
- G2.1 `npx vitest run tests/config/token-plan-precedence.test.ts` expect `passed`
- G2.2 `npx vitest run tests/server/provider-config.test.ts` expect `passed` (type integration)
- G2.3 `npx vitest run tests/config/token-plan-apply-persist.test.ts` expect `passed`

**S3: Env and yml examples** (risk tier 2)
Intent: add the token-plan comment pointers to `.env.example` and create the new `server-providers.yml.example`. The new example test exposes the asserted id list as a top-level `const EXAMPLE_TOKEN_PLAN_IDS` so the ledger can anchor a symbol.
Stories: 2.
Blockers: none.
Proposed gates:
- G3.1 `npx vitest run tests/server/server-providers-example.test.ts` expect `passed`
- G3.2 `npx vitest run tests/server/provider-config.test.ts` expect `passed`

**S4: Docs slice** (risk tier 2)
Intent: update the README pair and the docs provider tables with the token-plan providers. `README.md` gains a `Token Plan` subsection heading as the ledger anchor.
Stories: 5.
Blockers: none.
Proposed gates:
- G4.1 `grep -l "qwen-token-plan" README.md README-zh.md packages/docs/content/docs/configuration.mdx packages/docs/content/docs/supported-models.mdx | wc -l` expect `4` (content gate; prettier cannot gate these files because `.prettierignore` skips `*.md` and `packages/docs/` — soundness review B1)
- G4.2 `grep -n "qwen-token-plan-asr" packages/docs/content/docs/supported-models.mdx` expect `qwen-token-plan-asr`

## Implementation Decisions

**Union growth.** Add `'asr'` to `TokenPlanModality` at `lib/config/token-plan-presets.ts:20`. Add `'asr'` to `MODALITY_ORDER` at `:62`, between `tts` and `webSearch`. The apply loop at `lib/config/apply-token-plan.ts:87` and the remove loop at `:237` iterate this order, so the result list and the tab bar both gain asr.

**Preset entry.** Add one entry to `TOKEN_PLAN_PRESETS` at `lib/config/token-plan-presets.ts:77-204`. Use `id: 'qwen-token-plan'`, `category: 'token_plan'`, `icon: '/logos/qwen.svg'`, `apiKeyPlaceholder: 'sk-sp-...'`. The display name is the literal string `Qwen Token Plan`, matching the MiniMax pattern at `:81` and the Volcengine pattern at `:140`. No websiteUrl. The name renders verbatim at `components/settings/token-plan-settings.tsx:184`. No i18n key is needed. (Operator round: all recommendations adopted, Q5.)

**Per-modality targets.** The preset declares five targets.

- LLM: `providerId: 'qwen'`, `baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'`, `apiFormat: 'openai'`. The built-in qwen entry at `lib/ai/providers.ts:721-727` is type `openai` with the dashscope compatible-mode base. The token-plan host mirrors that path, per the probe table at `docs/meta-specs/qwen-token-plan-integration.md:22`.
- Image: `providerId: 'qwen-image'`, `baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com'`. The adapter appends `/api/v1/services/aigc/multimodal-generation/generation` at `lib/media/adapters/qwen-image-adapter.ts:46`. A baseUrl that already ends in `/api/v1` would double the path.
- Video: `providerId: 'happyhorse'`, `baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com'`. The adapter appends `/api/v1/services/aigc/video-generation/video-synthesis` at `lib/media/adapters/happyhorse-adapter.ts:98`.
- TTS: `providerId: 'qwen-token-plan-tts'`, `baseUrl: 'wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference'`, `defaultModelId: 'qwen-audio-3.0-tts-plus'`. These match `lib/audio/constants.ts:711-716`.
- ASR: `providerId: 'qwen-token-plan-asr'`, `baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1'`, `defaultModelId: 'qwen-audio-3.0-asr-flash'`. These match `lib/audio/constants.ts:1238-1242`.

**Model lists.** LLM `defaultModels` carries the full operator catalog at `docs/meta-specs/qwen-token-plan-integration.md:13`, best-first: `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-plus`, `qwen3.7-max`, `qwen3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-pro-0813`, `deepseek-v4-flash-0731`, `glm-5.2` (operator Q1). Image `defaultModels` carries the two probed ids `qwen-image-3.0-pro` and `wan2.7-image`; the unprobed `wan2.7-image-pro` stays out (operator Q2). Video `defaultModels` carries `happyhorse-1.1-t2v` only (operator Q4). The seeded ids resolve through `catalogModelFor` at `lib/config/apply-token-plan.ts:107-120`. Ids absent from every catalog get a bare record with streaming, tools, and no vision. The `defaultModelId` field comment at `lib/config/token-plan-presets.ts:41` widens from TTS-only to TTS and ASR.

**TokenPlanActions.** Add `setASRProviderConfig` to the interface at `lib/config/apply-token-plan.ts:21-61`. Mirror the store signature at `lib/store/settings.ts:303-313`. The store state key is `asrProvidersConfig` at `:121`.

**Apply case.** Add `case 'asr'` to `applyModality` at `lib/config/apply-token-plan.ts:155-221`. Call `actions.setASRProviderConfig('qwen-token-plan-asr', { apiKey, baseUrl, enabled: true, ...(target.defaultModelId ? { modelId: target.defaultModelId } : {}) })` (operator Q3: enabled flip mirrors tts). This mirrors the tts case at `:206-213`. The enabled flip matches the image, video, tts, and webSearch cases.

**Remove case.** Add `case 'asr'` to `removeModality` at `lib/config/apply-token-plan.ts:262-319`. Call `setASRProviderConfig` with `apiKey: ''`, `baseUrl: ''`, `enabled: false`. Mirror the tts case at `:306-312`.

**UI wiring.** Add `asr: 'settings.asrSettings'` to `MODALITY_LABEL_KEYS` at `components/settings/token-plan-settings.tsx:40-46`. The key exists in all 12 locales at `lib/i18n/locales/en-US.json:1363`. Add an `asr` icon to `MODALITY_ICONS` at `:48-54`. Pass `setASRProviderConfig` in `handleApply` at `:126-136` and `disablePreset` at `:103-110`. The exhaustive records force these entries at compile time, so a missing entry fails `tsc`.

**Precedence narrative.** The server env and yml win per field. `resolveSectionApiKey` and `resolveSectionBaseUrl` at `lib/server/provider-config.ts:604-622` return the managed server value first. A preset writes the client store only. When both exist, the server value wins. This is the batch-002 doctrine at `docs/specs/002-qwen-token-plan-asr.md:87`. Individual per-modality env config keeps working because no batch-003 code touches `provider-config.ts`.

**Clobber caveat.** Re-apply and remove overwrite per-modality edits on the same provider ids. The preset shares ids `qwen`, `qwen-image`, and `happyhorse` with individual config. Apply clobbers the client-side values for those ids. The precedent regression test stays green at `tests/config/token-plan-apply-persist.test.ts:31-65`.

**Env example.** Add token-plan preset comment pointers to `.env.example`. The TTS section at `:132-137` and the ASR section at `:167-170` already carry the prefixes. Add pointers near the Qwen LLM block at `:42-44`, the image block at `:224-225`, and the video block at `:266-267`. Point readers at Settings Token Plan for the one-key path. No new variable is added.

**Yml example.** Create `server-providers.yml.example` at the repo root (operator Q6). The loader reads `server-providers.yml` from `process.cwd()` at `lib/server/provider-config.ts:208-220` and `:354`. The canonical shape is `ServerConfig` at `:42-52` with sections `providers`, `tts`, `asr`, `pdf`, `image`, `video`, and `web-search`. The hyphenated key maps at `:186-192`. Show token-plan examples for `qwen`, `qwen-image`, `happyhorse`, `qwen-token-plan-tts`, and `qwen-token-plan-asr`. All five ids are registered, so yml can configure them.

**Docs.** Add rows for `qwen-token-plan-tts` and `qwen-token-plan-asr` to the tables at `packages/docs/content/docs/supported-models.mdx:57-83`. Add the prefixes to the TTS and ASR sections at `packages/docs/content/docs/configuration.mdx:65-119`. Update the yml sample at `:254-296`. Update the README pair at `README.md:141-160` and `README-zh.md:128-147`. The generic LLM table stays unchanged (operator Q8). Six non-English mdx variants are a later pass (operator Q7).

**Neutrality.** The guard scans only `PROVIDER_NEUTRAL_FILES` and `REGISTRY_SOURCES` at `tests/providers/provider-neutrality-guard.test.ts:35-47,58-90`. `lib/config/token-plan-presets.ts` is in neither list. The preset strings never hit the guard. Batch 003 adds no env prefix, so the debt table at `:164-217` stays unchanged.

## Testing Decisions

The file `tests/config/apply-token-plan.test.ts` has 9 cases today. The batch adds the asr path to it. `makeActions` at `:9-17` gains `setASRProviderConfig`. New cases cover the qwen preset apply, the qwen preset remove, and the failing-modality isolation at `:186-198`. The result list must include `asr` in order, matching `MODALITY_ORDER`.

The new file `tests/config/token-plan-precedence.test.ts` pins the precedence rule. It applies the qwen preset into the store, then asserts every section wrapper returns the server-managed value when both exist: `resolveApiKey`/`resolveBaseUrl` (llm), `resolveTTSApiKey`/`resolveTTSBaseUrl`, `resolveASRApiKey`/`resolveASRBaseUrl`, `resolveImageApiKey`/`resolveImageBaseUrl`, `resolveVideoApiKey`/`resolveVideoBaseUrl` (soundness review C1). It asserts the client value when no server entry exists. It asserts that applying the preset never writes a server value. Server-managed state is simulated with the proven env-stub plus module-reload pattern at `tests/server/provider-config.test.ts:64-99`.

The new file `tests/server/server-providers-example.test.ts` parses `server-providers.yml.example` through the loader. The loader itself is not path-parameterized (`getConfig` reads only `server-providers.yml` from cwd). The test therefore reads the example file with real fs and injects its content through the existing `yamlOverride` fs-mock pattern at `tests/server/provider-config.test.ts:82-99` (soundness review C2). It asserts the five token-plan ids resolve in their sections.

Gate oracles are literal only. Postcondition records carry after-kind for every symbol; function anchors additionally carry the byte-exact after-signature (verification round-1 finding F1 repair). The installed rivr 0.15.0 times out on `/^/` (batch-002 finding F1). Silent commands echo a literal marker, for example `TSC_OK`. Gate runs pin `cwd` to the repo root (finding F2). After `rivr ledger init-batch`, verify the tier values in the ledger (finding F3: batch 002 recorded all tiers as 2 because of key drift). `rivr capture` cannot parse `.env.example`, `.yml.example`, or `.mdx` (soundness review C3). S3 and S4 use slice-level expectations plus gates for those files. `TOKEN_PLAN_PRESETS` carries a short after-signature `TokenPlanPreset[]`; the full contract lives in the slice expectation (review C4). Full after-signatures apply to `TokenPlanModality`, `MODALITY_ORDER`, `applyModality`, and `removeModality`.

## Out of Scope

- No provider code changes. The adapters and registries stay as they are.
- No new i18n keys. The provider display names and system-voice labels already ship as keys from batches 001-002. `settings.asrSettings` exists in all 12 locales.
- No `webSearch` target in the preset. The plan catalog has no web-search entry.
- No video i2v or r2v. Batch 004 adds them.
- No live probes. The endpoints were verified on 2026-08-31.
- No changes to `lib/server/provider-config.ts`. The env maps already cover all five prefixes.
- No changes to individual per-modality env behavior.

## Further Notes

Dependency: batch 004 extends the video target with i2v and r2v at `lib/media/video-providers.ts:112-122`.

Rollback: revert the merge. No stored data references the preset id.

Clobber warning: applying the preset overwrites client-side values for `qwen`, `qwen-image`, and `happyhorse`. Server-managed values are unaffected.

Docs locale scope (settled, operator Q7): update the English mdx sources plus both READMEs. The six non-English mdx variants stay for a later pass.

i18n math: zero new keys across 12 locales.

Thinking-control limitation (soundness review C5): seeded catalog ids like `qwen3.8-max` have no `model-metadata.ts` thinking entries, so the preset's models render without the thinking toggle. Generation is unaffected. The volcengine preset ships the same shape. The operator accepts this.

Docs prettier limitation (review B1): `.prettierignore` excludes `*.md` and `packages/docs/`, so repo formatting does not gate the docs files this batch edits. Gate G4.1 is a content-count gate instead.
