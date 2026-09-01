# Batch 004 spec: happyhorse i2v and r2v media input

Spec status: implementation

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

| Slice | Title | Delivers | Risk tier | Proposed gates |
| --- | --- | --- | --- | --- |
| S01 | Adapter media input | `VideoGenerationOptions` gains `firstFrameUrl?` and `referenceImageUrls?` (`lib/media/types.ts:260`). `submitHappyHorseTask` builds `input.media` from them; the t2v body stays byte-identical with neither set. New unit tests including the adversarial `rejects unreachable image on poll`. | 4 | 4 gates, one adversarial |
| S02 | Route preflight and orchestrator pass-through | Named `POST` export (`app/api/generate/video/route.ts:39`) returns 400 `MISSING_REQUIRED_FIELD` via the registry capability check after `resolveVideoModel` (`:87-94`), before `generateVideo` (`:105`). No vendor token appears in the route (it is neutrality-scanned). `callVideoApi` (`lib/media/media-orchestrator.ts:311`) forwards both fields. | 2 | 2 gates |
| S03 | Model list, capability metadata, preset extension | `VIDEO_PROVIDERS.happyhorse.models` carries all three 1.1 ids with per-model source-requirement metadata. New exported helper `getVideoModelSourceRequirement` in `lib/media/video-providers.ts` (registry file is the composition root, not neutral-scanned). Preset video `defaultModels` becomes the three 1.1 ids. | 2 | 2 gates |
| S04 | Yml example and docs rows | `server-providers.yml.example` video models gain i2v and r2v (managed deployments need them, `resolveVideoModel` allowlist). All six `packages/docs/content/docs/supported-models*.mdx` files list the new models. `.env.example` stays untouched (no `VIDEO_*_MODELS` rows exist by design; the yml is the model-list home). | 3 | 3 gates, one integration |
| S05 | Live protocol proof | Submit-acceptance and completion proof: i2v once to SUCCEEDED (the single paid generation, operator-approved), r2v proven with a controlled unreachable-reference flow that confirms array acceptance at zero quota, plus the missing-media adversarial proof. Contract symbol `generateWithHappyHorse` (`happyhorse-adapter.ts:172`) and the new `tests/media/happyhorse-live.test.ts::LIVE_IMAGE_URL`. | 4 | 4 gates, one adversarial |

### Proposed gate commands

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
- Mode detection is provider-agnostic (operator Q3 + review C3): model registry entries declare an optional `sourceRequirement: 'first_frame' | 'reference_images'`. The route resolves it through `getVideoModelSourceRequirement(providerId, modelId)`. The signature is contract-pinned: `(providerId: string, modelId: string): VideoModelSourceRequirement | undefined`. No `happyhorse` literal appears in the route file.
- The preflight error reuses the existing `MISSING_REQUIRED_FIELD` shape from `capability-force-off-routes.test.ts` precedent.
- Live URL pinned for S05: `https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg` (vendor docs sample, same CDN family as the proven ASR sample). S05 sequencing makes drift cheap: the paid i2v run executes AFTER the two zero-quota proofs; a URL-fetch failure shows as `Failed to download` and stops the live round before any charge.
- r2v proof design (review C1: no cancel endpoint is proven; the adapter also ignores `options.signal`, so abort does not stop vendor work): submit r2v with one unreachable reference URL. `Field required: input.media` on poll would mean a schema bug. `Failed to download` means the array was accepted, auth worked, and the vendor tried to fetch — full protocol proof at zero quota. No cancellation is needed or relied upon.
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
- Meta-spec batch-004 row stays `queued` until the human approves this spec.

Status: Draft
