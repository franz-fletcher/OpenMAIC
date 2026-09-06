# Batch 020 spec soundness review

Reviewer: independent spec-soundness reviewer. The reviewer did not write the
spec. Probes and gate dry-runs ran on 2026-09-07 against the working tree at
HEAD `3d34d87a` on `main`.

Reviewed documents:

- `docs/specs/020-rbac-followups.md` (draft, the follow-up batch).
- Certified predecessors for anchors: `docs/specs/017`, `docs/specs/018`,
  `docs/specs/019`. Prior reviews `docs/research/017-spec-soundness-review.md`,
  `docs/research/018-spec-soundness-review.md`, and
  `docs/research/019-spec-soundness-review.md` for shape and doctrine.
- `docs/meta-specs/rbac-minimal-mode.md` (i18n parity rule, gate marker rule,
  Safari checkpoint rule).
- Live sources probed: `tests/agent-runtime/runner-skills-registration.test.ts`,
  `tests/agent-runtime/runner-wakeup.test.ts`,
  `tests/agent-runtime/runner-web-search-registration.test.ts`,
  `tests/agent-runtime/runner-voice-registration.test.ts`,
  `tests/agent-runtime/web-search.test.ts`,
  `tests/minimal-mode/minimal-layout.test.ts`,
  `tests/branding/header-capsule.test.ts`,
  `tests/lint-llm-entry-guard.test.ts`, `lib/server/agent-runtime/runner.ts`,
  `lib/server/agent-runtime/web-search.ts`, `lib/server/provider-config.ts`,
  `lib/server/web-search-config.ts`, `components/admin/users-section.tsx`,
  `components/admin/roles-section.tsx`, `components/header-capsule.tsx`,
  `components/account-zone.tsx`, `app/page.tsx`,
  `lib/i18n/locales/en-US.json`, `scripts/check-i18n-keys.mjs`,
  `package.json`, `.gitignore`, `node_modules/better-auth`, and the
  `node_modules/.bin` directory.

Method: file-to-line existence checks against live source, symbol signature
comparisons, env-prefix byte comparison against the 017 canonical gate text, a
live `.env` and operator-file state probe, and full dry-runs of the three unit
gates from the repo root with the exact command text (presented below). The S1
dry-run executed the exact two-run command on the exact machine the spec
describes, with `TAVILY_API_KEY` and `BRAVE_SEARCH_API_KEY` exported and no
`server-providers.yml` present. The file was absent, so nothing was truncated,
restored, or damaged. Only this file was created.

## Verdict

**Approve-after-fixes.** One blocker. B1 is the two-run gate oracle: the
marker depends on the second run's exit only, so the exact command echoes
`RUNNER_HERMETIC_OK` on today's tree even though run A fails exactly as the
spec diagnoses. The central proof of S1 cannot go red. Everything else holds.
The contract cites check out, the assumptions hold, the sibling suites are
hermetic, the i18n and neutrality rules are satisfied, and the deleted file is
safe to delete. The S3 layout gate is green today and stays green, so its
claimed pre-fix failure is also false, and the spec must say what that gate
actually proves.

## BLOCKERS

### B1. RUNNER_HERMETIC_OK fires while run A fails. The two-run gate cannot go red.

The S1 gate as written captures the exit of the SECOND run only, and run A's
failure is consumed by the `&&` chain that guards the yaml backup. The exact
command text is:

```
pnpm test <4 suites> && { test -f server-providers.yml && cp ... && echo '' > server-providers.yml; };
unset <web-search env>;
pnpm test <4 suites>; RC=$?;
{ test -f /tmp/skills-gate-020.yml && cp ... server-providers.yml && rm -f ...; };
test $RC -eq 0 && echo RUNNER_HERMETIC_OK
```

`RC` is the exit of the second `pnpm test` only. Nothing carries run A's exit
into the marker. The spec claims "the marker fires only when both runs exit 0"
(`020:141`). The command does not implement that claim.

The dry-run proves the consequence. On this machine, run A failed exactly as
the spec's before-state predicts: the skills suite asserts the exact tool
array at `runner-skills-registration.test.ts:255:52` and received
`web_search` inserted after `ask_user` (the resolver found the tavily
capability from the exported `TAVILY_API_KEY`). Run B then ran with the
web-search env cleared, all four suites passed, `RC` was 0, and
`RUNNER_HERMETIC_OK` echoed. The gate is green on the buggy tree. Pre-fix RED
is the expectation the spec sets for the machine it names, and the command
does not deliver it.

