# Batch 003 spec: qwen-token-plan preset registration

Spec status: research_update

## Problem Statement

The operator holds one `sk-sp-` key. The key spans LLM, image, video, TTS, and ASR. The providers exist. The env prefixes exist. The Settings Token Plan page still has no preset for the plan. A user must configure five providers by hand. The preset system supports multi-modal plans. The union at `lib/config/token-plan-presets.ts:20` lacked an `asr` member. Batch 003 registers the plan as a one-click preset.

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
Blockers: none. Status: verified (round 1 gates, re-proven round 2 after the postcondition repair).
Proposed gates:
- G1.1 `npx vitest run tests/config/apply-token-plan.test.ts` expect `passed`
- G1.2 `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`
- G1.3 `pnpm check:i18n-keys` expect `passed`

**S2: Precedence and clobber pins** (risk tier 3, integration gate)
Intent: pin the rule that a server-managed env or yml value wins over the client preset store, per field. The new test file exposes the covered section list as a top-level `const PRECEDENCE_SECTIONS` so the ledger can anchor a symbol.
Stories: 3, 4.
Blockers: S1. Status: verified.
Proposed gates:
- G2.1 `npx vitest run tests/config/token-plan-precedence.test.ts` expect `passed`
- G2.2 `npx vitest run tests/server/provider-config.test.ts` expect `passed` (type integration)
- G2.3 `npx vitest run tests/config/token-plan-apply-persist.test.ts` expect `passed`

**S3: Env and yml examples** (risk tier 2)
Intent: add the token-plan comment pointers to `.env.example` and create the new `server-providers.yml.example`. The new example test exposes the asserted id list as a top-level `const EXAMPLE_TOKEN_PLAN_IDS` so the ledger can anchor a symbol.
Stories: 2.
Blockers: none. Status: verified.
Proposed gates:
- G3.1 `npx vitest run tests/server/server-providers-example.test.ts` expect `passed`
- G3.2 `npx vitest run tests/server/provider-config.test.ts` expect `passed`

**S4: Docs slice** (risk tier 2)
Intent: update the README pair and the docs provider tables with the token-plan providers. `README.md` gains a `Token Plan` subsection heading as the ledger anchor.
Stories: 5.
Blockers: none. Status: verified.
Proposed gates:
- G4.1 `grep -l "qwen-token-plan" README.md README-zh.md packages/docs/content/docs/configuration.mdx packages/docs/content/docs/supported-models.mdx | wc -l` expect `4` (content gate; prettier cannot gate these files because `.prettierignore` skips `*.md` and `packages/docs/` — soundness review B1)
- G4.2 `grep -n "qwen-token-plan-asr" packages/docs/content/docs/supported-models.mdx` expect `qwen-token-plan-asr`

## Implementation Decisions

**Union growth.** The union gained `'asr'` at `lib/config/token-plan-presets.ts:20`. The stale comment that read "ASR is omitted" was removed at `:19` (verification finding F2). `MODALITY_ORDER` gained `'asr'` between `tts` and `webSearch`, shipped as a multi-line array at `:62-69`. The apply loop at `lib/config/apply-token-plan.ts:87` and the remove loop at `:237` iterate this order. The result list and the tab bar both include asr.

**Preset entry.** The entry shipped at `lib/config/token-plan-presets.ts:212-257`, appended after the Volcengine entry. It uses `id: 'qwen-token-plan'`, `category: 'token_plan'`, `icon: '/logos/qwen.svg'`, `apiKeyPlaceholder: 'sk-sp-...'`, and the literal name `Qwen Token Plan`. No websiteUrl. The MiniMax pattern at `:81` and the Volcengine pattern at `:140` set the style. The name renders verbatim at `components/settings/token-plan-settings.tsx:212`. No i18n key was added.

**Per-modality targets.** The preset declares five targets.

