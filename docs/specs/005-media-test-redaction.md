# Batch 005 spec: media-test redaction

Spec status: research_update

## Problem Statement

The full test suite has one allowed red. `tests/server/classroom-media-generation.test.ts` fails on machines that carry a `server-providers.yml`, and its failure output prints a live bearer key. Batch 001 recorded this as finding F5 and excluded the file from its aggregate gate. Every full-suite run since has excluded the file. The exclusion hides a secret-printing bug, and the key that prints is live operator material.

## Solution

Make the fetch-mocked server tests hermetic against `server-providers.yml`, change assertions so no failure can serialize a header-bearing request init, and add a guard test that proves a live-shaped fixture key never reaches logs or failure output. Retire the batch-001 gate exclusion by passing the full suite without it. All fixes live in `tests/server/`. No file under `lib/`, no neutrality file, no i18n locale changes.

The leak mechanism, reproduced with a sentinel key (temp test, deleted; worktree clean):

1. `classroom-media-generation.test.ts:9-19` mocks only `mkdir`/`writeFile`. The YAML read of `server-providers.yml` reaches real fs (`lib/server/provider-config.ts:559`).
2. `resolveSectionApiKey` (`provider-config.ts:604-612`) returns the YAML key first, so env stubs cannot override a host YAML entry.
3. A host YAML with an enabled image or video provider makes fetch get called anyway. The force-disabled assertion at `:137` (`expect(fetchMock).not.toHaveBeenCalled()`) fails, and vitest serializes the first call, including `Authorization: Bearer <live key>`.
4. Second vector, found live by the batch-005 round-1 verifier: a bun-compiled gate runner auto-loads `.env.local` into its process and gate children inherit it. Under that runner the classroom suite made a real happyhorse call and serialized a live Bearer header, and the force-off suite resolved an env-backed provider (400 became 200). Plain `pnpm test` is hermetic; the gate path is not.

Error taxonomy for spy failures, proven live: `not.toHaveBeenCalled()` and `toHaveBeenCalledWith(...)` print the full init with headers; a failing assertion on a parsed body value prints only that value.

## User Stories

1. As an operator, the classroom media test passes in the full suite on a machine with `server-providers.yml`, so the batch-001 exclusion retires.
2. As an operator, a failing assertion in fetch-mocked server tests prints no `sk-`-style secret.
3. As a maintainer, a hermetic guard test proves the property, so a regression fails the suite instead of leaking a key.
4. As a maintainer, the fix stays scoped to test files, so neutrality counts and i18n stay untouched.

## Slices

**S01 `hermetic-yaml-isolation` (tier 3).** The classroom media test and the capability force-off route test intercept `server-providers.yml` in their fs mocks (`yamlOverride` fixture, copied from `tests/server/provider-config.test.ts:82-99`). Both files also clear inherited provider-shaped env (`*_API_KEY`, `*_BASE_URL`, `*_MODELS`, `*_ENABLED`) at module top, before their own stubs set what they need (env vector, round-1 verifier proof). No host-machine or runner-injected key can enter the pipeline. Orchestrator-side practice: gate-running rivr commands start from a neutral cwd (defense in depth).

**S02 `redaction-guard` (tier 2).** A hermetic guard test in `classroom-media-generation.test.ts` proves the property with a paired assertion (recipe in Implementation Decisions). Blocked by S01.

**S03 `audio-suite-scalars` (tier 2, operator Q1 extension).** One whole-init matcher site (`qwen-voice-clone.test.ts:141,238`) converts to scalar reads. Four sibling files (`lemonade-tts`, `lemonade-asr`, `funasr-asr`, `doubao-tts`) carry partial matchers or destructured reads with test-literal keys; they convert for hygiene so the idiom is uniform. Blocked by S02 (same assertion idiom, one lesson applied once).

### Proposed gates

S01 (3 gates, one integration):
- G01 `npx vitest run tests/server/classroom-media-generation.test.ts tests/server/capability-force-off-routes.test.ts` expect `passed`
- G02 (integration) `npx vitest run` full suite WITHOUT the batch-001 `--exclude`, expect `passed` — this gate is the exclusion-retirement proof
- G03 `npx vitest run tests/providers/provider-neutrality-guard.test.ts` expect `passed`

S02 (2 gates):
- G01 guard test by exact name (byte-pinned at ledger build), expect `passed`
- G02 `npx vitest run tests/server/classroom-media-generation.test.ts` expect `passed`

