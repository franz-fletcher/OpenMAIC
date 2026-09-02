# Batch 007 spec: agent-session-friction

Spec status: closed

## Problem Statement

Production agent session 96cdbbfa (2026-09-02) failed three ways. The user cancelled the session after these failures.

1. `generate_scene` rejected a JSON-encoded `widgetOutline` string five consecutive times. Every rejection said "generate_scene needs widgetOutline to be an object matching widgetType." The tool call arguments at transcript seq 208/210/212/218/220 prove the model passed a JSON-encoded STRING that contained a valid object, for example `"{\"concept\": \"Resolving a 2D force into rectangular components\", \"keyVariables\": [...]}"`.
2. `set_roster` failed the whole 3-agent roster atomically when one voice was not in the catalog. The model hallucinated `qwen-token-plan-tts::loongjameszhao` and `qwen-token-plan-tts::loongolivialin`. The real catalog for this deployment is `longanlingxin`, `longanlufeng`, plus 597 base voices shaped `qwen-audio-3.0-tts-plus-<name>`. Each rejection dumped all ~599 bindings into the transcript. After two failed attempts the agent gave up and set the roster with no voices bound at all (seq 197).
3. `generate_scene` surfaced "Cannot connect to API: Headers Timeout Error" twice (seq 205, 223) with no visible recovery. The string comes from `@ai-sdk/provider-utils` `handle-fetch-error`, which wraps the undici `HeadersTimeoutError` in a retryable `APICallError` whose name is `AI_APICallError`.

All agent model calls ran through the pi agent runtime stub model `maic-connector` (`lib/agent/runtime/build-agent.ts:28-39`). The real backend was qwen3.8-flash on the token-plan endpoint.

## Solution

Three independent app-side fixes. No `packages/@openmaic` changes, so no version bumps.

1. Coerce a stringified `widgetOutline` before the existing object guard in `generate_scene`. Accept only plain non-null non-array objects after parse. Reject everything else with a message that tells the model to pass a plain JSON object, not a stringified one.
2. Make `set_roster` resilient to out-of-catalog voices. Bind the affected agent unbound, persist the rest of the roster, and return success with structured warnings. Cap any binding list in warning payloads to a count plus the first 10 entries, and point at `list_voices`.
3. Add a bounded retry-with-backoff for connection-class `APICallError` failures inside the `callLLM` wrapper. Add operator-facing env knobs to `.env.example` in the same PR. Keep usage accounting, the `LLM_THINKING_DISABLED` switch, and `streamLLM` unchanged.

Provider neutrality holds. This batch adds no new provider ids, so `tests/providers/provider-neutrality-guard.test.ts` debt counts stay untouched. `lib/ai/llm.ts` stays the single LLM entry, so `tests/lint-llm-entry-guard.test.ts` stays green.

## User Stories

1. As an agent model, when I pass a JSON-encoded `widgetOutline` string, the tool accepts it, so scene generation proceeds instead of failing five times.
2. As an agent model, when I pass a non-object `widgetOutline`, the tool tells me to pass a plain JSON object, so I correct the argument in one step.
3. As an agent model, when one roster voice is out of catalog, the roster still persists with the other agents bound, so the session continues instead of dead-ending.
4. As an agent model, when a voice is dropped, the tool names the dropped voice and points me at the valid pairs, so I can fix the next call.
5. As an agent model, when the provider connection fails, the tool retries internally, so a transient network error does not surface as a tool failure.
6. As an operator, I tune connection retry count and backoff base through env vars, so the retry policy stays deployment-tunable without code changes.

## Slices

### S01 Coerce stringified widgetOutline in generate_scene (tier 2)

**Target symbol.** `lib/server/agent-runtime/generation-tools.ts` :: `buildGenerationTools` (kind function, the exported tool-set constructor at line 221).

**Before-state capture facts.**

- Schema hole at `generation-tools.ts:60-65`: `widgetOutline: Type.Optional(Type.Unknown({ ... }))`. `Type.Unknown` accepts any JSON value, so a string passes tool-call validation. No sibling param has this hole. `media` (lines 69-79) is `Type.Array(Type.Object(...))` and `materialFacts` is `Type.Array(Type.String())`, so a stringified value for either is rejected by the schema before `execute` runs. Only `widgetOutline` can arrive stringified.
- Guard at `generation-tools.ts:287-298`, current rejection text: `'generate_scene needs widgetOutline to be an object matching widgetType.'` with `details: { error: 'invalid-widget-outline' }`.
- SceneOutline build at `generation-tools.ts:307-335` casts the value at line 319: `widgetOutline: (params.widgetOutline as SceneOutline['widgetOutline'] | undefined) ?? { concept: title }`. A non-object that passed an unguarded path would corrupt the outline.
- Pinned test at `tests/agent-runtime/generation-tools.test.ts:274-301` already asserts the rejection path for `null` and for the string `'mindmap'`, both as `{ isError: true, details: { error: 'invalid-widget-outline' } }`. The error code is a test contract.

