# Batch 004 spec: happyhorse i2v and r2v media input

Spec status: research_update

## Problem Statement

The happyhorse adapter sends only `input.prompt` (`lib/media/adapters/happyhorse-adapter.ts:104-115`). The catalog lists `happyhorse-1.1-i2v` and `happyhorse-1.1-r2v`, but the app cannot use them. No request type carries a source image. The provider model list still shows only `happyhorse-1.0-t2v` (`lib/media/video-providers.ts:112-122`). The token-plan preset pins one video model (`lib/config/token-plan-presets.ts:241-245`), and managed deployments allowlist client models against that list, so i2v and r2v are unreachable there too.

## Solution

Extend the video path to carry public image URLs. `VideoGenerationOptions` gains `firstFrameUrl` and `referenceImageUrls`. The adapter maps them to the vendor `input.media` array and keeps the t2v body byte-identical when neither is set. A provider-agnostic route preflight rejects a missing image before submission. The registry, the preset, the yml example, and the docs list gain the two model ids. All changes stay in app code. No published package file changes.

Vendor schema, pinned by live zero-quota probes on 2026-09-02 (full record in `docs/research/004-spec-soundness-review.md`):

- i2v and r2v both require `input.media` entries shaped `{type, url}`.
- i2v takes exactly one `first_frame`. r2v takes one to nine `reference_image` entries.
- The URL must be a public https link; the vendor fetches it via GET. JPEG, PNG, WEBP.
- `parameters.media_base64` is rejected. Base64 transport does not exist on this product.
- Submit always answers 200 with a PENDING task. Schema and download errors surface on the first poll as FAILED with code `InvalidParameter`, about 0.1 s later. The discriminator is the message: `Field required: input.media` versus `Failed to download <url>`. The adapter renders `code: message` at `happyhorse-adapter.ts:87-91`.

## User Stories

1. As an operator, the token-plan preset exposes all three happyhorse 1.1 video models so i2v and r2v are selectable without manual model entry.
2. As a user, I can generate a video from a first-frame image URL with `happyhorse-1.1-i2v`.
3. As a user, I can generate a video from one to nine reference image URLs with `happyhorse-1.1-r2v`.
4. As a developer, choosing an i2v or r2v model without the required image returns a structured 400 preflight, not an async vendor error.
5. As an operator, the yml example and docs list match the code.

## Slices

| Slice | Title | Shipped reality | Risk tier | Gates |
| --- | --- | --- | --- | --- |
| S01 | Adapter media input | `VideoGenerationOptions` carries `firstFrameUrl?` (`lib/media/types.ts:277`) and `referenceImageUrls?` (`:279`). `submitHappyHorseTask` (`lib/media/adapters/happyhorse-adapter.ts:93`) builds `input.media` from them. One `first_frame` entry for i2v (`:104`). One to nine `reference_image` entries for r2v (`:105-110`). Media omitted when both are absent, so the t2v body stays byte-identical (`:116-118`). `getErrorMessage` renders `code: message` (`:87-91`). Tests: `sends i2v body with first_frame media entry` (`tests/media/happyhorse-adapter.test.ts:65`), `sends r2v body with two reference_image entries` (`:107`), adversarial `rejects unreachable image on poll` (`:197`). | 4 | 4, one adversarial. All passed |
| S02 | Route preflight and orchestrator pass-through | Named `POST` export (`app/api/generate/video/route.ts:43`). It resolves the model (`:91`), then the capability check via `getVideoModelSourceRequirement` (`:104`) returns 400 `MISSING_REQUIRED_FIELD` when the required source is absent (`:107-116`), before `generateVideo` (`:129`). No vendor token appears in the route. `callVideoApi` (`lib/media/media-orchestrator.ts:311`) forwards both fields (`:338-339`). Matrix test `PREFLIGHT_MATRIX` (`tests/server/video-route-preflight.test.ts:38`). | 2 | 2. All passed |
| S03 | Model list, capability metadata, preset extension | `VIDEO_PROVIDERS` (`lib/media/video-providers.ts:23`) lists `happyhorse-1.1-i2v` with `sourceRequirement: 'first_frame'` (`:121`) and `happyhorse-1.1-r2v` with `reference_images` (`:122-126`). New exported helper `getVideoModelSourceRequirement` (`:227-230`) returns the aliased `VideoModelSourceRequirement | undefined`. The alias is declared at `lib/media/types.ts:307`. Preset video `defaultModels` lists the three 1.1 ids (`lib/config/token-plan-presets.ts:244`). | 2 | 2. All passed |
| S04 | Yml example and docs rows | `server-providers.yml.example` lists i2v and r2v (`:63-64`). All six `packages/docs/content/docs/supported-models*.mdx` files list the new models. `tests/server/server-providers-example.test.ts` asserts the three models through the real yml loader (`:110-120`). `.env.example` untouched. | 3 | 3, one integration. All passed |
| S05 | Live protocol proof | `tests/media/happyhorse-live.test.ts` carries `LIVE_IMAGE_URL` (`:7-8`) and the skip guard (`:12-23`). Tests: `missing media rejected` (`:33`), `r2v media array accepted` (`:68`), `i2v completes` (`:106`). The paid i2v run completed SUCCEEDED with a real https video URL in 81.76 s. The r2v download-failure proved array acceptance at zero quota. The missing-media run proved `Field required: input.media`. The file skips without `TEST_LOAD_LOCAL_ENV=1`. | 4 | 4, one adversarial. All passed |