- LLM: `providerId: 'qwen'`, `baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'`, `apiFormat: 'openai'`. The built-in qwen entry at `lib/ai/providers.ts:721-727` is type `openai` with the dashscope compatible-mode base. The token-plan host mirrors that path, per the probe table at `docs/meta-specs/qwen-token-plan-integration.md:22`.
- Image: `providerId: 'qwen-image'`, `baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com'`. The adapter appends `/api/v1/services/aigc/multimodal-generation/generation` at `lib/media/adapters/qwen-image-adapter.ts:46`. A baseUrl that already ends in `/api/v1` would double the path.
- Video: `providerId: 'happyhorse'`, `baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com'`. The adapter appends `/api/v1/services/aigc/video-generation/video-synthesis` at `lib/media/adapters/happyhorse-adapter.ts:98`.
- TTS: `providerId: 'qwen-token-plan-tts'`, `baseUrl: 'wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference'`, `defaultModelId: 'qwen-audio-3.0-tts-plus'`. These match `lib/audio/constants.ts:711-716`.
- ASR: `providerId: 'qwen-token-plan-asr'`, `baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1'`, `defaultModelId: 'qwen-audio-3.0-asr-flash'`. These match `lib/audio/constants.ts:1238-1242`.

**Model lists.** LLM `defaultModels` carries the full operator catalog at `docs/meta-specs/qwen-token-plan-integration.md:13`, best-first: `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-plus`, `qwen3.7-max`, `qwen3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-pro-0813`, `deepseek-v4-flash-0731`, `glm-5.2` (operator Q1). Image `defaultModels` carries the two probed ids `qwen-image-3.0-pro` and `wan2.7-image`; the unprobed `wan2.7-image-pro` stays out (operator Q2). Video `defaultModels` carries `happyhorse-1.1-t2v` only (operator Q4). The seeded ids resolve through `catalogModelFor` at `lib/config/apply-token-plan.ts:107-120`. Ids absent from every catalog get a bare record with streaming, tools, and no vision. The `defaultModelId` field comment at `lib/config/token-plan-presets.ts:41-42` now reads "TTS and ASR only".

**TokenPlanActions.** The interface at `lib/config/apply-token-plan.ts:21-61` gained `setASRProviderConfig`. It mirrors the store signature at `lib/store/settings.ts:303-313`. The store state key is `asrProvidersConfig` at `:121`.

**Apply case.** The `asr` case shipped at `lib/config/apply-token-plan.ts:219-226`. It calls `setASRProviderConfig` with `apiKey`, `baseUrl`, `enabled: true`, and `modelId` from `defaultModelId` (operator Q3). The tts case now sits at `:211-218`. The enabled flip matches the image, video, tts, and webSearch cases.

**Remove case.** The `asr` case shipped at `lib/config/apply-token-plan.ts:326-332`. It calls `setASRProviderConfig` with `apiKey: ''`, `baseUrl: ''`, `enabled: false`. The tts case now sits at `:319-325`. The switch spans `:262-341`.

**UI wiring.** `MODALITY_LABEL_KEYS` gained `asr: 'settings.asrSettings'` at `components/settings/token-plan-settings.tsx:46`. The key exists in all 12 locales at `lib/i18n/locales/en-US.json:1363`. `MODALITY_ICONS` gained the `Mic` icon at `:55`. The store binding for `setASRProviderConfig` sits at `:74`. `disablePreset` passes it at `:106-115`. `handleApply` passes it at `:128-142`. The exhaustive records forced these entries at compile time.

**Precedence narrative.** The server env and yml win per field. `resolveSectionApiKey` and `resolveSectionBaseUrl` at `lib/server/provider-config.ts:604-622` return the managed server value first. A preset writes the client store only. When both exist, the server value wins. This is the batch-002 doctrine at `docs/specs/002-qwen-token-plan-asr.md:87`. Individual per-modality env config keeps working because no batch-003 code touches `provider-config.ts`.

**Clobber caveat.** Re-apply and remove overwrite per-modality edits on the same provider ids. The preset shares ids `qwen`, `qwen-image`, and `happyhorse` with individual config. Apply clobbers the client-side values for those ids. The precedent regression test stays green at `tests/config/token-plan-apply-persist.test.ts:31-65`.