**Postcondition (per target symbol).**

- after-exists: true. after-kind: variable. Signature unchanged (`AgentTool<typeof SceneParams>`).
- `generate_scene.execute` parses a string `widgetOutline` with `JSON.parse` before the object guard. A parse that yields a plain non-null non-array object replaces the param and proceeds. Any other outcome (non-string, parse failure, null, array, primitive) keeps the rejection path.
- Rejection keeps error code `invalid-widget-outline` so the pinned `null` and `'mindmap'` assertions stay green. The rejection message changes to explicitly say to pass a plain JSON object, not a stringified one.
- No other param is coerced.

**Per-target success expectations.**

- A JSON-encoded object string lands in `SceneOutline.widgetOutline` as the parsed object, and the interactive page persists with that outline.
- The existing passing-through test (`widgetOutline: { concept: 'Water cycle', diagramType: 'mindmap' }`) stays green.
- The existing `null` and `'mindmap'` rejection tests stay green on the error code, and assert the new message text.

**Evidence strings.**

- Transcript rejection text: `generate_scene needs widgetOutline to be an object matching widgetType.`
- Transcript argument shape: `"{\"concept\": \"Resolving a 2D force into rectangular components\", \"keyVariables\": [...]}"`.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/generation-tools.test.ts -t "coerces a JSON-encoded widgetOutline string"` expect `passed`. The shorter filter `-t "widgetOutline"` matched two tests that already pass today, so it is too weak as a RED-first gate.
- G02 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S02 Resilient set_roster voice binding (tier 3)

**Target symbol.** `lib/server/agent-runtime/roster-tools.ts` :: `buildRosterTools` (kind function, the exported tool-set constructor at line 203).

**Before-state capture facts.**

- Catalog construction at `roster-tools.ts:299-300`: `const catalog = agentVoiceCatalog(deps.registeredVoices); const catalogBindings = new Set(catalog.map((voice) => voice.binding));`. `agentVoiceCatalog` (lines 97-119) covers served keyed providers plus session-registered clones.
- Validation flow at `roster-tools.ts:301-323`: `.find` returns the FIRST unusable binding, then the whole call returns an `isError` rejection with `details.error: 'voice-not-in-catalog'` and `availableBindings: [...catalogBindings]` (line 319). The spread dumps every bindable pair, which is the ~599-entry context bloat in the transcript. No other field is rejected: avatar, color, priority, and voiceDesign are normalized (lines 326-338), not rejected. The remaining rejection paths are at-least-2-agents (246), exactly-1-teacher (258), and no-document (276).
- Success result shape at `roster-tools.ts:363-371`: `{ content: [{ type: 'text', text: 'Classroom roster set: N agents, teacher "X". summary.' }], details: { roster } }` and no `isError`. The summary lists each bound agent as `Name [role] (providerId::voiceId)`.
- Pinned tests at `tests/agent-runtime/roster-tools.test.ts:200-220`, `301-320`, and `327-347` all assert `isError: true`, `details.error: 'voice-not-in-catalog'`, and that nothing was persisted.

**Postcondition (per target symbol).**

- after-exists: true. after-kind: variable. Signature unchanged.
- `setRoster.execute` collects every out-of-catalog binding, not just the first. For each affected agent, the `voice` binding is dropped and the agent is persisted unbound. The roster persists with the surviving bindings. The tool returns success (`isError` absent).
- The content text names each dropped agent and voice, gives valid-pair guidance, and points at `list_voices`.
- `details.warnings` carries structured data: the dropped voices with their agent names, the count of available bindings, a sample capped at the first 10, and a hint to call `list_voices`.
- Voices that do not parse as `providerId::voiceId` keep the current behavior: they stay unbound silently, exactly as `parseVoiceConfig` (lines 72-79) treats them today.

**Per-target success expectations.**

- A roster with one bad voice persists with that agent unbound and the other agents bound.
- A roster with several bad voices drops each bad binding and warns each.
- The warning sample never exceeds 10 entries and reports the total count.
- The three pinned tests are re-pinned to the success-with-warnings contract. Their intent changes from "half-applied roster is worse than none" to "partial binding beats a dead session", and the keyless-provider case (lines 327-347) now proves the roster never carries a lying binding because the agent is unbound.

**Evidence strings.**

- Transcript error code: `voice-not-in-catalog`.
- Transcript hallucinated pairs: `qwen-token-plan-tts::loongjameszhao`, `qwen-token-plan-tts::loongolivialin`.
- Deployment catalog members referenced in tests: `longanlingxin`, `longanlufeng`, `qwen-audio-3.0-tts-plus-<name>`.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/agent-runtime/roster-tools.test.ts -t "warnings"` expect `passed`. All three re-pinned test names must carry the literal `warnings`, and the verify run must match at least 3 tests (`Tests 3 passed` or more).
- G02 (integration): `npx vitest run tests/agent-runtime/roster-tools.test.ts` expect `passed`.
- G03 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.