### Gate commands (shipped)

All gates passed. Rounds 1 and 2 recorded the unit and zero-quota gates. Round 3 recorded the paid G5.1 certification run and verified S05. The ledger holds the per-gate evidence.

S01
- G1.1 `npx vitest run tests/media/happyhorse-adapter.test.ts` expect `passed`
- G1.2 `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`
- G1.3 `pnpm check:i18n-keys` expect `passed`
- G1.4 (adversarial) `npx vitest run tests/media/happyhorse-adapter.test.ts -t "rejects unreachable image on poll"` expect `passed`

S02
- G2.1 `npx vitest run tests/server/video-route-preflight.test.ts` expect `passed`
- G2.2 `npx vitest run tests/media/media-orchestrator.test.ts` expect `passed`

S03
- G3.1 `grep -q "happyhorse-1.1-i2v" lib/media/video-providers.ts && grep -q "happyhorse-1.1-r2v" lib/media/video-providers.ts && echo REGISTRY_OK` expect `REGISTRY_OK`
- G3.2 `grep -q "happyhorse-1.1-r2v" lib/config/token-plan-presets.ts && echo PRESET_OK` expect `PRESET_OK`

S04
- G4.1 (integration) `npx vitest run tests/server/server-providers-example.test.ts` expect `passed`
- G4.2 `grep -q "happyhorse-1.1-r2v" server-providers.yml.example && echo YML_OK` expect `YML_OK`
- G4.3 `grep -l "happyhorse-1.1-r2v" packages/docs/content/docs/supported-models*.mdx | wc -l | tr -d ' ' | grep -qx 6 && echo DOCS6_OK` expect `DOCS6_OK`

S05
- G5.1 (integration) `TEST_LOAD_LOCAL_ENV=1 npx vitest run tests/media/happyhorse-live.test.ts -t "i2v completes"` expect `passed`
- G5.2 `TEST_LOAD_LOCAL_ENV=1 npx vitest run tests/media/happyhorse-live.test.ts -t "r2v media array accepted"` expect `passed`
- G5.3 (adversarial) `TEST_LOAD_LOCAL_ENV=1 npx vitest run tests/media/happyhorse-live.test.ts -t "missing media rejected"` expect `passed`
- G5.4 `npx vitest run tests/media/happyhorse-adapter.test.ts tests/media/media-orchestrator.test.ts tests/server/video-route-preflight.test.ts` expect `passed`

All gates run with cwd pinned to the repo root. The live file skips cleanly without `TEST_LOAD_LOCAL_ENV=1`, so CI stays green.

## Implementation Decisions

