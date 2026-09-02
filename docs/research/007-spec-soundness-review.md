# Spec Soundness Review: 007 agent-session-friction

Reviewer: independent researcher, fresh session. The reviewer did not write the spec.
Date: 2026-09-02.
Scope: dry-run of every gate, verification of every contract citation, probe of the ai-sdk claims.
No code changed. No ledger created.

## Verdict

Blockers. Two defects stop approval. Both have byte-exact fixes below. The design decisions Q1-Q4 are sound. The S01 and S02 mechanics are correct against the code. S03 is correct in shape but built on a wrong error-class fact. One gate is demonstrably green before implementation.

## Blockers

### B1. S03 detects a class that does not exist in the installed SDK

The spec builds the whole retry mechanism on `APIConnectionError`. The resolved packages have no such class.

Evidence:

- The app resolves `@ai-sdk/provider@3.0.8` and `@ai-sdk/provider-utils@4.0.23` (both nested under `node_modules/.pnpm/ai@6.0.168_zod@4.3.6/node_modules/`).
- `@ai-sdk/provider/dist/index.js` exports one API error class: `APICallError` (export list, line 86). Its `name` constant is `"AI_APICallError"` (line 82). Zero hits for `APIConnectionError` in the dist JS and the `.d.ts`.
- `@ai-sdk/provider-utils/dist/index.js` `handleFetchError` (line 595) constructs `new import_provider3.APICallError({ message: 'Cannot connect to API: ' + cause.message, cause, url, requestBodyValues, isRetryable: true })` (lines 601-610). The message at line 607 matches the transcript string exactly. The class is `APICallError`. Zero hits for `APIConnectionError` in the dist JS and the `.d.ts`.

What this breaks:

- The spec postcondition says "detected by `error.name === 'APIConnectionError'`". The real name is `AI_APICallError`. The check never fires. The retry never runs.
- The spec test fixture `{ name: 'APIConnectionError', message: 'Cannot connect to API: Headers Timeout Error' }` mirrors a name that never occurs. Unit tests would pass while production detection stays dead.
- The postcondition says "an error with name preserved as `APIConnectionError`". The real name is `AI_APICallError`.

What still holds:

- The SDK retry path does cover this error. `ai@6.0.168` retries when `APICallError.isInstance(error) && error.isRetryable === true` (dist/index.js:2716), default `maxRetries = 2` (line 2681), and throws immediately when `maxRetries === 0` (line 2703). The spec line cites 2681 and 2716, both exact.
- The transcript message `Cannot connect to API: Headers Timeout Error` is real and reproducible from the SDK code.

Concrete spec fix:

1. Detection: `error instanceof Error && error.name === 'AI_APICallError' && error.isRetryable === true`. Add `error.statusCode === undefined` if the retry must exclude HTTP-status retries (429, 5xx also carry `isRetryable: true`).
2. Test fixture: `{ name: 'AI_APICallError', message: 'Cannot connect to API: Headers Timeout Error', isRetryable: true }`.
3. Postcondition wording: the exhausted error preserves name `AI_APICallError` and sets `cause` to the original. The scene-generator statusCode walk at `packages/@openmaic/generation/src/scene-generator.ts:957-971` still works because it reads through `cause` chains.
4. Keep the "no new imports" rule. Name and flag detection needs no import.

### B2. S01 G01 goes green today. The gate is not RED-first.

The gate `npx vitest run tests/agent-runtime/generation-tools.test.ts -t "widgetOutline"` expect `passed` runs 2 tests today, both green.

Evidence:

- Test at `tests/agent-runtime/generation-tools.test.ts:207`: "passes widgetType and widgetOutline through to interactive generation". The name contains `widgetOutline`.
- Test at line 274: "rejects malformed widgetOutline values without writing anything". The name contains `widgetOutline`.
- Dry-run result: exit 0, output `Tests  2 passed | 13 skipped (15)`.

Concrete spec fix:

- Replace the gate with: `npx vitest run tests/agent-runtime/generation-tools.test.ts -t "coerces a JSON-encoded widgetOutline string"` expect `passed`.
- Dry-run of the corrected filter today: exit 0, output `Tests  15 skipped (15)`, no `passed` substring. It is red before implementation. After implementation it matches the one new test and prints `1 passed`.

## Concerns

### C1. S02 G01 exits 0 with zero matched tests

`npx vitest run tests/agent-runtime/roster-tools.test.ts -t "warnings"` matches zero tests today. Exit 0, output `Tests  20 skipped (20)`, no `passed` substring. The gate is red only because the literal `passed` is absent. A renaming of any test to contain `warnings`, or a reporter wording change, flips it green without running anything.

Fix: keep the filter, and pin the three re-pinned test names to all contain the literal `warnings` at ledger build. Add a verify instruction: the run after implementation must show `Tests  3 passed` or higher. A gate that runs zero tests must not count as evidence.

### C2. Two llm.ts behavior claims need sharper wording