### S03 Bounded connection-error retry in callLLM (tier 3)

**Target symbol.** `lib/ai/llm.ts` :: `callLLM` (kind function, declared at line 325).

**Before-state capture facts.**

- The scene generator call path: `generate_scene.execute` reaches `generateSceneContent` at `generation-tools.ts:383` and `generateSceneActions` at line 411, both through `aiCallFor(stage)` (lines 222-223). The factory `createGenerationAiCallFactory` at `lib/server/agent-runtime/generation-ai-call.ts:22-38` calls `callLLM` with `maxRetries: 0` (line 30). `lib/server/classroom-generation.ts:323` and `:373` do the same.
- `callLLM` (`llm.ts:325-386`) wraps `generateText` in `thinkingContext.run` (lines 348-350). Its own retry loop (`maxAttempts = (retryOptions?.retries ?? 0) + 1`, line 332) retries only when `retryOptions` is passed. The scene factory passes no third argument, so `maxAttempts = 1` and any throw propagates immediately.
- The AI SDK 6 default (`ai@6.0.168`, `node_modules/.pnpm/ai@6.0.168_zod@4.3.6/node_modules/ai/dist/index.js:2681,2716`) is `maxRetries = 2` with exponential backoff on any `APICallError` where `isRetryable === true`. The resolved stack (`@ai-sdk/provider@3.0.8`, `@ai-sdk/provider-utils@4.0.23`) has no `APIConnectionError` class. Its `handleFetchError` constructs an `APICallError` with name `AI_APICallError`, `isRetryable: true`, the message `Cannot connect to API: ${cause.message}`, and no numeric `statusCode` (`dist/index.js:607-622`). So the SDK would retry this error, but the call site's `maxRetries: 0` disables it, and the wrapper's own loop does not run.
- On exhaustion `callLLM` rethrows the original error (`throw lastError`, line 385) with no guidance. The error reaches the agent as the tool result text, which is why the transcript shows the raw SDK message.
- The comment at `llm.ts:264-267` says wrapper retries are for validation failure only and the AI SDK handles network errors. That separation is exactly what broke: the scene call site zeroed the SDK layer.
- Tool-level watchdog is separate and healthy. `lib/agent/runtime/tool-timeout.ts` races every tool call, with `generate_scene` budgeted at 15 minutes (line 41). It did not fire, and it is not the right layer for connection retry.

**Postcondition (per target symbol).**

- after-exists: true. after-kind: function. after-signature: `(params: T, source: string, retryOptions?: LLMRetryOptions, thinking?: ThinkingConfig): Promise<GenerateTextResult<any, any>>` (unchanged, name and async stripped).
- `callLLM` retries `generateText` when the thrown error is a connection-class failure. Detection is duck-typed on the error object, with no new imports: `name === 'AI_APICallError'`, `isRetryable === true`, and no numeric `statusCode`. Errors that carry a numeric `statusCode` (429 or 5xx responses) stay out of the wrapper budget because the SDK layer already retries them for callers that did not zero it.
- Retry count and base delay come from env knobs, defaulting to 2 retries and 1000 ms base. Backoff is exponential from the base. The retry budget is separate from `retryOptions`, which keeps governing validation retries.
- Abort signals still cancel. The caller's `abortSignal` stays respected across retries.
- Usage recording keeps the current behavior: each resolved attempt records the usage carried on its own result. The new loop adds attempts and changes no accounting. The connection retry wraps the existing `retryOptions` loop, and the two budgets stay independent. Thinking resolution and `LLM_THINKING_DISABLED` stay untouched. `streamLLM` stays untouched.
- On exhaustion `callLLM` throws an error with the name preserved as `AI_APICallError`, `cause` set to the original, and a message that tells the agent to retry the call. Preserving name and cause keeps downstream status extraction working (`packages/@openmaic/generation/src/scene-generator.ts:957-971` reads `statusCode` through `cause` chains; a renamed error would not).

**Per-target success expectations.**

- A transient connection-class `AI_APICallError` followed by success resolves with the successful text.
- A persistent connection-class `AI_APICallError` surfaces a message containing `Retry the call` after the bounded budget, and only after the configured attempt count.
- A non-connection error is not retried, including an `APICallError` that carries a numeric `statusCode`.
- The retry-exhausted error preserves the original message text and the original error as `cause`.
- Environment knobs of 0 retries disable the new retry path.