Two more consequences follow from the same shape:

- On a machine where `server-providers.yml` exists, run A's failure skips the
  emptiness step (`&&` short-circuits), so run B tests the config-present
  state with the env cleared. The "emptied yaml" leg runs only when run A
  succeeds, which is the post-fix state. The emptied-config acceptance from
  user story 2 is never exercised by the leg that fails pre-fix.
- `RC` collapses the proof to "run B must pass with the env cleared". Run A
  could be red, green, or broken and the marker still fires whenever run B
  passes.

Fix, two sentences: capture both exits and empty the yaml between the runs
unconditionally.

```
pnpm test <4 suites>; A=$?;
{ test -f server-providers.yml && cp server-providers.yml /tmp/skills-gate-020.yml && echo '' > server-providers.yml; };
unset <web-search env>;
pnpm test <4 suites>; B=$?;
{ test -f /tmp/skills-gate-020.yml && cp /tmp/skills-gate-020.yml server-providers.yml && rm -f /tmp/skills-gate-020.yml; };
test $A -eq 0 && test $B -eq 0 && echo RUNNER_HERMETIC_OK
```

With that shape, pre-fix run A fails with the env present and the marker
stays silent. Post-fix both runs pass and the marker fires. The emptify step
runs on both paths, so the emptied leg is real whenever a yaml exists.

## CONCERNS

### C1. The S3 layout gate is green today. The spec's "fails with no marker until it lands" claim is false.

Dry-run of the exact S3 gate: `unset <8 vars>; pnpm test
tests/minimal-mode/minimal-layout.test.ts tests/branding/header-capsule.test.ts
&& echo LAYOUT_OK` exits 0 today. Both suites pass (16 tests), and
`LAYOUT_OK` echoes. The Testing Decisions claim "the layout gate fails with
no marker until it lands" (`020:330-331`) is wrong for the current tree.

The new gear describe cannot change that. It renders `HeaderCapsule` directly
with `settingsGated` passed explicitly (per the binding at `020:208`). The
component already implements the gate at `header-capsule.tsx:131`, so every
gear assertion passes before the S3 delta lands. The suite never renders
`HomePage` (its own header note says so), so it cannot observe the actual
delta, the `settingsGated={minimalMode}` pass-through at `app/page.tsx`.
The gate is a regression guard for the capsule family, not a RED oracle for
the page wiring.

The behavioral proof lives elsewhere and is real. `tsc` covers the prop
shape, the Safari checkpoint drives the flag-on states, and the branding
suite pins the flag-off gear. State that role in the gate note. One sentence:
"LAYOUT_OK is a regression gate, green pre-fix by design; the S3 delta is
proven by tsc and the Safari flag-on checkpoint."

### C2. The yaml restore is guarded but not atomic. A kill inside run B strands the operator file empty.

The emptify block copies the file to `/tmp/skills-gate-020.yml` before
truncating, and the restore runs after run B on both paths. The observed gate
runtime is about five seconds total, so the exposure window is small. A kill
or Ctrl-C in that window leaves the operator file truncated with its only
copy in `/tmp`, an ephemeral location. The spec documents this and instructs
the verifier to check the stale `/tmp` file (`020:371-375`), so the content is
recoverable, but the operator file is still truncated in place and the
restore can also be interrupted mid-copy. This is guarded, not unguarded, so
it is a concern rather than a blocker. One hardening sentence: pin a
`trap`-based restore in the gate, or cover the verifier's kill path
explicitly in the gate text.

### C3. The inert truncation guard makes pre-fix B vacuous on env-only machines.

On this machine there is no `server-providers.yml`, so the "present and
emptied" pair collapses to "env present" and "env absent". The spec should
state what each leg proves on an env-only machine: run A proves the mock
removes the env dependence, run B proves the cleared surface discovers no
capability. The `mv`-free design is fine. The claim "the yaml is restored
either way" (`020:141`) is accurate, but only when a yaml exists. One
sentence.

### C4. The `.gitignore` cite is one line off.

`server-providers.yml` sits at `.gitignore:53` and `server-providers-*.yml`
at `:54`. The spec cites `:54-55`. Not ledger-binding, but it costs a capture
round if read literally.

## Open questions answered