**Env example.** The `.env.example` diff is comment-only. The Qwen LLM pointer sits at `:42-44`. The image pointer sits at `:227`. The video pointer sits at `:271`. The TTS prefix at `:135` and the ASR prefix at `:170` predate the batch. The pointers send readers to Settings Token Plan for the one-key path. No new variable was added.

**Yml example.** The file `server-providers.yml.example` shipped at the repo root, 61 lines. It carries five token-plan entries: `qwen`, `qwen-image`, `happyhorse`, `qwen-token-plan-tts`, and `qwen-token-plan-asr`. The loader reads `server-providers.yml` from `process.cwd()` at `lib/server/provider-config.ts:208-220` and `:354`. The canonical shape is `ServerConfig` at `:42-52` with sections `providers`, `tts`, `asr`, `pdf`, `image`, `video`, and `web-search`. The hyphenated key maps at `:186-192`. All five ids are registered, so yml can configure them.

**Docs.** `README.md` gained the Token Plan subsection at `:162-166`. `README-zh.md` gained it at `:149-153`. `supported-models.mdx` gained the TTS row at `:73` and the ASR row at `:84`. `configuration.mdx` gained the yml entries at `:329` and `:334` plus the prefix list updates. The generic LLM table stayed unchanged (operator Q8). Six non-English mdx variants are a later pass (operator Q7).

**Neutrality.** The guard scans only `PROVIDER_NEUTRAL_FILES` and `REGISTRY_SOURCES` at `tests/providers/provider-neutrality-guard.test.ts:35-47,58-90`. `lib/config/token-plan-presets.ts` is in neither list. The preset strings never hit the guard. Batch 003 adds no env prefix, so the debt table at `:164-217` stayed unchanged.

## Testing Decisions

The file `tests/config/apply-token-plan.test.ts` ships 12 cases (was 9). `makeActions` at `:9-17` carries `setASRProviderConfig`. New cases cover the qwen preset apply, the qwen preset remove, and the failing-modality isolation at `:186-198`. The result list includes `asr` in order, matching `MODALITY_ORDER`.

The file `tests/config/token-plan-precedence.test.ts` ships at 360 lines with 23 cases. `PRECEDENCE_SECTIONS` at `:18-44` names the five resolver pairs: `resolveApiKey`/`resolveBaseUrl` (llm), `resolveTTSApiKey`/`resolveTTSBaseUrl`, `resolveASRApiKey`/`resolveASRBaseUrl`, `resolveImageApiKey`/`resolveImageBaseUrl`, `resolveVideoApiKey`/`resolveVideoBaseUrl` (soundness review C1). It asserts the server value wins when both exist, the client value wins when no server entry exists, and apply writes only the client store. The clobber cases at `:287-359` pin re-apply overwrite and untouched modalities. The video section pin uses the `grok-video` id with `VIDEO_GROK_*` env, not `happyhorse`; the resolver contract is section-wide, so any registered video id proves it.

The file `tests/server/server-providers-example.test.ts` ships at 109 lines with 3 cases. It reads `server-providers.yml.example` with real fs and injects the content through the `yamlOverride` fs-mock pattern at `tests/server/provider-config.test.ts:82-99` (soundness review C2). It asserts the five token-plan ids resolve in their sections. The loader itself is not path-parameterized.

Gate oracles are literal only. Postcondition records carry after-kind for every symbol. Function anchors additionally carry the byte-exact after-signature. The installed rivr 0.15.0 times out on `/^/` (batch-002 finding F1). Silent commands echo a literal marker, for example `TSC_OK`. Gate runs pin `cwd` to the repo root (finding F2). `rivr capture` cannot parse `.env.example`, `.yml.example`, or `.mdx` (review C3). S3 and S4 use slice-level expectations plus gates for those files. `TOKEN_PLAN_PRESETS` carries the short after-signature `TokenPlanPreset[]`; the full contract lives in the slice expectation (review C4). Full after-signatures apply to `TokenPlanModality`, `MODALITY_ORDER`, `applyModality`, and `removeModality`.

## Out of Scope

