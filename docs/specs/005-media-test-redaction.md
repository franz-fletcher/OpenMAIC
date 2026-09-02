# Batch 005 spec: media-test redaction

Spec status: research

## Problem Statement

The full test suite has one allowed red. `tests/server/classroom-media-generation.test.ts` fails on machines that carry a `server-providers.yml`, and its failure output prints a live bearer key. Batch 001 recorded this as finding F5 and excluded the file from its aggregate gate. Every full-suite run since has excluded the file. The exclusion hides a secret-printing bug, and the key that prints is live operator material.

## Solution

Make the fetch-mocked server tests hermetic against `server-providers.yml`, change assertions so no failure can serialize a header-bearing request init, and add a guard test that proves a live-shaped fixture key never reaches logs or failure output. Retire the batch-001 gate exclusion by passing the full suite without it. All fixes live in `tests/server/`. No file under `lib/`, no neutrality file, no i18n locale changes.

The leak mechanism, reproduced with a sentinel key (temp test, deleted; worktree clean):

1. `classroom-media-generation.test.ts:9-19` mocks only `mkdir`/`writeFile`. The YAML read of `server-providers.yml` reaches real fs (`lib/server/provider-config.ts:559`).
2. `resolveSectionApiKey` (`provider-config.ts:604-612`) returns the YAML key first, so env stubs cannot override a host YAML entry.
3. A host YAML with an enabled image or video provider makes fetch get called anyway. The force-disabled assertion at `:137` (`expect(fetchMock).not.toHaveBeenCalled()`) fails, and vitest serializes the first call, including `Authorization: Bearer <live key>`.

Error taxonomy for spy failures, proven live: `not.toHaveBeenCalled()` and `toHaveBeenCalledWith(...)` print the full init with headers; a failing assertion on a parsed body value prints only that value.

## User Stories

1. As an operator, the classroom media test passes in the full suite on a machine with `server-providers.yml`, so the batch-001 exclusion retires.
2. As an operator, a failing assertion in fetch-mocked server tests prints no `sk-`-style secret.
3. As a maintainer, a hermetic guard test proves the property, so a regression fails the suite instead of leaking a key.
4. As a maintainer, the fix stays scoped to test files, so neutrality counts and i18n stay untouched.

## Slices

**S01 `hermetic-yaml-isolation` (tier 3).** The classroom media test and the capability force-off route test intercept `server-providers.yml` in their fs mocks (`yamlOverride` fixture, copied from `tests/server/provider-config.test.ts:82-99`). No host-machine key can enter the pipeline.

**S02 `redaction-guard` (tier 2).** A hermetic guard test configures a fixture YAML with a live-shaped key, runs a failing path, captures serialized output, and asserts the key is absent. `qwen-voice-route.test.ts:141,238` move from whole-init `toMatchObject` to scalar field reads, so a failure cannot serialize a header-bearing init. Blocked by S01.

### Proposed gates

S01 (3 gates, one integration):
- G01 `npx vitest run tests/server/classroom-media-generation.test.ts tests/server/capability-force-off-routes.test.ts` expect `passed`
- G02 (integration) `npx vitest run` full suite WITHOUT the batch-001 `--exclude`, expect `passed` — this gate is the exclusion-retirement proof
- G03 `npx vitest run tests/providers/provider-neutrality-guard.test.ts` expect `passed`

S02 (2 gates):
- G01 guard test by exact name (byte-pinned at ledger build), expect `passed`
- G02 `npx vitest run tests/server/qwen-voice-route.test.ts` expect `passed`

## Implementation Decisions

- Copy the `readFileSync`/`existsSync` interception shape from `provider-config.test.ts:82-99` exactly; keep existing env stubs and module mocks.
- `qwen-voice-route.test.ts`: `expect((fetchSpy.mock.calls[0][1] as RequestInit).redirect).toBe('error')` at both sites.
- Guard test lives in `classroom-media-generation.test.ts` inside the existing describe block, as a named helper plus a test; the helper is a real outline symbol for the ledger.
- No sanitizer function in product code. Hermeticity plus scalar assertions make live material unable to enter output at all (Reading A). The repo's only redactor (`personal-history-tools.ts:107-119`) stays private and untouched.

## Testing Decisions

- The guard uses fixture key `sk-LIVE-FIXTURE-9876543210` and asserts the value is absent from captured failure text. If the fixture key ever reaches output, the guard fails.
- Existing 8 tests stay hermetic. No live gate. `TEST_LOAD_LOCAL_ENV` is never set. Zero vendor spend.
- Ledger discipline from batches 001-004: symbol expectations at anchor creation; `yamlOverride` (variable, new, after-exists true, quality INSPECTED) in both files; guard helper (function, new); literal oracles; cwd repo root; tier depth honored; whole-branch `pnpm exec prettier --write <explicit list>` before marking (batch-004 lesson).

## Out of Scope

- No product code changes under `lib/`.
- No neutrality-debt table edit. Batch 005 touches no neutral file. (The meta's `qwen: 20` line is stale prose versus the live `24`; the research update fixes the prose.)
- No batch-001 closed-ledger gate-text edit. That ledger is history; the 005 G02 proves retirement (see open questions).
- `tests/audio` Class C sites (same assertion shapes, five files): outside the operator's sweep bound until the operator rules (open question).

## Further Notes

- The batch-001 ledger carries the exclusion in gate G5.1 at `001-qwen-token-plan-tts.ledger.json:650`. Closed ledger text is historical evidence and is not rewritten.
- Batch 006 is unaffected: it touches `app/api/transcription/route.ts`, a neutral file, with its own debt entry.

Status: Draft