### 1. GATE. Does the RUNNER_HERMETIC_OK command run today, and does it go red pre-fix?

It runs, and it goes green. The exact command was executed on 2026-09-07 with
`TAVILY_API_KEY` and `BRAVE_SEARCH_API_KEY` in the shell and no
`server-providers.yml` on disk. Run A failed at
`runner-skills-registration.test.ts:255:52` with the received array
`['ask_user', 'web_search', ...]` against the expected list that starts
`ask_user, create_skill`. That is the exact before-state the spec names
(`020:120-122`). Run B passed with the web-search env cleared, `RC` was 0,
and the marker echoed. The failure inside run A proves the diagnosis and the
remedy is real. The marker firing over a red run A proves the oracle bug in
B1. The command text also shares the canonical 016 env prefix: the 8-variable
`unset` matches `docs/specs/017-publishing-visibility.md:86` byte for byte,
and the second `unset` covers the five env-driven web-search providers in the
order the resolver's `WEB_SEARCH_ENV_MAP` registers them.

### 2. CONTRACT. Do the cited lines and symbols exist?

Yes. Every cited contract point was checked against live source.

- `runner-skills-registration.test.ts:46-106` mocks the store, persistence
  provider, session materials, entry tree, driver model, stream function,
  `buildAgent`, and the user-skill store, and no web-search mock. Exact.
  The `:255` assertion is the exact-list tool array, and `:293` the sorted
  allowlist. Exact.
- `runner-wakeup.test.ts:134-136` is exactly
  `vi.mock('@/lib/server/agent-runtime/web-search', () => ({ resolveWebSearchCapability: () => null }))`.
  The S1 mock mirrors it.
- `runner-web-search-registration.test.ts:86-92` mocks the resolver with an
  `importActual` spread and a `mocks.resolveWebSearchCapability` override, so
  the sibling is hermetic as shipped. `runner-voice-registration.test.ts:86-91`
  does the same. `web-search.test.ts:24,35,60` imports and drives the REAL
  resolver and stays unmocked. All exact.
- `runner.ts:1389` is `const search = resolveWebSearchCapability();`, reached
  through the module import at `runner.ts:64`. `assembleRunnerTools` receives
  `[askUserTool]` then `webSearchTools` (`runner.ts:1532-1534`), so
  `web_search` lands after `ask_user`, matching the observed failure diff.
- `users-section.tsx:51` and `:54` are the two `'Failed to load users'`
  literals, `:33` the `useI18n()` destructure. Exact.
  `roles-section.tsx:57` and `:60` are the two `'Failed to load roles'`
  literals, `:31` the destructure. Exact.
- `header-capsule.tsx:26-38` ships `settingsGated?: boolean` at `:38`, `:131`
  is `{(!settingsGated || can('settings.manage')) && ...}`, and `:41-47` the
  internal flag computation. Exact. `account-zone.tsx:58` is the
  `can('settings.manage')` gate. Exact.
- `app/page.tsx:139` is `const minimalMode = isMinimalModeClientEnabled();`,
  and the `HeaderCapsule` call spans `:741-749` with no `settingsGated` prop.
  Exact.
- `minimal-layout.test.ts:118-119` mocks `lucide-react` with
  `Settings: () => 'SETTINGS_ICON'`, and the capsule describe renders
  `HeaderCapsule` with `{ onSettingsOpen: vi.fn() }` only, covering the Pro
  toggle. Exact. `tests/branding/header-capsule.test.ts` exists, renders
  without `settingsGated`, and asserts `lucide-settings` at `:72`.
- `provider-config.ts:134-144` is `WEB_SEARCH_ENV_MAP`, the yaml load path is
  `loadYamlFile` around `:208`, `DEFAULT_FILENAME = 'server-providers.yml'`
  around `:354`, and the gitignore entry sits one line above the cited
  range. Exact apart from C4.
- `docs/specs/018-admin-suite.md:785-788` is the `settingsGated` follow-on
  note that closes with "Batch F may revisit the gear". Exact.

### 3. ASSUMPTIONS. Do the mocks collide, is the sibling hermetic, does the proof hold without env, and is the file deletion safe?

No collision with the lint guard. `tests/lint-llm-entry-guard.test.ts` lints
its own in-memory fixtures against the guarded package paths, test paths are
exempt (`tests/probe`), and S1 changes no import boundary and no eslint rule.
The matrix cannot see a `vi.mock` call in a test file.