**Evidence strings.**

- Transcript error: `Cannot connect to API: Headers Timeout Error`.
- Call-site opt-out: `maxRetries: 0` at `generation-ai-call.ts:30`.

**Proposed gates (cwd: repo root for every gate).**

- G01 (unit): `npx vitest run tests/ai/llm-connection-retry.test.ts` expect `passed`.
- G02 (unit): `npx vitest run tests/ai/llm-thinking-options.test.ts` expect `passed`.
- G03 (smoke): `npx tsc --noEmit && echo TSC_OK` expect `TSC_OK`.
- G04 (integration): `npx vitest run tests/lint-llm-entry-guard.test.ts` expect `passed`.

## Implementation Decisions

- S01 placement: the coercion runs inline before the guard at `generation-tools.ts:287`. A module-scope unexported helper is allowed but stays unexported and untested directly, matching the tool-file convention. The error code stays `invalid-widget-outline` because the pinned tests assert it. The rejection message changes to name the requirement explicitly: pass a plain JSON object, not a stringified one.
- S01 media audit: coerce nothing else. `media` and `materialFacts` are schema-typed arrays, so a stringified value fails tool-call schema validation before `execute`. Only the `Type.Unknown` field has the hole. The reasoning is recorded here so nobody re-audits it.
- S02 result contract: success with `details.warnings`. Content text carries the human-readable guidance because the agent reads content. `details` carries structured data for diagnostics. The catalog sample cap is 10 entries plus a count, plus the `list_voices` pointer. The success shape fields (`content`, `details`) stay; only the voice failure path changes.
- S02 drops the first-match `.find` in favor of collecting all unusable bindings, so one pass warns about every bad voice instead of one at a time.
- S03 retry placement: inside `callLLM` only. Option A (chosen) detects connection-class failures by duck-typed properties (`name === 'AI_APICallError'`, `isRetryable`, absent numeric `statusCode`) without importing from `@ai-sdk/provider`, bounds retries by env knobs, and sleeps between attempts with exponential backoff. It applies to every `callLLM` caller, including the two `classroom-generation.ts` sites that also pass `maxRetries: 0`. Option B (stop passing `maxRetries: 0` at the three call sites) was rejected because it spreads policy across call sites, removes operator control, and restores SDK latency at sites that opted out deliberately. Option C (retry inside the `compatFetch` wrapper in `lib/ai/providers.ts`, region 2099-2199) was rejected because it covers only openai-compatible transports, sits below the SDK, and cannot help a caller that already consumed a rejected attempt.
- S03 env knobs: `OPENMAIC_LLM_CONNECTION_RETRIES` (default 2) and `OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS` (default 1000). Both go into `.env.example` next to `LLM_THINKING_DISABLED` (line 469) in the same PR, per the repo rule for operator-facing vars.
- S03 `streamLLM` stays unchanged. A stream can be partially consumed by the time an error surfaces, so retrying is not safely possible at the wrapper. The transcript errors come from the non-streaming `callLLM` path.
- No i18n keys. Tool-result text is agent-facing, not UI text. This matches the batch 006 precedent for API-facing inline strings.
- No `@openmaic` package changes, so no version bumps and no `scripts/check-package-version-bumps.mjs` impact.
- No `eslint.config.mjs` changes, so `tests/lint-llm-entry-guard.test.ts` keeps its current matrix green. `lib/ai/llm.ts` stays the single exempt entry.

## Testing Decisions