S03 (2 gates):
- G01 `npx vitest run tests/audio` expect `passed`
- G02 `! grep -rqF "mock.calls[0][1]).toMatchObject" tests/audio && echo AUDIO_SCALARS_OK` expect `AUDIO_SCALARS_OK` (canary for the whole-init idiom; reviewer C2 note: it proves the one dangerous site is gone, not the four hygiene conversions, which G01's suite run covers)

## Implementation Decisions

- Copy the `readFileSync`/`existsSync` interception shape from `provider-config.test.ts:82-99` exactly; keep existing env stubs and module mocks.
- Guard test recipe, proven by reviewer micro-experiment: a caught `AssertionError` from `expect(spy).not.toHaveBeenCalled()` embeds the full serialized call args, including `Authorization: "Bearer <key>"`, in `err.message`. The guard runs a paired check with fixture key `sk-LIVE-FIXTURE-9876543210`: (1) sensitivity leg - deliberately fail a whole-init matcher, catch the message, assert it DOES contain the fixture key (proves capture works); (2) fixed leg - fail a scalar assertion on a non-secret field (`redirect` or `method`), catch, assert the message does NOT contain the fixture key. The pair proves capture and closure. Scalar assertions never target the Authorization header itself, since that would print the secret by design.
- The prior draft cited `qwen-voice-route.test.ts:141,238`; that was a phantom (reviewer B1: file is 172 lines, has no init matcher). The real whole-init site is `tests/audio/qwen-voice-clone.test.ts:141,238`, fixed under S03. Class A server sites are two: classroom `:137` and capability-force-off `:301`.
- Guard test lives in `classroom-media-generation.test.ts` inside the existing describe block, as a named helper plus a test; the helper is a real outline symbol for the ledger.
- No sanitizer exists. Hermeticity plus scalar assertions keep live material out of output entirely (operator Q2a). The repo's only redactor (`personal-history-tools.ts:107-119`) stays private and untouched.

## Testing Decisions

- The guard uses fixture key `sk-LIVE-FIXTURE-9876543210` and asserts the value is absent from captured failure text. If the fixture key ever reaches output, the guard fails.
- Existing 8 tests stay hermetic. No live gate. `TEST_LOAD_LOCAL_ENV` is never set. Zero vendor spend.
- Ledger discipline from batches 001-004: symbol expectations at anchor creation; `yamlOverride` (variable, new, after-exists true, quality INSPECTED) in both files; guard helper (function, new); literal oracles; cwd repo root; tier depth honored; whole-branch `pnpm exec prettier --write <explicit list>` before marking (batch-004 lesson).
- Round-1 expectation updates (correction): S01 = both suites green with hostile YAML present AND with live-shaped provider env injected (runner-equivalent). S02 = classroom file green under injected env in addition to the paired guard legs.

## Out of Scope

- No product code changes under `lib/`.
- No neutrality-debt table edit. Batch 005 touches no neutral file. (The meta's `qwen: 20` line is stale prose versus the live `24`; the research update fixes the prose.)
- No batch-001 closed-ledger gate-text edit. That ledger is history; the 005 G02 proves retirement (see open questions).
- The batch fixes the two Class A server sites plus the five Class C `tests/audio` sites (operator Q1 extension). Nothing in the swept class is left unfixed. (Class C detail: one live-capable whole-init site, four hygiene sites.)

## Further Notes

- The batch-001 ledger carries the exclusion in gate G5.1 at `001-qwen-token-plan-tts.ledger.json:650`. Closed ledger text is historical evidence and is not rewritten (operator Q3a).
- Batch 006 is unaffected: it touches `app/api/transcription/route.ts`, a neutral file, with its own debt entry.

Status: Implemented (batch 005, commits `fef5af9a..0cab7d59` on `feat/media-test-redaction`). Post-implementation learnings below.

## Research update (post-implementation)

**What shipped.** `tests/server/classroom-media-generation.test.ts` and `tests/server/capability-force-off-routes.test.ts` gained two hermeticity layers: a module-top delete loop clearing every inherited `*_API_KEY` / `*_BASE_URL` / `*_MODELS` / `*_ENABLED` variable (14 cleared from this machine's runner snapshot), and the `yamlOverride` fs interception from the plan. A paired guard test named `guard: fixture key ...` now proves capture-then-closure with the literal fixture `sk-LIVE-FIXTURE-9876543210`. `tests/audio/qwen-voice-clone.test.ts:141` and `:238` became scalar field reads. The whole-init idiom is dead in `tests/audio` (canary `AUDIO_SCALARS_OK`). The batch-001 exclusion is retired: the full suite passes with no `--exclude`.

**The spec's premise was incomplete, in a good way.** The plan pinned the YAML vector. Round-1 verification reproduced a second, stronger vector: the compiled bun gate runner loads `.env.local` into gate children, and under that env the classroom suite really called happyhorse and serialized a live Bearer header in a gate failure. Same leak class, different door. The correction (commit `76cba659`) grew S01/S02 scope to env-vector hermeticity, and the fix round closed both vectors. The YAML canary and the bun-spawn hostile reproduction now both run green with zero `sk-` hits.

**G03 env semantics, decided by the orchestrator.** Under the hostile runner env, G03 fails on nine pre-existing, env-shaped tests in six files outside the batch (agent-runtime registrations, provider-config, qwen-voice-route). Those files legitimately assume the repo's documented hermetic vitest. The gate therefore executes with the rivr process started from a neutral cwd (gates pin repo root via their `cwd` field), which matches `pnpm test` exactly. Hostile-env coverage stays on the two suites the batch owns. Recorded here so the choice is not mistaken for a weakening.

**Ledger mechanics.** Six symbol anchors with per-symbol expectations at creation (the batch-003 lesson) held; no accept-time backfill was needed. Two function postconditions (`slideScene`, `pcmWav`) stayed kind-only because capture reports an empty signature for them, so diff keeps the known cosmetic signature artifact; bodies proved byte-identical to `main`. Citations drift again: the spec's `:137` force-disabled assertion lives at `:204`, and the fs-mock precedent is `tests/providers/provider-config.test.ts` while the interception pattern first shipped in `tests/server/provider-config.test.ts`.

**Verification trail.** Round 1: S03 verified; S01/S02 rejected for the env vector (audited, reproduced via `spawnSync` under bun, trigger isolated to `VIDEO_HAPPYHORSE_*`). Round 2: hostile reproduction green; S02 verified; S01's G03 hit the env-semantics question. Round 3: S01 rejected on G03 definition only (code fix confirmed effective). Final round after the orchestrator decision: S01 verified first attempt, chain 40 entries, retry 3/5 with the cause change resetting the escalation counter.

**Test totals.** Classroom file 9/9 (incl. guard), force-off 10/10, tests/audio 267/267, full suite 7237 passing hermetic, tsc and prettier clean whole-branch.
