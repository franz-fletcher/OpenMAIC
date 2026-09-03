# Batch 010 spec: providers-client-graph-fix

Spec status: closed

## Problem Statement

Every route in dev shows the Next.js Runtime Error overlay. The overlay says: `Cannot find module 'node:net': Unsupported external type Url for commonjs reference`. The error reproduces deterministically on http://localhost:3000/workspace through chrome-devtools MCP. The call stack is: `app/layout.tsx(50:13)` RootLayout, then `components/server-providers-init.tsx(4:1)`, then `lib/store/settings.ts(14:1)`, then `lib/ai/providers.ts(35:1)` module evaluation.

The fault entered in commit `7844d653` (batch 008 S02). The commit added a top-level `import { Agent as UndiciAgent } from 'undici'` to `lib/ai/providers.ts:35`. It also added `const llmNoTimeoutAgent = new UndiciAgent({ headersTimeout: 0, bodyTimeout: 0 })` at `lib/ai/providers.ts:1888`. Both run at module evaluation. A revert to `65b4cd76^` does not help, because batch 008 landed earlier. `git log -S` confirms `7844d653` is the only commit that introduced the static import.

`providers.ts` sits in the client graph. Three client runtime edges pull values from it: `lib/store/settings.ts:14` imports `PROVIDERS`, `components/settings/provider-list.tsx:8` imports `MONO_LOGO_PROVIDERS`, and `components/settings/index.tsx:37` imports both. `ServerProvidersInit` in the root layout is a `'use client'` component that imports the settings store. Turbopack therefore bundles `undici` for the browser (network chunks `475fc_undici_*`), and the `node:net` require fails at module evaluation.

The file already removes `undici` from the browser graph in one place. The google proxy path at `lib/ai/providers.ts:2304` uses `await import(/* webpackIgnore: true */ 'undici')` inside a fetch wrapper. The 008 wrappers did not follow this precedent.

The unit tests for 008 S02 did not catch the break. `tests/ai/llm-fetch-timeouts.test.ts` runs under the vitest node environment and asserts only that the dispatcher reaches `fetch`. No test asserted that the browser bundle stays clean. That is the testing gap.

## Solution

Remove the static `undici` import and the eager agent instantiation from module evaluation. Replace them with a lazy memoized getter that imports `undici` dynamically, with the `webpackIgnore: true` comment, exactly like the existing google proxy path. Both 008 wrappers call the getter inside their async bodies, on the server only.

Add a static guard test that fails if any node-only package becomes a top-level static import in `lib/ai/providers.ts` again. Add a Playwright spec that opens the root route and asserts the page raises no `undici` or `node:net` errors. Keep `tests/ai/llm-fetch-timeouts.test.ts` passing unchanged.

## User Stories

1. As an operator, I want the workspace to load without the runtime error overlay, so that I can use the app in dev.
2. As a maintainer, I want a static guard that rejects node-only imports in the client-shared module, so that the regression cannot return silently.
3. As a maintainer, I want a browser check that the root route raises no bundled `undici` errors, so that the exact dev symptom stays covered.
4. As a maintainer, I want the dispatcher timeout behavior preserved, so that long LLM requests keep their raised timeout caps.

## Slices

### S01 · Lazy no-timeout agent

Delivers: `lib/ai/providers.ts` drops the static `undici` import at line 35 and the eager `new UndiciAgent` at line 1888. A new module-level lazy getter `getLlmNoTimeoutAgent` does a memoized `await import(/* webpackIgnore: true */ 'undici')` and instantiates the agent on first call. The `compatFetch` wrapper (line 2154 dispatcher use) and the Anthropic wrapper (line 2274 dispatcher use) call the getter in their async bodies. The new guard test `tests/lint-providers-client-graph.test.ts` passes. `tests/ai/llm-fetch-timeouts.test.ts` still passes.

Blocker: none.

Risk tier: 3. Gate tag: integration.

Postconditions:
- `lib/ai/providers.ts::llmNoTimeoutAgent`: no instantiation of `UndiciAgent` at module evaluation. No top-level static `undici` import remains anywhere in the file.
- `lib/ai/providers.ts::getLlmNoTimeoutAgent`: new module-level async getter, memoized, imports `undici` with `webpackIgnore: true`, returns a shared agent with `headersTimeout: 0` and `bodyTimeout: 0`.
- `tests/lint-providers-client-graph.test.ts::describe 'providers client-graph guard'`: the new test passes. It reads `lib/ai/providers.ts` and asserts that no static top-level import has a node-only specifier (`undici`, `node:net`, `node:tls`). Dynamic `webpackIgnore` imports stay legal.
- `tests/ai/llm-fetch-timeouts.test.ts::describe 'LLM fetch timeout configuration'`: all existing assertions pass unchanged. The injected dispatcher still has a `dispatch` function.

Gates:
1. `pnpm test tests/lint-providers-client-graph.test.ts` (guard)
2. `pnpm test tests/ai/llm-fetch-timeouts.test.ts` (behavior preserved)
3. `npx tsc --noEmit` (type marker)

### S02 · Safari console-clean gate script

Delivers: new script `scripts/check-safari-console-clean.js`. It spawns `safaridriver --mcp` and speaks JSON-RPC over stdio (create_tab + browser_console_messages), navigates to `http://localhost:3000/workspace`, reads the browser log, and asserts no entry matches `Cannot find module`, `undici`, or `node:net`. It prints `SAFARI_CONSOLE_CLEAN` and exits 0 on success, exits 1 with the matching log lines otherwise, and always terminates the safaridriver it spawned. Precondition: the dev server is running on port 3000. The script uses only Node built-ins and the MCP stdio protocol.

Blocker: none.

Risk tier: 1. Gate tag: none.

