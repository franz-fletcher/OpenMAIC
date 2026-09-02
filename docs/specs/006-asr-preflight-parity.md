# Batch 006 spec: ASR transcription route missing-key preflight parity

Spec status: research

## Problem Statement

The transcription route has no missing-key contract. `app/api/transcription/route.ts` accepts a request without a configured ASR key. The check lives only in the library (`lib/audio/asr-providers.ts:171-173`), so the throw reaches the route catch and becomes a 500 `TRANSCRIPTION_FAILED`. The TTS route already rejects this case as a client error: 400 `MISSING_API_KEY` before any call (`app/api/generate/tts/route.ts:112-119`). Image and video routes preflight too (they use 401). The transcription route is the one capability route that leaks the missing-key case as a 500.

## Solution

Add a key preflight at route entry in `app/api/transcription/route.ts`, after the provider resolution and force-disabled check, before the SSRF check and `transcribeAudio`. It returns 400 `MISSING_API_KEY` for a keyed provider with no key, mirroring the TTS contract exactly. Message: `No API key configured for ASR provider: <providerId>`. Provider id only; the message never embeds a key.

## User Stories

1. As an API client, a missing ASR key returns 400 `MISSING_API_KEY`, so I correct the request instead of treating it as a server failure.
2. As an operator, every built-in ASR provider preflights the same way, so the transcription route matches the TTS parity contract.
3. As a maintainer, the preflight stays provider-neutral, so the route remains a `PROVIDER_NEUTRAL_FILE`.

## Slices

**S01 preflight helper and route wiring (tier 2).** Inline `assertASRKeyConfigured` in the route file (TTS precedent, minimal diff, no growth of the guarded provider-config surface). It consults the `ASR_PROVIDERS` registry `requiresApiKey` flag and `resolveASRApiKey` (`provider-config.ts:785-787`). Keyed providers with no key return 400. Keyless providers (`browser-native`, `funasr-asr`, `lemonade-asr`) and custom providers skip, matching the library throw condition. No existing test pins the current 500 missing-key path, so no test contract breaks.

**S02 per-provider missing-key matrix (tier 3, integration).** New `tests/server/transcription-route-missing-key.test.ts` mirroring `tests/server/tts-route-missing-key.test.ts`, including its env-clear helper pattern over all six `ASR_ENV_MAP` prefixes plus `ASR_BROWSER_NATIVE`. Matrix: four keyed built-ins return 400 and never reach `transcribeAudio`; three keyless built-ins still dispatch; managed server key passes without a client key; unmanaged client key passes; disabled provider still 403; no-enabled-backend still 400 `MISSING_PROVIDER`; downstream failure still 500.

### Proposed gates

S01 (2): helper unit truth-table (`passed`); route 400 + no-dispatch assertion (`passed`).
S02 (3, one integration): full matrix (`passed`, type integration); managed/client-key pass cases (`passed`); unchanged error contracts (`passed`).

## Implementation Decisions

- Code and status: 400 `MISSING_API_KEY` (TTS parity; `MISSING_REQUIRED_FIELD` stays for actual missing body fields at `route.ts:35`).
- Helper inlined in the route; promoted to provider-config only if a third route needs it.
- No i18n key: dev-facing API text, matching the TTS route's inline string, avoiding a 12-locale parity edit.
- Custom `custom-asr-*` providers keep the existing 500 path. The library's own guard skips them (`provider?.requiresApiKey` is undefined there), so guarding them would exceed parity scope. Recorded as an intentional non-change.
- The library throw stays. Route preflight is the HTTP-boundary contract; the library throw is the direct-caller invariant. Two layers is correct.
- Neutrality: the route file is scanned (`provider-neutrality-guard.test.ts:70`). The helper uses only registry names and resolver calls, no vendor literals, so no debt-table change. Confirmed at review.

## Testing Decisions

- Mirror `tts-route-missing-key.test.ts` structure: mock `@/lib/audio/asr-providers`, assert non-dispatch (`:98` precedent).
- Clear all ASR env prefixes so a host machine cannot leak config into the matrix.
- Zero paid gates. Hermetic only. Ledger discipline identical to batch 005 lessons (symbol expectations at anchor creation, beforeSignature for the named `POST` if targeted, literal oracles, cwd repo root, prettier explicit-list sweep before marking).

## Out of Scope

- No change to `asr-providers.ts` throws or the 500 path for genuine downstream failures.
- No redaction work. Sweep confirmed no key material in transcription-route messages (provider id only). Any leak found later is batch 005-class input, noted not fixed here.
- No force-disabled or SSRF contract changes.
- No image/video 401-versus-400 normalization program-wide (recorded open question, operator-owned).

## Further Notes

- Cross-batch: batches 001-003 shipped `qwen-token-plan-asr`; this batch makes its missing-key behavior identical to every other ASR provider at the HTTP boundary.
- No publishable file touched, so no version bump.
- Program boundary (operator Q4): capability routes now split 400 (tts, transcription after this batch) versus 401 (image, video) for the same missing-key case. Normalizing the split is a separate future decision, recorded in the meta-spec, not work deferred by this batch.
- Custom `custom-asr-*` providers keep the existing 500 path by design (operator Q5a); the route guard mirrors the library condition exactly.

Status: Draft