- Field names are `firstFrameUrl` and `referenceImageUrls` (operator Q2). The `Url` suffix states the public-URL requirement.
- Source images must be public https URLs the vendor fetches. The app's own candidates: OSS CDN keys (`lib/utils/database.ts:234`), classroom-media serving URLs when publicly reachable, and provider-hosted image URLs (their output URLs are vendor-fetchable by construction).
- Mode detection is provider-agnostic (operator Q3 + review C3): model registry entries declare an optional `sourceRequirement: 'first_frame' | 'reference_images'` (`lib/media/types.ts:214`). The route resolves it through `getVideoModelSourceRequirement`. The shipped helper at `lib/media/video-providers.ts:227-230` returns the aliased form `(providerId: string, modelId: string): VideoModelSourceRequirement | undefined`. The alias is declared at `lib/media/types.ts:307`. No `happyhorse` literal appears in the route file.
- The preflight error reuses the existing `MISSING_REQUIRED_FIELD` shape from `capability-force-off-routes.test.ts` precedent.
- Live URL pinned for S05: `https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg` (vendor docs sample, same CDN family as the proven ASR sample). S05 sequencing makes drift cheap: the paid i2v run executes AFTER the two zero-quota proofs; a URL-fetch failure shows as `Failed to download` and stops the live round before any charge.
- r2v proof design (review C1: no cancel endpoint is proven; the adapter also ignores `options.signal`, so abort does not stop vendor work): submit r2v with one unreachable reference URL. `Field required: input.media` on poll would mean a schema bug. `Failed to download` means the array was accepted, auth worked, and the vendor tried to fetch. Full protocol proof at zero quota. No cancellation is needed or relied upon.
- The t2v regression anchor is the exact-body pin already in `tests/media/happyhorse-adapter.test.ts:40-62`.
- Boundary (review C5, explicit): `packages/@openmaic/generation/src/outline-types.ts:61-67` keeps its copy of `MediaGenerationRequest` untouched (publishable exemption). The agent-runtime video tool (`lib/server/agent-runtime/generate-video.ts:296-302`) keeps its schema without source-image fields. Neither is a defect; both are boundaries.
- Model ids stay literal strings in settings and popover UI (`components/settings/video-settings.tsx:266-267`, `media-popover.tsx:182-185`). Zero new i18n keys (review-verified across 12 locales).
- `lib/media` has no eslint import boundary and the adapters directory is exempt from the neutrality scan. Only the route and `lib/media/types.ts`-adjacent neutral files need vendor-free vocabulary; the field names above are generic.
- tsconfig is strict without `exactOptionalPropertyTypes` (review-verified), so the optional-field pass-through compiles as written.

## Testing Decisions

- Adapter tests extend `tests/media/happyhorse-adapter.test.ts`: exact i2v body, exact r2v body (two references), unchanged t2v body, and the adversarial poll-failure test named `rejects unreachable image on poll`.
- Route matrix test lives in a new `tests/server/video-route-preflight.test.ts`, mirroring the named-import pattern of `tests/server/capability-force-off-routes.test.ts:198`.
- Preset and registry coverage rides the existing `tests/config/apply-token-plan.test.ts` (models assertion) plus grep gates.
- `tests/server/server-providers-example.test.ts` gains the three-model expectation for the managed video path.
- Live file `tests/media/happyhorse-live.test.ts` carries `LIVE_IMAGE_URL` as a top-level const. Oracles are literal, `-t` names are contracts, tier depth honored, postconditions carry after-kind plus exact after-signature, every target carries its symbol expectation at anchor creation (learnings 1, 5, 6, 7, 8 from prior batches).
- G5.4 re-runs the three touched suites instead of the full `pnpm test` (review cost note); S4-style full-suite confidence already exists at batch scope for merges.

## Out of Scope

- Source-image upload UI and outline emission of source images. The batch delivers the API-capable path; those surfaces are separate work, like voice cloning is separate work.
- Base64 or hosted-byte transport. The vendor rejects it.
- Cancellation of live tasks. No cancel endpoint is proven on this product; the S05 design does not rely on one.
- Same-batch sequencing of i2v behind generated images in classroom media runs. Noted in the meta-spec follow-up section below (recorded, not deferred work).
- i2v/r2v for other providers (minimax, seedance).
- Agent-runtime source-image tool parameters.

## Further Notes

- SSRF posture: the vendor fetches the URL, not this server. No new egress surface is added.
- The adapter ignores `options.signal`; a client abort does not stop vendor generation. Recorded for future UX work.
- Probe facts from 2026-09-02 live in the review document and this spec; the S05 run adds the completion proof line to the verification report (review C6).
- Meta-spec batch-004 row advancement is the orchestrator's step at close. The row update happens after this spec is rebound.

### Implementation Learnings

