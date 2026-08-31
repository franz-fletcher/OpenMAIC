# Spec soundness review — meta-spec + batch 001 (2026-08-31)

Reviewer: fresh researcher, no authorship stake. Method R1-R6 against the live repo. Every finding cited from source.

## Verdict

Blockers found. Three blocker-level gaps return the specs to the author before the human gate. All 30+ file:line citations resolve. No phantom files or symbols exist. The docs are prose-clean. The blockers are contract gaps, not citation errors.

## Blockers

**B1. The provider has no dispatch path in `generateTTS`.**
`generateTTS` (lib/audio/tts-providers.ts:207-269) dispatches through an explicit switch (lines 220-256). Every built-in id has a case. The `default` branch throws `Unsupported TTS provider: ${config.providerId}` (line 255). The spec never mentions adding a case for `qwen-token-plan-tts`. The route calls `generateTTS` (app/api/generate/tts/route.ts:144) and the classroom pipeline calls it too (lib/server/agent-runtime/scene-tts.ts:2). Without a dispatch case, every synthesis throws `Unsupported TTS provider`, so S5 cannot pass and the S3 route serving claim fails. Fix: add to Implementation Decisions, Provider identity: "Add `case 'qwen-token-plan-tts'` to the `generateTTS` switch (lib/audio/tts-providers.ts:220-256) that calls the new WebSocket client."

**B2. `splitLongSpeechActions` is a no-op for the new provider id.**
`TTS_MAX_TEXT_LENGTH` (lib/audio/tts-utils.ts:12-14) contains only `'glm-tts': 1024`. `splitLongSpeechActions` (lib/audio/tts-utils.ts:82-84) returns the actions unchanged when the provider id has no entry. The spec claims the splitter acts upstream. Both claims are false for the new id today. A text between 200 and 20,000 characters goes to the socket unsplit in one `continue-task`. Fix, one of two: add `TTS_MAX_TEXT_LENGTH['qwen-token-plan-tts']` with a vendor-confirmed limit, or drop the splitter claim and state that the 20,000-character guard is the only bound.

**B3. "Mirrors QwenTTSError" will not satisfy the route branch.**
The route branch is an `instanceof` check: `if (error instanceof QwenTTSError)` (app/api/generate/tts/route.ts:173-175). A new class that only mirrors the shape fails `instanceof` and falls through to `GENERATION_FAILED` 500. That breaks user story 7 and the S3 error mapping promise. Fix: the new error class must `extend QwenTTSError` (or throw `QwenTTSError` directly). The route then stays untouched.

## Concerns

**C1. `provider-display.ts` is missing from the i18n decision.**
The settings page renders TTS provider names through `resolveTTSProviderName` (components/settings/index.tsx:146) which reads `TTS_PROVIDER_NAME_KEYS` (lib/audio/provider-display.ts:25-36). Without a map entry the 12 new display keys are dead and the UI shows the raw id. Fix: add the map entry to the i18n decision.

**C2. The live smoke test is the first consumer of `TEST_LOAD_LOCAL_ENV`.**
No test uses it today; only the loader exists (tests/setup-env.ts:23-41). The spec must state the skip condition: skip when `TEST_LOAD_LOCAL_ENV` is not `1` or the plan key is absent. Otherwise CI would run it keyless and fail `pnpm test`.

**C3. The generated data file must pass prettier and tsc.**
`pnpm check` runs prettier over the repo and `lib/` is not ignored. The file is inside the tsconfig include set. The generator must emit prettier-clean, type-valid output (typed as `TTSVoiceInfo[]`).

**C4. Bundle and picker cost of 1,194 records is unmeasured.**
The registry is imported by client components. ~100-200 KB raw enters the client bundle, and one expanded model group renders 597 rows (no virtualization). State the intended import site, measure the bundle delta in the slice, and add a row cap.

**C5. The Node version floor conflicts with `engines`.**
Global `WebSocket` is stable from Node 22.4; package.json declares `engines.node >=20.9.0`. `undici@^7.22.0` is already a direct dependency and `WebSocketInit.headers` typechecks there. Fix: state "requires Node >= 22.4" or import from the undici package.

## Minor (citation drift and shape notes)

| # | Doc | Claim | Verdict | Real location |
| --- | --- | --- | --- | --- |
| M1 | batch 001 | provider-config.test.ts:8-55 | drift | lines 8-60 |
| M2 | batch 001 | voice-resolver :130 filter | drift | :317 is the filter; :130 is stale-model fallback |
| M3 | meta-spec | `video-t2v` union value | terminology | union value is `video` (token-plan-presets.ts:20) |
| M4 | meta-spec | "Zero new i18n keys" | ambiguous scope | batch 003 adds none; batch 001 adds 180 |
| M5 | meta-spec | pool knob naming not recorded | incomplete | record operator decision in Naming section |
| M6 | meta-spec | batch 003 touch points | underlisted | also MODALITY_LABEL_KEYS (token-plan-settings.tsx:40), MODALITY_ICONS (:48), TokenPlanActions (apply-token-plan.ts:21-61) |
| M7 | batch 001 | registry entry shape | underspecified | must set `requiresApiKey: true` (route.ts:112-119, provider-enablement.ts:78) |
| M8 | batch 001 | flash 12 voice ids, 597 counts | vendor-sourced, unverified | add one flash-id validation to S4 or accept explicitly |
| M9 | batch 001 | 30 s timeout vs `maxDuration = 30` (route.ts:32) | boundary race | platform-enforced maxDuration can cut before the typed timeout; local dev unaffected |

## Contradiction pass (R5)

S1 gate tag consistent; 597 + 597 = 1,194 consistent; pool-name and i18n-scope items per M4/M5; B1/B2 are internal contradictions between Solution overclaim and Implementation Decisions silence.

## Gate dry-run (R2)

`pnpm check`, `pnpm check:i18n-keys` (15 keys x 12 locales = 180, parity only, values legal), `npx tsc --noEmit` (compiler forces the two Record entries), `pnpm test` + `vi.stubGlobal`, neutrality guard mechanics (PROVIDER_NEUTRAL_FILES includes provider-config.ts and the tts route; qwen count rises), TEST_LOAD_LOCAL_ENV loader path: all real and behaving as claimed, with C2/C3 corrections.

## Assumption probes (R4)

The route runs on the Node runtime (no `runtime` export; uses `Buffer`), so the global `WebSocket` exists. `instrumentation.ts` register() is Node-gated and has room for one more drain. `generateTTS` switch is the only dispatch miss (B1); other provider-id sites are registry-driven. `resolveTTSProviderName` falls back to the raw id (C1, no crash). Route preflight reads `requiresApiKey` (M7).

## Prose fixes (R6)

1. Title em dash: "Batch 001 spec — ..." → "Batch 001 spec: ...".
2. "Classroom texts stay at about 200 characters or less." → "Classroom texts are usually 200 characters or fewer."
3. "Max two connections by default." → "The default pool size is two connections."
4. Meta-spec comma splice: "System voices for plus: longanlingxin, longanlufeng. The vendor doc example longxiaochun is an error, engine 411." → "System voices for plus are longanlingxin and longanlufeng. The vendor doc example longxiaochun is an error. It returns engine 411."
5. No fifth violation. Both docs otherwise STE-clean: no semicolons, no banned modals, no em dashes in body prose.

## Status

Fix B1-B3, fold in C1-C5, apply the line drifts, then the batch is ready for the human gate.