- Test homes. S01 extends `tests/agent-runtime/generation-tools.test.ts`, reusing the `state`, `deps`, and `find` helpers. S02 extends `tests/agent-runtime/roster-tools.test.ts`, reusing the `vi.hoisted` provider mocks, `makeStore`, `makeDoc`, `buildTools`, and `runTool` helpers. S03 adds `tests/ai/llm-connection-retry.test.ts`, reusing the `llm-thinking-options.test.ts` mock pattern: `vi.mock('ai')` for `generateText` and `streamText`, plus the usage-module mocks.
- Payload shapes pin the transcript. S01's new test passes the exact stringified shape from the transcript (concept plus keyVariables inside a JSON string) and asserts the parsed object flows into the persisted `SceneOutline`. S02's re-pinned tests use the hallucinated pairs `qwen-token-plan-tts::loongjameszhao` and `qwen-token-plan-tts::loongolivialin` and a catalog containing `longanlingxin`, `longanlufeng`, and `qwen-audio-3.0-tts-plus-<name>`. S03's tests reject `generateText` with the exact error shape `{ name: 'AI_APICallError', message: 'Cannot connect to API: Headers Timeout Error', isRetryable: true }` and no numeric `statusCode`, matching the resolved stack's `handleFetchError` output.
- Test names are gate contracts. S01's new test name contains `coerces a JSON-encoded widgetOutline string`, and the gate filters on that exact full name, because a shorter filter matched two tests that already pass. S02's three re-pinned tests each carry the literal `warnings` in their names, the gate filters on `warnings`, and the verify run must match at least 3 tests. S03's file is a whole-file gate. Byte-pin these substrings at ledger build, as batch 006 did with its `-t` name contracts.
- S02 re-pin detail: the three tests at roster-tools.test.ts lines 200-220, 301-320, and 327-347 change from rejection assertions to success-with-warning assertions. Each asserts the roster persisted, the bad agent unbound, the dropped voice named in content and warnings, and the warning sample capped at 10 with the total count.
- S03 env tests are hermetic. They set `OPENMAIC_LLM_CONNECTION_RETRIES` and `OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS` in `beforeEach` and restore them in `afterEach`. Root vitest does not load `.env.local`, so a host machine cannot leak config into the suite. Backoff is validated with injected sleep timing, not wall-clock waits.
- Gate oracle doctrine. Expect strings are literal substrings of stdout plus stderr. Silent-success commands echo a literal marker: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`. No regex oracles. Every gate pins `cwd` to the repo root. All gates are hermetic and free of paid network calls.
- Zero paid gates. Ledger discipline follows batch 005 and 006 lessons: symbol expectations at anchor creation, literal oracles, repo-root cwd, and the hostile-env hermeticity proof belongs to the verifier round, run from a neutral cwd such as `/tmp` with absolute ledger paths (the bun-compiled rivr auto-loads `.env.local` from its startup cwd).

## Out of Scope

- Voice cloning and enrollment. The vendor path is a gap outside this codebase.
- token-plan vendor latency itself. Retrying a slow endpoint is not the same as fixing endpoint slowness.
- Skill-constraint advisories seen in the transcript. They work as designed.
- The full-catalog size of `list_voices` results. The tool is the canonical enumeration the agent must see once before binding. This batch caps only rejection and warning payloads, which are the repeated-bloat vector.
- Retry for `streamLLM`. The wrapper cannot safely replay a consumed stream.
- Route-level or classroom-flow changes beyond what `callLLM` covers automatically.
- No `packages/@openmaic` changes and no i18n changes.

## Further Notes

- Cross-batch: `@openmaic/generation` already exports `withGenerationRetry` for empty-result retries (`packages/@openmaic/generation/src/generation-retry.ts`). It lives in the package and handles validation, not connection, retries. This batch keeps connection retry in `lib/ai/llm.ts` because the single-entry boundary requires every server-side model call to flow through `callLLM`, and adding it to the package would require a version bump.
- Guard interplay: `tests/lint-llm-entry-guard.test.ts` pins the LLM entry matrix. This batch changes no guard path, but it does edit `lib/ai/llm.ts`, so the guard is a required gate for S03. `tests/providers/provider-neutrality-guard.test.ts` pins vendor-token debt counts for provider-neutral files. None of the three edited files is in `PROVIDER_NEUTRAL_FILES`, and no new vendor literal is introduced, so the debt table stays unchanged.
- Session evidence stays reproducible. The transcript file for session 96cdbbfa is the reference artifact.
- Soundness review: `docs/research/007-spec-soundness-review.md`. Its two blockers are fixed in the text above. B1 replaced the nonexistent `APIConnectionError` detection with the real `AI_APICallError` connection-class shape. B2 tightened the S01 gate filter that was green before implementation. The citation concerns are folded into the S03 text.
- Risk callout for S02: the re-pin reverses a documented doctrine ("a half-applied roster is worse than none", roster-tools.test.ts:218). The new doctrine is that a single out-of-catalog voice must not cancel a user-settled roster. The spec checkpoint should confirm this reversal.
- Neutral-cwd note for the verifier: gate-executing rivr commands run from a neutral cwd with absolute ledger paths, because the bun-compiled CLI loads `.env.local` from its startup cwd into gate children.

## Research update (post-implementation)

**What shipped.** Implementation commit `8c810aab` on `feat/agent-session-friction`: "fix(agent-runtime): tolerate stringified widget outlines, drop bad voices with warnings, retry dead LLM connections". Spec and ledger docs were committed by its parent `e2792537`.

S01: `generate_scene` coerces a stringified `widgetOutline` before the object guard. `lib/server/agent-runtime/generation-tools.ts:287-299` parses only string values and accepts the result only when it is a plain non-null non-array object. Any other outcome falls through to the guard at `generation-tools.ts:300-311`, which keeps the error code `invalid-widget-outline` and now says "generate_scene needs widgetOutline to be a plain JSON object (not a stringified one) matching widgetType." No other parameter is coerced. The new test `coerces a JSON-encoded widgetOutline string into a plain object` lives at `tests/agent-runtime/generation-tools.test.ts:316`.

S02: `set_roster` collects every out-of-catalog binding in one pass at `lib/server/agent-runtime/roster-tools.ts:302-312`. Agents with dropped voices persist unbound via the `droppedAgentNames` set at `:315-322`. The tool returns success without `isError` at `:376-384`. Warnings live at `:359-368`: `details.warnings` carries `droppedBindings`, `totalAvailableBindings`, `sampleBindings` (capped at 10), and a `hint` pointing at `list_voices`. Content text names each dropped agent and voice at `:370-374`. The silently-unbound behavior for values that do not parse as `providerId::voiceId` is preserved through `parseVoiceConfig` (`roster-tools.ts:72-79`). Four re-pinned tests with `warnings` in their names live at `tests/agent-runtime/roster-tools.test.ts:200, 317, 353, 385`.

S03: `callLLM` gained a bounded connection-class retry. The helpers `readConnectionRetries`, `readConnectionRetryBaseMs`, `isConnectionRetryable`, and `sleep` live at `lib/ai/llm.ts:292-334`. The outer connection loop wraps the existing validation loop at `:393-473`, and the exhaustion wrapper at `:481-489` preserves name and cause and appends the literal "Retry the call". The signature is unchanged at `:375-384`. Env knobs `OPENMAIC_LLM_CONNECTION_RETRIES` (default 2) and `OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS` (default 1000) are documented in `.env.example:471-475`, directly after `LLM_THINKING_DISABLED` at `:469`. Usage accounting runs before validation on every resolved attempt (`llm.ts:417-426`), because every attempt that resolved was billed. `streamLLM`, the thinking switch, and usage storage are untouched.

**Deviations from the plan.** Three corrected before implementation, one naming divergence, one process correction.

1. B1 from the soundness review replaced the planned `APIConnectionError` detection. The resolved stack has no such class. `@ai-sdk/provider@3.0.8` names the error `AI_APICallError` (`dist/index.js:82`), and `@ai-sdk/provider-utils@4.0.23` builds the connection failure with `Cannot connect to API: ${cause.message}` and `isRetryable: true` and no numeric `statusCode` (`dist/index.js:607-622`). Shipped detection is duck-typed: `name === 'AI_APICallError'`, `isRetryable === true`, and absent numeric `statusCode` (`llm.ts:306-310`). Errors with a numeric `statusCode` stay out of the wrapper budget because the SDK layer already retries them.
2. B2 from the soundness review tightened the S01 gate filter. The shorter `-t "widgetOutline"` matched two tests that already passed, so it could not catch a regression. The gate now filters on the exact test name.
3. The original target symbols `generateScene` and `setRoster` were function-local consts invisible to the outline. The contract was amended, not silently changed: the superseded targets were recorded as after-exists false ghosts, and the contract rebound to the exported constructors `buildGenerationTools` (`generation-tools.ts:221`) and `buildRosterTools` (`roster-tools.ts:203`).
4. Field naming diverged from the plan prose. The plan said "dropped voices, the count, a sample, a hint". Shipped names are `droppedBindings`, `totalAvailableBindings`, `sampleBindings`, `hint`. The semantics match the plan.
5. Rivr 0.16 constraints drove the ledger build: a 300-char cap on slice expect strings, no target-remove verb, `init-batch` derives the ledger path from its startup cwd, and `capture` must run from the repo root.

**Surprises from the verification round.** One CLI quirk, one pre-existing observation, one probe result.

1. `rivr diff` compares a flattened stored signature against a whitespace-preserving re-capture. The unchanged `callLLM` signature therefore reported "deviates". Semantic byte-identity holds: the signature token sequence at `llm.ts:375-384` is identical to the pre-implementation version at `HEAD~1:325-331`. The verifier recorded this as a finding, not a rejection. The normalization belongs to the rivr tooling backlog.
2. `droppedAgentNames` keys drops by agent name (`roster-tools.ts:315-322`). Two roster agents sharing a name would both drop their bindings. Names are unique in practice in this feature, so the keying is safe today.
3. The hostile-env probe showed no discrepancy: running the rivr gate from a neutral cwd like `/tmp` and running it directly from the repo root produced the same result on S03 G01. This research round re-ran that gate fresh from the repo root and saw 6/6 pass.


## Certification Report

Certified: 2026-09-02T10:46:07.796Z
Signature: 12285c033a2377a2754ef18154f007fa758048f07ae39dc0b6c640b0fca79629

### Summary

Slices: 3
Symbols: 5
Gates: 9

### Implemented Symbols

- **S01** (Coerce stringified widgetOutline in generate_scene):
  - lib/server/agent-runtime/generation-tools.ts::generateScene
  - lib/server/agent-runtime/generation-tools.ts::buildGenerationTools
- **S02** (Resilient set_roster voice binding):
  - lib/server/agent-runtime/roster-tools.ts::setRoster
  - lib/server/agent-runtime/roster-tools.ts::buildRosterTools
- **S03** (Bounded connection-error retry in callLLM):
  - lib/ai/llm.ts::callLLM

### Gates Passed

- **S01**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/generation-tools.test.ts \u001b[2m(\u001b[22m\u001b[2m16 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m15 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[32m 5\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m15 skipped\u001b[39m\u001b[90m (16)\u001b[39m\n\u001b[2m   Start at \u001b[22m 22:30:48\n\u001b[2m   Duration \u001b[22m 980ms\u001b[2m (transform 510ms, setup 11ms, import 905ms, tests 5ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S02**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/roster-tools.test.ts \u001b[2m(\u001b[22m\u001b[2m21 tests\u001b[22m\u001b[2m | \u001b[22m\u001b[33m17 skipped\u001b[39m\u001b[2m)\u001b[22m\u001b[32m 4\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[33m17 skipped\u001b[39m\u001b[90m (21)\u001b[39m\n\u001b[2m   Start at \u001b[22m 22:31:16\n\u001b[2m   Duration \u001b[22m 1.32s\u001b[2m (transform 591ms, setup 17ms, import 1.22s, tests 4ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/agent-runtime/roster-tools.test.ts \u001b[2m(\u001b[22m\u001b[2m21 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 10\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m21 passed\u001b[39m\u001b[22m\u001b[90m (21)\u001b[39m\n\u001b[2m   Start at \u001b[22m 22:31:18\n\u001b[2m   Duration \u001b[22m 971ms\u001b[2m (transform 515ms, setup 12ms, import 891ms, tests 10ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S03**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/ai/llm-connection-retry.test.ts \u001b[2m(\u001b[22m\u001b[2m6 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 7\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m6 passed\u001b[39m\u001b[22m\u001b[90m (6)\u001b[39m\n\u001b[2m   Start at \u001b[22m 22:31:41\n\u001b[2m   Duration \u001b[22m 239ms\u001b[2m (transform 67ms, setup 15ms, import 149ms, tests 7ms, environment 0ms)\u001b[22m\n\n\u001b[90mstderr\u001b[2m | tests/ai/llm-connection-retry.test.ts\u001b[2m > \u001b[22m\u001b[2mLLM connection retry\u001b[2m > \u001b[22m\u001b[2mretries transient connection error then succeeds\n\u001b[22m\u001b[39m[2026-09-02T10:31:42.056Z] [WARN] [LLM] [test-connection-retry] Connection error (attempt 1/3), retrying after backoff... AI_APICallError: Cannot connect to API: Headers Timeout Error\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/tests/ai/llm-connection-retry.test.ts:36:40\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at VitestModuleEvaluator._runInlinedModule (file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/vitest@4.1.8_@opentelemetry+api@1.9.0_@types+node@20.19.37_jsdom@29.1.1_@noble+hashes@1_7b10633e961db4c458aa68acfaeb9e10/node_modules/vitest/dist/module-evaluator.js:206:4)\n    at VitestModuleRunner.directRequest (file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/vite@8.0.0_@emnapi+core@1.8.1_@emnapi+runtime@1.8.1_@types+node@20.19.37_esbuild@0.27.7_005eb5d6fab88ff2d576fe91ee62ddb8/node_modules/vite/dist/node/module-runner.js:1243:59)\n    at VitestModuleRunner.cachedRequest (file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/vite@8.0.0_@emnapi+core@1.8.1_@emnapi+runtime@1.8.1_@types+node@20.19.37_esbuild@0.27.7_005eb5d6fab88ff2d576fe91ee62ddb8/node_modules/vite/dist/node/module-runner.js:1150:73)\n    at VitestModuleRunner.import (file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/vite@8.0.0_@emnapi+core@1.8.1_@emnapi+runtime@1.8.1_@types+node@20.19.37_esbuild@0.27.7_005eb5d6fab88ff2d576fe91ee62ddb8/node_modules/vite/dist/node/module-runner.js:1100:10)\n    at file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/@vitest+runner@4.1.8/node_modules/@vitest/runner/dist/chunk-artifact.js:2457:5\n    at collectTests (file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/@vitest+runner@4.1.8/node_modules/@vitest/runner/dist/chunk-artifact.js:2433:3)\n    at startTests (file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/@vitest+runner@4.1.8/node_modules/@vitest/runner/dist/chunk-artifact.js:3278:17)\n    at file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/vitest@4.1.8_@opentelemetry+api@1.9.0_@types+node@20.19.37_jsdom@29.1.1_@noble+hashes@1_7b10633e961db4c458aa68acfaeb9e10/node_modules/vitest/dist/chunks/base.RR7zL1h0.js:90:5\n\n\u001b[90mstderr\u001b[2m | tests/ai/llm-connection-retry.test.ts\u001b[2m > \u001b[22m\u001b[2mLLM connection retry\u001b[2m > \u001b[22m\u001b[2mexhausts retries and throws with Retry the call guidance\n\u001b[22m\u001b[39m[2026-09-02T10:31:42.059Z] [WARN] [LLM] [test-connection-exhaust] Connection error (attempt 1/2), retrying after backoff... AI_APICallError: Cannot connect to API: Headers Timeout Error\n    at /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/tests/ai/llm-connection-retry.test.ts:36:40\n    at processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at VitestModuleEvaluator._runInlinedModule (file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/vitest@4.1.8_@opentelemetry+api@1.9.0_@types+node@20.19.37_jsdom@29.1.1_@noble+hashes@1_7b10633e961db4c458aa68acfaeb9e10/node_modules/vitest/dist/module-evaluator.js:206:4)\n    at VitestModuleRunner.directRequest (file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/node_modules/.pnpm/vite@8.0.0_@emnapi+core@1.8.1_@emnapi+runtime@1.8.1_@types+node@20.19.37_esbuild@0.27.7_005eb5d6fab88ff2d576fe91ee62ddb8/node_modules/vite/dist/node/module-runner.js:1243:59)\n    at Vite","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/ai/llm-thinking-options.test.ts \u001b[2m(\u001b[22m\u001b[2m12 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 268\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m12 passed\u001b[39m\u001b[22m\u001b[90m (12)\u001b[39m\n\u001b[2m   Start at \u001b[22m 22:31:42\n\u001b[2m   Duration \u001b[22m 468ms\u001b[2m (transform 65ms, setup 12ms, import 125ms, tests 268ms, environment 0ms)\u001b[22m\n\n\u001b[90mstderr\u001b[2m | tests/ai/llm-thinking-options.test.ts\u001b[2m > \u001b[22m\u001b[2mLLM thinking provider options\u001b[2m > \u001b[22m\u001b[2mrecords every attempt when a retry is configured, not just the accepted one\n\u001b[22m\u001b[39m[2026-09-02T10:31:42.771Z] [WARN] [LLM] [test] Validation failed (attempt 1/2), retrying...\n\n\u001b[90mstderr\u001b[2m | tests/ai/llm-thinking-options.test.ts\u001b[2m > \u001b[22m\u001b[2mLLM thinking provider options\u001b[2m > \u001b[22m\u001b[2mrecords the last attempt even when every attempt fails validation\n\u001b[22m\u001b[39m[2026-09-02T10:31:42.824Z] [WARN] [LLM] [test] Validation failed (attempt 1/2), retrying...\n\n\u001b[90mstderr\u001b[2m | tests/ai/llm-thinking-options.test.ts\u001b[2m > \u001b[22m\u001b[2mLLM thinking provider options\u001b[2m > \u001b[22m\u001b[2mrecords the last attempt even when every attempt fails validation\n\u001b[22m\u001b[39m[2026-09-02T10:31:42.824Z] [WARN] [LLM] [test] Validation failed (attempt 2/2), giving up\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"TSC_OK\n","passed":true}
  - G04: {"id":"G04","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/lint-llm-entry-guard.test.ts \u001b[2m(\u001b[22m\u001b[2m32 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 1868\u001b[2mms\u001b[22m\u001b[39m\n     \u001b[33m\u001b[2m✓\u001b[22m\u001b[39m blocks the named import in every guarded path (.ts) \u001b[33m 1141\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m32 passed\u001b[39m\u001b[22m\u001b[90m (32)\u001b[39m\n\u001b[2m   Start at \u001b[22m 22:31:48\n\u001b[2m   Duration \u001b[22m 2.06s\u001b[2m (transform 16ms, setup 12ms, import 121ms, tests 1.87s, environment 0ms)\u001b[22m\n\n","passed":true}

Certification hash: 12285c033a2377a2754ef18154f007fa758048f07ae39dc0b6c640b0fca79629
Certified: 2026-09-02T10:46:07.796Z | Signature: 12285c033a2377a2754ef18154f007fa758048f07ae39dc0b6c640b0fca79629 | Certifier: verifier