1. Vendor media schema, now shipped:
   - i2v and r2v both require `input.media` entries shaped `{type, url}`.
   - i2v takes exactly one `first_frame` entry. r2v takes one to nine `reference_image` entries.
   - The vendor rejects base64 transport. `parameters.media_base64` does not exist on this product.
   - Submit always answers 200 with a PENDING task. Schema and download errors surface on the first poll as FAILED, about 0.1 s later.
   - The discriminator is the message: `Field required: input.media` versus `Failed to download <url>`.
   - The adapter renders `code: message` at `lib/media/adapters/happyhorse-adapter.ts:87-91`.

2. Capability-driven route design keeps the neutrality scan green:
   - Registry entries declare `sourceRequirement` at `lib/media/types.ts:214`. The route reads it through `getVideoModelSourceRequirement`. No vendor token appears in `app/api/generate/video/route.ts`. The scan stays green.
   - The preflight reuses the `MISSING_REQUIRED_FIELD` shape already proven by `capability-force-off-routes.test.ts`.

3. The prettier double-rejection class:
   - `pnpm format` formats the whole repo. `pnpm exec prettier --write <explicit list>` formats only the named files. The two commands behave differently.
   - Round 1 rejected six files. Round 2 rejected one file, `tests/media/happyhorse-live.test.ts:118-119`, because the partial pass left two poll-loop declarations at the old indent.
   - The fix is a whole-branch sweep. Then confirm `npx prettier --check` on every touched file exits 0. A per-file check after a partial format does not catch the residual indent.

4. Paid-gate double-run:
   - `rivr slice verify --run-gates` re-runs every gate of a slice. The CLI has no evidence-injection path. A diagnostic run plus the recording run spends a paid gate twice.
   - Round 3 spent the paid generation twice. Once as the diagnostic certification run (81.76 s). Once inside the CLI recording.
   - Future live gates must budget two paid generations, or the CLI must gain an evidence-injection path.

5. Live file skip-guard reuse:
   - `tests/media/happyhorse-live.test.ts:12-23` skips the whole describe block when `TEST_LOAD_LOCAL_ENV` or the video key is absent. The pattern comes from `tests/audio/qwen-token-plan-asr-live.test.ts`.
   - CI stays green without live credentials. Prove zero-quota paths first. Spend paid quota last.

6. Env activation truth:
   - Before this batch, `VIDEO_HAPPYHORSE_*` was dead config. The `.env.example:273-274` row held an empty key and the public dashscope host. No test loaded `.env.local`, so the adapter never reached the vendor.
   - Commit `5915f64e` activated the live path. `TEST_LOAD_LOCAL_ENV=1` loads `.env.local`. The same host answered submit, poll, and completion.

### Shipped state

Test totals: `npx vitest run tests/media/` passes 33 files and skips 1 (the live file). 364 tests pass, 3 skip. Provider suites pass: `happyhorse-registry`, `apply-token-plan`, and `server-providers-example`. 3 files, 24 tests. `npx tsc --noEmit` exits 0.

Commits, `main..HEAD` (8):

- `9b269b12` chore(rivr): open batch 004 ledger and branch for happyhorse i2v/r2v
- `c88ae532` chore(rivr): batch 004 postconditions and stage gate
- `88e70f7a` feat(media): happyhorse media input, registry capability, preset models (batch 004 S01+S03)
- `446ee6ae` feat(media): video route preflight and orchestrator pass-through (batch 004 S02)
- `7fe98cb5` feat(media): extend yml example and six docs rows to i2v and r2v (batch 004 S04)
- `5915f64e` test(media): live happyhorse proofs and env activation (batch 004 S05)
- `ea7665bc` style(media): prettier pass, source-requirement alias, yml header (batch 004 fix round)
- `3e862932` style(media): complete prettier pass on batch 004 files (round 2 follow-up)

Files touched: 12 TypeScript files, plus `server-providers.yml.example` and six docs mdx rows. No `packages/@openmaic` file changed. The publishable exemption holds.

Verification record: `docs/research/004-verification-report-r1.md`, `004-verification-report-r2.md`, `004-verification-report-r3.md`.

Status: Shipped. All 5 slices verified. The orchestrator rebinds the spec hash and advances the ledger to closed.
## Certification Report

Certified: 2026-09-02T00:54:41.343Z
Signature: f90474ab7630a709832e6ad8ba2827d71e78e1c678be12e04919d22d003eca8d

### Summary

Slices: 5
Symbols: 10
Gates: 15

### Implemented Symbols