The spec says `retryOptions` "keeps governing validation retries". The current loop at `lib/ai/llm.ts:373-380` retries ANY thrown error when `retryOptions.retries > 0`. Validation failure is the continue path, not the only retry path. A caller with retries configured already retries connection errors today. The new connection-retry must compose with that loop. An outer loop around the existing attempt block preserves current behavior. The spec should say this once.

The spec says "usage recording runs only on success". The code at `lib/ai/llm.ts:352-361` records on every attempt that reaches a result, before validation. A connection-retry outer loop changes nothing. The spec sentence should say recording stays per-attempt-on-result, unchanged.

### C3. providers.ts citation is a region, not the symbol

The spec anchors "providers.ts:2031/2202" for the rejected compatFetch option. The truth: `getModel` starts at 2031, `compatFetch` is defined at 2099, assigned at 2199, `createOpenAI` called at 2202. The file is `lib/ai/providers.ts`, not `lib/server/providers.ts`. Correct the anchors to 2099/2199.

### C4. scene-generator.ts lives in the package

The cited file is `packages/@openmaic/generation/src/scene-generator.ts`, not under `lib/`. The line cite 957-971 is exact. Name the full path so implementers do not hunt.

## Contract symbol verification

All cited ranges checked against the tree. Drift is flagged.

| Citation | Claim | Verdict |
| --- | --- | --- |
| generation-tools.ts:60-65 | widgetOutline `Type.Unknown` schema hole | Exact |
| generation-tools.ts:226 | `generateScene` const | Exact |
| generation-tools.ts:222-223 | aiCallFor path | Exact |
| generation-tools.ts:287-298 | object guard and rejection message | Exact |
| generation-tools.ts:307-335 | SceneOutline build, cast at 319 | Exact |
| generation-tools.ts:383 | generateSceneContent call | Exact |
| generation-tools.ts:406 | rethrow, non-PBL errors propagate | Exact |
| generation-tools.ts:411 | generateSceneActions path | Exact |
| roster-tools.ts:72-79 | parseVoiceConfig | Exact |
| roster-tools.ts:97-119 | agentVoiceCatalog | Exact |
| roster-tools.ts:233 | setRoster const | Exact |
| roster-tools.ts:246 / 258 / 276 | at-least-2, teacher-count, no-document | Exact |
| roster-tools.ts:299-300 | catalog and catalogBindings | Exact |
| roster-tools.ts:301-323 | first-unusable `.find`, voice-not-in-catalog | Exact |
| roster-tools.ts:319 | availableBindings spread | Exact |
| roster-tools.ts:326-338 | avatar/color/priority/voiceDesign normalize | Exact |
| roster-tools.ts:363-371 | success shape | Exact |
| generation-ai-call.ts:22-38 | factory calls callLLM | Exact |
| generation-ai-call.ts:30 | maxRetries: 0 | Exact |
| llm.ts:264-267 | retry-for-validation comment | Exact |
| llm.ts:325-386 | callLLM body | Exact |
| llm.ts:332 | maxAttempts line | Exact |
| llm.ts:348-350 | thinkingContext.run | Exact |
| llm.ts:385 | throw lastError | Exact |
| tool-timeout.ts:41 | generate_scene 15 min | Exact |
| build-agent.ts:28-39 | maic-connector stub | Exact |
| .env.example:469 | LLM_THINKING_DISABLED | Exact |
| scene-generator.ts:957-971 | statusCode walk through cause | Exact |
| generation-retry.ts | withGenerationRetry exists | Exact |
| providers.ts:2031/2202 | compatFetch region | Drift: symbol at 2099 |
| resolve-model.ts:40-144 | resolveModel body | Exact |
| classroom-generation.ts:323 / 373 | maxRetries: 0 sites | Exact |

The postcondition signature `(params: T, source: string, retryOptions?: LLMRetryOptions, thinking?: ThinkingConfig): Promise<GenerateTextResult<any, any>>` renders exactly from the real `callLLM` signature with name and async stripped.

## Pinned test claims

- `tests/agent-runtime/generation-tools.test.ts:274-301`: the test "rejects malformed widgetOutline values without writing anything". The `null` assertion lands at 289-291 with `invalid-widget-outline` at 291. The `'mindmap'` assertion lands at 298-300 with the code at 300. The spec cites assertions at 291 and 300. Exact.
- `tests/agent-runtime/roster-tools.test.ts:200-220`: rejection test, `isError` at 216, code at 217, doctrine comment at 218, nothing-persisted at 219. Exact.
- `roster-tools.test.ts:301-320` and `327-347`: both assert `isError: true`, `voice-not-in-catalog`, and nothing persisted. Exact. All three ranges match the spec's re-pin targets.
- `tests/ai/llm-connection-retry.test.ts` does not exist. The dry run confirms `No test files found, exiting with code 1`. Good red state for S03 G01.
- `tests/ai` holds 13 files: anthropic-provider, anthropic-serialization, atlascloud-provider, bedrock-provider, llm-thinking-options, minimax-provider, model-aliases, model-metadata, openai-provider, openai-sdk-integration, reasoning-sse, thinking-config, xiaomi-provider. All kebab-case `.test.ts`. The new name follows the pattern.
- The S03 test-home claim is exact. `llm-thinking-options.test.ts` uses `vi.mock('ai')` for generateText and streamText plus `vi.mock` for the two usage modules, with `vi.hoisted` fns.
- The roster test helpers exist: `vi.hoisted` provider mocks (lines 31-43), `makeStore` (46), `makeDoc` (59), `buildTools` (78), `runTool` (86).