The sibling is hermetic. `runner-web-search-registration.test.ts:86-92` mocks
the resolver, and `web-search.test.ts` intentionally tests the real one.
Every spec claim in the same-family audit (`020:264-271`) matches the live
suites.

The proof survives a no-env machine. Post-fix the mock replaces the capability
source, so both legs pass whether the operator config is empty, present, or
absent. The second run cannot fail "for the opposite reason" because the mock
is environment-independent. On a machine with no capability at all, the gate
is green before and after the fix, which is the fixed-behavior state anyway.
The RED demonstration belongs to the env-capable machine, and only the B1 fix
makes that RED trustworthy. The `.env.local` hermeticity note holds: root
vitest does not load `.env.local`, and the gate children inherit it, which is
why the canonical `unset` prefix stays on every gate, per the meta-spec rule.

The deletion is safe. `auth.config.mjs` is untracked (`git status`), absent
from git history (`git log -- auth.config.mjs` is empty), referenced by no
script and no config, and better-auth is wired explicitly through
`lib/auth/server.ts`. The installed `better-auth@1.7.2` ships no CLI (nothing
under `node_modules/.bin`), and the separate `@better-auth/cli` package is
not installed, so no tooling in this repo auto-discovers a root
`auth.config.mjs`.

### 4. SUITE. Are the baseline, the i18n keys, the neutrality, and the flag-off parity consistent?

The baseline record is consistent. The doctrine lines cite real text:
`013-implementation-diagnosis.md:22` names `runner-skills-registration.test.ts:255`,
`017:618` records "7766 tests with 1 tolerated failure", `018:775` records
"7863 tests with 1 tolerated failure", and `019:751` records "7933 tests
with 1 tolerated failure". The dry-run confirms the single failure is the
exact-array assertion and that the other three family suites pass today, so
"100 percent green" after S1 is a coherent claim for the verifier to record.

The i18n keys obey the no-array rule. `scripts/check-i18n-keys.mjs` throws on
any array value and on empty objects, and requires leaf-key parity across the
12 locale files. `admin.users.loadFailed` and `admin.roles.loadFailed` are
string leaves. The en-US groups carry 17 and 32 keys respectively, no
`loadFailed` among them, and today's parity check passes, which matches the
before-state notes exactly.

Provider neutrality holds. The new key values contain no vendor vocabulary,
the identifiers carry no "token" or "plan" substring, and no slice touches a
file on `PROVIDER_NEUTRAL_FILES`. The slices edit test files, locale files,
docs, two admin sections, `app/page.tsx`, and a component. The neutrality
guard stays satisfied.

The flag-off byte-identical claim holds. Flag off passes `false`, and the
render condition treats `false` and `undefined` identically at
`header-capsule.tsx:131`. A prop is not DOM. The branding suite renders
without the prop and keeps its gear assertion, so it stays green without
edits.

## VERIFIED-OK

- The S1 remedy is minimal and proven by the dry-run diff: mocking the
  resolver at the module boundary removes `web_search` from the received
  array and leaves the other five skills tests untouched. The mock factory
  form the spec pins is the proven runner-wakeup form, which passed today
  with the env present in run A.
- Env-prefix discipline: the three gates share the canonical 8-variable list
  byte for byte, and the S3 note on `NEXT_PUBLIC_MINIMAL_MODE` matches how
  the layout family drives the flag per test.
- Tier counts: S1 tier 2 with 2 gates, S2 tier 1 with 2 gates, S3 tier 2 with
  2 gates. No tier-3 or tier-4 tag requirement applies.
- Gate markers are short literals under the expectation cap.
- The five doctrine records S1 touches are real targets with prose-only
  planned edits, consistent with the PIN-FROM-OUTLINE rule.

## Could not verify

- The fixture of the unwritten gear describe block. Its pre-fix behavior is
  inferred from the suite structure, which renders the capsule directly and
  cannot observe the page pass-through. That inference drives C1.
- The post-fix full-baseline count. The verifier records the actual number at
  verification time.
- The Safari flag-on checkpoint. It is a manual step before certification,
  per the meta-spec.
- The exact behavior of run B on a machine where `server-providers.yml`
  contains a web-search provider. The dry-run machine has no yaml, so run B
  there is the env-cleared leg, not the emptied-yaml leg.