- **S01** (Adapter media input):
  - lib/media/types.ts::VideoGenerationOptions
  - lib/media/adapters/happyhorse-adapter.ts::submitHappyHorseTask
  - lib/media/adapters/happyhorse-adapter.ts::pollHappyHorseTask
  - lib/media/adapters/happyhorse-adapter.ts::generateWithHappyHorse
- **S02** (Route preflight and pass-through):
  - tests/server/video-route-preflight.test.ts::PREFLIGHT_MATRIX
- **S03** (Registry capability, model list, preset):
  - lib/media/video-providers.ts::VIDEO_PROVIDERS
  - lib/media/video-providers.ts::getVideoModelSourceRequirement
  - lib/config/token-plan-presets.ts::TOKEN_PLAN_PRESETS
- **S04** (Yml example and docs rows):
  - tests/server/server-providers-example.test.ts::EXAMPLE_TOKEN_PLAN_IDS
- **S05** (Live protocol proof):
  - tests/media/happyhorse-live.test.ts::LIVE_IMAGE_URL

### Gates Passed

- **S01**:
  - G1.1: {"id":"G1.1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/media/happyhorse-adapter.test.ts \u001b[2m(\u001b[22m\u001b[2m6 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 3\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m6 passed\u001b[39m\u001b[22m\u001b[90m (6)\u001b[39m\n\u001b[2m   Start at \u001b[22m 12:29:56\n\u001b[2m   Duration \u001b[22m 106ms\u001b[2m (transform 31ms, setup 15ms, import 26ms, tests 3ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G1.2: {"id":"G1.2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
  - G1.3: {"id":"G1.3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 check:i18n-keys /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> node scripts/check-i18n-keys.mjs\n\ni18n key alignment check passed (12 locale files, source: en-US.json).\n","passed":true}
  - G1.4: {"id":"G1.4","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/media/happyhorse-adapter.test.ts \u001b[2m(\u001b[22m\u001b[2m6 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m5 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[32m 2\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m5 skipped\u001b[39m\u001b[90m (6)\u001b[39m\n\u001b[2m   Start at \u001b[22m 12:30:02\n\u001b[2m   Duration \u001b[22m 99ms\u001b[2m (transform 26ms, setup 12ms, import 24ms, tests 2ms, environment 0ms)\u001b[22m\n\n","passed":true}
- **S02**:
  - G2.1: {"id":"G2.1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/server/video-route-preflight.test.ts \u001b[2m(\u001b[22m\u001b[2m7 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 99\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m7 passed\u001b[39m\u001b[22m\u001b[90m (7)\u001b[39m\n\u001b[2m   Start at \u001b[22m 12:30:06\n\u001b[2m   Duration \u001b[22m 203ms\u001b[2m (transform 88ms, setup 10ms, import 37ms, tests 99ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G2.2: {"id":"G2.2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/media/media-orchestrator.test.ts \u001b[2m(\u001b[22m\u001b[2m12 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 19\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m12 passed\u001b[39m\u001b[22m\u001b[90m (12)\u001b[39m\n\u001b[2m   Start at \u001b[22m 12:30:06\n\u001b[2m   Duration \u001b[22m 133ms\u001b[2m (transform 37ms, setup 10ms, import 43ms, tests 19ms, environment 0ms)\u001b[22m\n\n\u001b[90mstderr\u001b[2m | tests/media/media-orchestrator.test.ts\u001b[2m > \u001b[22m\u001b[2mclassic media orchestrator\u001b[2m > \u001b[22m\u001b[2mpersists structured terminal errors under the placeholder for reload\n\u001b[22m\u001b[39m[2026-09-02T00:30:06.968Z] [ERROR] [MediaOrchestrator] Failed gen_img_classic: Sensitive content\n\n\u001b[90mstderr\u001b[2m | tests/media/media-orchestrator.test.ts\u001b[2m > \u001b[22m\u001b[2mclassic media orchestrator\u001b[2m > \u001b[22m","passed":true}
- **S03**:
  - G3.1: {"id":"G3.1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"REGISTRY_OK\n","passed":true}
  - G3.2: {"id":"G3.2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"PRESET_OK\n","passed":true}
- **S04**:
  - G4.1: {"id":"G4.1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n\u001b[90mstdout\u001b[2m | tests/server/server-providers-example.test.ts\u001b[2m > \u001b[22m\u001b[2mserver-providers.yml.example\u001b[2m > \u001b[22m\u001b[2mresolves all five token-plan ids through isServerConfiguredProvider\n\u001b[22m\u001b[39m[2026-09-02T00:16:55.083Z] [INFO] [ServerProviderConfig] [ServerProviderConfig] Loaded (server-providers.yml): 2 LLM, 2 TTS, 2 ASR, 0 PDF, 1 Image, 1 Video, 1 WebSearch providers\n\n\u001b[90mstdout\u001b[2m | tests/server/server-providers-example.test.ts\u001b[2m > \u001b[22m\u001b[2mserver-providers.yml.example\u001b[2m > \u001b[22m\u001b[2mspot-checks one base_url per token-plan section\n\u001b[22m\u001b[39m[2026-09-02T00:16:55.086Z] [INFO] [ServerProviderConfig] [ServerProviderConfig] Loaded (server-providers.yml): 2 LLM, 2 TTS, 2 ASR, 0 PDF, 1 Image, 1 Video, 1 WebSearch providers\n\n\u001b[90mstdout\u001b[2m | tests/server/server-provid","passed":true}
  - G4.2: {"id":"G4.2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"YML_OK\n","passed":true}
  - G4.3: {"id":"G4.3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"DOCS6_OK\n","passed":true}
- **S05**:
  - G5.1: {"id":"G5.1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/media/happyhorse-live.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m2 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[33m 81096\u001b[2mms\u001b[22m\u001b[39m\n     \u001b[33m\u001b[2m✓\u001b[22m\u001b[39m i2v completes \u001b[33m 81095\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m2 skipped\u001b[39m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 12:42:59\n\u001b[2m   Duration \u001b[22m 81.20s\u001b[2m (transform 24ms, setup 15ms, import 20ms, tests 81.10s, environment 0ms)\u001b[22m\n\n","passed":true}
  - G5.2: {"id":"G5.2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/media/happyhorse-live.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m2 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[33m 1164\u001b[2mms\u001b[22m\u001b[39m\n     \u001b[33m\u001b[2m✓\u001b[22m\u001b[39m r2v media array accepted \u001b[33m 1163\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m2 skipped\u001b[39m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 12:44:21\n\u001b[2m   Duration \u001b[22m 1.26s\u001b[2m (transform 24ms, setup 11ms, import 21ms, tests 1.16s, environment 0ms)\u001b[22m\n\n","passed":true}
  - G5.3: {"id":"G5.3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/media/happyhorse-live.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m2 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[33m 1468\u001b[2mms\u001b[22m\u001b[39m\n     \u001b[33m\u001b[2m✓\u001b[22m\u001b[39m missing media rejected \u001b[33m 1467\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m2 skipped\u001b[39m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 12:44:22\n\u001b[2m   Duration \u001b[22m 1.56s\u001b[2m (transform 27ms, setup 15ms, import 21ms, tests 1.47s, environment 0ms)\u001b[22m\n\n","passed":true}
  - G5.4: {"id":"G5.4","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/media/happyhorse-adapter.test.ts \u001b[2m(\u001b[22m\u001b[2m6 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 3\u001b[2mms\u001b[22m\u001b[39m\n \u001b[32m✓\u001b[39m tests/media/media-orchestrator.test.ts \u001b[2m(\u001b[22m\u001b[2m12 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 20\u001b[2mms\u001b[22m\u001b[39m\n \u001b[32m✓\u001b[39m tests/server/video-route-preflight.test.ts \u001b[2m(\u001b[22m\u001b[2m7 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 97\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m25 passed\u001b[39m\u001b[22m\u001b[90m (25)\u001b[39m\n\u001b[2m   Start at \u001b[22m 12:44:24\n\u001b[2m   Duration \u001b[22m 233ms\u001b[2m (transform 199ms, setup 42ms, import 157ms, tests 121ms, environment 0ms)\u001b[22m\n\n\u001b[90mstderr\u001b[2m | tests/media/media-orchestrator.test.ts\u001b[2m > \u001b[22m\u001b[2mclassic media orchestrator\u001b[2m > \u001b[22m\u001b[2mpersists structured terminal errors under the placehold","passed":true}

Certification hash: f90474ab7630a709832e6ad8ba2827d71e78e1c678be12e04919d22d003eca8d
Certified: 2026-09-02T00:54:41.343Z | Signature: f90474ab7630a709832e6ad8ba2827d71e78e1c678be12e04919d22d003eca8d | Certifier: verifier