## Suite contradictions

- `PROVIDER_NEUTRAL_FILES` in `tests/providers/provider-neutrality-guard.test.ts:58-90` does not contain any of the three edited files. The guard scans only those files plus the registry sources used to derive vendor vocabulary. `generation-tools.ts`, `roster-tools.ts`, and `llm.ts` are not scanned. The env var names and all new strings carry no vendor terms. No debt count changes.
- `tests/lint-llm-entry-guard.test.ts` pins the eslint matrix. `lib/ai/llm` is the single exempt path (line 58). Editing the llm.ts body adds no import and no eslint config change. The guard stays green.
- The S03 design does not touch usage recording or `LLM_THINKING_DISABLED`. The new loop wraps the existing attempt block. See C2 for the wording fixes.

## ai-sdk probe results

- `@ai-sdk/provider-utils@4.0.23` handle-fetch-error sets `isRetryable: true` and message `Cannot connect to API: ...` as claimed. The class is `APICallError`, not `APIConnectionError`. See B1.
- `ai@6.0.168` defaults `maxRetries = 2` (dist/index.js:2681) and retries `APICallError.isInstance(error) && error.isRetryable === true` (line 2716). Backoff is exponential, factor 2, initial 2000 ms. `maxRetries === 0` throws the raw error immediately (line 2703), which is why the transcript shows the raw message.
- The instanceof question resolves to: the SDK retry path accepts an `APICallError` instance. There is no `APIConnectionError` in the resolved tree to be an instance of. The spec root-cause story needs the correction in B1.

## Dry-run log

All commands ran byte-exact from the repo root `/Users/franky/Projects/MyOpenMAIC/Source/openMAIC`. Root vitest is hermetic. No `.env.local` is loaded. Zero network calls.

| Gate | Command | Expect | Result |
| --- | --- | --- | --- |
| S01 G01 | `npx vitest run tests/agent-runtime/generation-tools.test.ts -t "widgetOutline"` | `passed` | Exit 0. `Tests  2 passed | 13 skipped (15)`. Green today. Blocker B2. |
| S01 G01 fix | `npx vitest run tests/agent-runtime/generation-tools.test.ts -t "coerces a JSON-encoded widgetOutline string"` | `passed` | Exit 0. `Tests  15 skipped (15)`. No `passed`. Red today. |
| S01 G02 | `npx tsc --noEmit && echo TSC_OK` | `TSC_OK` | Exit 0. `TSC_OK` printed. OK. |
| S02 G01 | `npx vitest run tests/agent-runtime/roster-tools.test.ts -t "warnings"` | `passed` | Exit 0. `Tests  20 skipped (20)`. No `passed`. Red today. Concern C1. |
| S02 G02 | `npx vitest run tests/agent-runtime/roster-tools.test.ts` | `passed` | Exit 0. `Tests  20 passed (20)`. OK. |
| S02 G03 | `npx tsc --noEmit && echo TSC_OK` | `TSC_OK` | Exit 0. OK. |
| S03 G01 | `npx vitest run tests/ai/llm-connection-retry.test.ts` | `passed` | Exit 1. `No test files found, exiting with code 1`. Red today. OK. |
| S03 G02 | `npx vitest run tests/ai/llm-thinking-options.test.ts` | `passed` | Exit 0. `Tests  12 passed (12)`. OK. |
| S03 G03 | `npx tsc --noEmit && echo TSC_OK` | `TSC_OK` | Exit 0. OK. |
| S03 G04 | `npx vitest run tests/lint-llm-entry-guard.test.ts` | `passed` | Exit 0. `Tests  32 passed (32)`. OK. |

Reporter wording check: vitest 4.1.8 prints the literal word `passed` in the summary lines `Test Files  1 passed (1)` and `Tests  20 passed (20)`. The `passed` oracles are live. A missing file prints `No test files found, exiting with code 1` and exit code 1.

## Summary of fixes for the spec author

1. In S03, replace every `APIConnectionError` with the real contract: name `AI_APICallError`, flag `isRetryable === true`, and the byte-exact test fixture `{ name: 'AI_APICallError', message: 'Cannot connect to API: Headers Timeout Error', isRetryable: true }`.
2. Replace S01 G01 with `npx vitest run tests/agent-runtime/generation-tools.test.ts -t "coerces a JSON-encoded widgetOutline string"` expect `passed`.
3. Pin the three S02 re-pinned test names to contain `warnings`, and require the verify run to show 3 or more matched tests.
4. Correct the providers.ts anchors to 2099/2199 and the scene-generator path.

Status: Review complete. Two blockers returned to the spec author.