- No provider code changes. The adapters and registries stay as they are.
- No new i18n keys. The provider display names and system-voice labels already ship as keys from batches 001-002. `settings.asrSettings` exists in all 12 locales.
- No `webSearch` target in the preset. The plan catalog has no web-search entry.
- No video i2v or r2v. Batch 004 adds them.
- No live probes. The endpoints were verified on 2026-08-31.
- No changes to `lib/server/provider-config.ts`. The env maps already cover all five prefixes.
- No changes to individual per-modality env behavior.

## Further Notes

Dependency: batch 004 extends the video target models list at `lib/media/video-providers.ts:112-122`. No union change is needed for i2v or r2v; the preset entry already declares the video target.

Rollback: revert the merge. No stored data references the preset id.

Clobber warning: applying the preset overwrites client-side values for `qwen`, `qwen-image`, and `happyhorse`. Server-managed values are unaffected.

Docs locale scope (settled, operator Q7): update the English mdx sources plus both READMEs. The six non-English mdx variants stay for a later pass.

i18n math: zero new keys across 12 locales.

Thinking-control limitation (review C5): seeded catalog ids like `qwen3.8-max` have no `model-metadata.ts` thinking entries, so the preset's models render without the thinking toggle. Generation is unaffected. The volcengine preset ships the same shape. The operator accepts this.

Docs prettier limitation (review B1): `.prettierignore` excludes `*.md` and `packages/docs/`, so repo formatting does not gate the docs files this batch edits. Gate G4.1 is a content-count gate instead.

## Post-implementation learnings

1. **The phantom prettier gate is real.** Prettier 3.8.1 skips files that match `.prettierignore` even when they appear as explicit CLI arguments. It prints the success line and exits 0 on a dirty file. Proof: `SECURITY.md` carries trailing whitespace and passed `prettier --check SECURITY.md`. `.prettierignore:15` ignores `packages/docs/` and `:30` ignores `*.md`. Docs formatting needs content gates. G4.1 shipped as the grep count gate and passed 4/4 in verification.

2. **A slice needs at least one captured target.** `rivr capture` records the before-state per target. Slices without any target fail the contract gate. Markdown headings capture as kind `module` with the heading text as the signature. The S4 anchor `### Token Plan` in `README.md` captured with after-signature `###` and diffed clean 1/1 in round 2.

3. **The init-batch riskTier key works.** The ledger records S1 tier 2, S2 tier 3, S3 tier 2, S4 tier 2. The batch-002 finding F3 recorded all tiers as 2 from key drift. Verify tiers right after init-batch; this batch did and enforcement held.

4. **Every postcondition needs after-kind.** Round 1 showed spurious diff deviates: six S1 postconditions and the S4 README anchor lacked after-kind. The repair cycle cost one correction rebind. Round 2 wrote after-kind on all seven contracts and the diffs ran clean: S1 8/8, S2 1/1, S3 1/1, S4 1/1.

5. **The quality enum is fixed.** Valid values are `VERIFIED`, `INSPECTED`, `INFERRED`, and `UNKNOWN`. The value `required` is invalid and the CLI rejects it.

6. **Seeded models keep no thinking metadata.** Catalog ids like `qwen3.8-max` have no entries at `lib/ai/model-metadata.ts:456-469`. The seeded records render without the thinking toggle. The operator accepted this as review C5.

7. **The loader is cwd-bound.** `getConfig` reads only `server-providers.yml` from `process.cwd()`. The example test reads `server-providers.yml.example` with real fs and injects it through the `yamlOverride` fs-mock. That is the review C2 mechanism, shipped in `tests/server/server-providers-example.test.ts`.

8. **This batch is fully hermetic.** No live test exists. All 10 gates ran without network or vendor calls. Zero vendor spend for the cycle.

9. **One full-suite flake did not reproduce.** A material-tools test failed once during the suite run. Two re-runs passed 31/31. The flake is transient and was not chased.

10. **Batch 004 needs no union change.** The video target entry already exists in the preset. Batch 004 extends only the video target models list with i2v and r2v.

---

Implemented (Batch 003, commits ebeb1eb1..79250730). Post-impl learnings appended above.