Postconditions:
- `scripts/check-safari-console-clean.js::checkSafariConsoleClean`: new exported async function taking the target URL, driving one safaridriver session, returning the offending console lines or an empty list. The CLI entry calls it and maps the result to the exit code and the `SAFARI_CONSOLE_CLEAN` marker.

Gates:
1. `node scripts/check-safari-console-clean.js` (runtime symptom, needs dev server on 3000)

## Implementation Decisions

- Fix the module, not the constants. The lazy dynamic import keeps the change inside `lib/ai/providers.ts`. The alternative, a client-safe constants module, must move `PROVIDERS` and `MONO_LOGO_PROVIDERS` out of a 2300-line server module that `lib/server/*` imports. That change touches four or more files and creates a second source of truth. This batch rejects it because the blast radius must stay small.
- Mirror the existing precedent. The google proxy path at `lib/ai/providers.ts:2304` already uses `await import(/* webpackIgnore: true */ 'undici')`. The getter uses the same pattern, so the compiler treats the specifier as external to the browser bundle.
- Defer the instantiation too. The eager `new UndiciAgent` at line 1888 also runs at module evaluation. The getter owns the instantiation as well as the import. This is the part a naive import-only fix would miss.
- Keep the tests hermetic. The guard test reads the source file directly. It needs no ESLint fixture and no new CI wiring.
- The browser gate drives Safari directly. The team's primary browser for this app is Safari, and `safaridriver` is already enabled on the machine. A plain Node script that spawns `safaridriver --mcp` and speaks JSON-RPC over stdio is one file with zero new dependencies, and rivr gates can only run shell commands, so the check lives in a script instead of an MCP session or a Playwright spec.

## Testing Decisions

- The static guard is the durable regression seam. It pattern-matches `tests/lint-llm-entry-guard.test.ts` for placement under `tests/`. It parses the top of the source file and fails on any static import of `undici`, `node:net`, or `node:tls`. A future edit that reintroduces the faulty edge fails this test.
- The dispatcher test stays the behavior contract. `tests/ai/llm-fetch-timeouts.test.ts` proves the agent still reaches `fetch` with the raised timeout caps. The lazy getter returns a real `Agent`, so the `dispatch` assertion holds.
- The Safari script is the honest gate for the exact symptom. It runs the same engine where the error reproduced, the real dev server on port 3000. The browser log catches the module-evaluation exception that produces the overlay.
- `npx tsc --noEmit` covers the type shape. The dynamic import must type-check where `dispatcher` is assigned.

## Out of Scope

- Moving `PROVIDERS` or `MONO_LOGO_PROVIDERS` to a new constants module.
- Adding Playwright specs for this regression; the Safari WebDriver script covers the runtime path.
- Changing any ESLint rule or the LLM entry guard.
- Editing CI workflows or `tests/workflows/ci-video-export-contract.test.ts`.
- Fixing the type-only provider imports in client components.
- Any other change to the provider catalog.

## Further Notes

- Local `pnpm dev` is the repro environment. Turbopack bundles `undici` for the client. The Safari gate runs against that same dev server, so it covers the real path.
- The Safari gate asserts absence of the specific error family, not absence of all console noise. This keeps the gate resistant to unrelated warnings.
- The revert test in the diagnosis proved the regression comes from the static import alone. The pre-008 module was client-safe.
- Risk at checkpoint: if Turbopack does not honor `webpackIgnore` in a client bundle, the lazy import still fails in dev. The existing google path at line 2304 is the same pattern, but it was never exercised from the client. S02 verifies this assumption end to end.
## Certification Report

Certified: 2026-09-03T06:42:52.633Z
Signature: 790140b1c2eab2c900cd10c2a091503b1b4f4d970d26e4dbcec6ccd095d43935

### Summary

Slices: 2
Symbols: 2
Gates: 4

### Implemented Symbols

- **S01** (Lazy no-timeout agent and client-graph guard):
  - lib/ai/providers.ts::getLlmNoTimeoutAgent
- **S02** (Safari console-clean gate script):
  - scripts/check-safari-console-clean.js::checkSafariConsoleClean

### Gates Passed

- **S01**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/lint-providers-client-graph.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/lint-providers-client-graph.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 4\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 18:40:11\n\u001b[2m   Duration \u001b[22m 98ms\u001b[2m (transform 17ms, setup 16ms, import 9ms, tests 4ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G02: {"id":"G02","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/ai/llm-fetch-timeouts.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/ai/llm-fetch-timeouts.test.ts \u001b[2m(\u001b[22m\u001b[2m2 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 63\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m\n\u001b[2m   Start at \u001b[22m 18:40:12\n\u001b[2m   Duration \u001b[22m 272ms\u001b[2m (transform 61ms, setup 11ms, import 134ms, tests 63ms, environment 0ms)\u001b[22m\n\n","passed":true}
  - G03: {"id":"G03","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S02**:
  - G01: {"id":"G01","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"SAFARI_CONSOLE_CLEAN\n(node:58462) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/franky/Projects/MyOpenMAIC/Source/openMAIC/scripts/check-safari-console-clean.js is not specified and it doesn't parse as CommonJS.\nReparsing as ES module because module syntax was detected. This incurs a performance overhead.\nTo eliminate this warning, add \"type\": \"module\" to /Users/franky/Projects/MyOpenMAIC/Source/openMAIC/package.json.\n(Use `node --trace-warnings ...` to show where the warning was created)\n","passed":true}

Certification hash: 790140b1c2eab2c900cd10c2a091503b1b4f4d970d26e4dbcec6ccd095d43935
Certified: 2026-09-03T06:42:52.633Z | Signature: 790140b1c2eab2c900cd10c2a091503b1b4f4d970d26e4dbcec6ccd095d43935 | Certifier: verifier
