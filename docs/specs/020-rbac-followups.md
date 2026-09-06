# Batch 020 spec: rbac-followups

Spec status: approved

## Problem Statement

The RBAC program shipped seven certified batches, 013 through 019. Three owed
items remain open after certification. Each one is small, each one has a
precise location, and each one keeps the baseline below 100 percent green.

- The runner-skills registration suite carries the ONLY tolerated failure in
  every suite run since batch A. The test asserts an exact tool array without
  `web_search` (`tests/agent-runtime/runner-skills-registration.test.ts:255`),
  but the runner registers `web_search` whenever the operator config has a
  usable web-search backend. On this machine the shell exports
  `TAVILY_API_KEY` and `BRAVE_SEARCH_API_KEY`, so the resolver returns a
  capability and the exact-list assertion fails. The root cause is
  environmental, not behavioral: the suite pins registration logic, and that
  logic is correct. The doctrine record lives at
  `docs/research/013-implementation-diagnosis.md:22`, and three batch research
  updates repeat the "1 tolerated failure" line (`docs/specs/017-publishing-visibility.md:618`,
  `docs/specs/018-admin-suite.md:775`, `docs/specs/019-role-permission-editor.md:751`).
- Four raw English fallback strings leak into the admin UI. The users section
  falls back to `'Failed to load users'` at
  `components/admin/users-section.tsx:51` and `:54`. The roles section falls
  back to `'Failed to load roles'` at
  `components/admin/roles-section.tsx:57` and `:60`. Both sections list no
  `loadFailed` key in their i18n groups
  (`lib/i18n/locales/en-US.json`, `admin.users` and `admin.roles`), so the
  strings bypass the 12-locale parity contract. A stray untracked
  `auth.config.mjs` also sits at the repo root holding a hardcoded test
  secret, with zero references anywhere in the tree.
- The settings gear ignores the flag. `HeaderCapsule` accepts `settingsGated`
  (`components/header-capsule.tsx:34-38`) and renders the gear only when
  `!settingsGated || can('settings.manage')` (`components/header-capsule.tsx:131`),
  but `app/page.tsx:741-749` never passes the prop, so the gear stays visible
  to every rank under `MINIMAL_MODE`. Batch E recorded this as a follow-on
  (`docs/specs/018-admin-suite.md:785-788`). The account zone already gates
  the same surface with `can('settings.manage')`
  (`components/account-zone.tsx:58`), so the gear is the single ungated door.

## Solution

Batch 020 closes the three items in three slices, one per program rule.

S1 makes the runner-skills registration suite hermetic. The test mocks the
web-search capability resolver so the tool array is deterministic no matter
what the operator config holds. The same fix style already ships in the
sibling suites, so S1 aligns the family, closes the tolerated-failure
doctrine, and restores the baseline to 100 percent green.

S2 replaces the four English fallbacks with i18n keys across all 12 locales,
then deletes the stray `auth.config.mjs`. The admin users and roles groups
gain one key each, the parity check passes, and a component grep returns zero.

S3 wires the flag through the client composition. The home page passes
`settingsGated` from its own `minimalMode` value, so the gear hides for
principals without `settings.manage` under the flag and stays byte-identical
when the flag is off. The existing minimal-layout test family gains gear
assertions, and Safari verifies the flag-on states.

## User Stories

1. As a verifier, I want the runner-skills registration suite to pass on any
   machine regardless of the operator provider config, so that the suite pins
   registration logic and nothing else.
2. As an operator, I want the local `server-providers.yml` present and emptied
   to produce the same test result, so that a local config can never invent a
   failure.
3. As a learner, I want the admin error copy to read through an i18n key, so
   that every locale shows translated text instead of English fallbacks.
4. As an operator, I want no stray config file with a hardcoded secret at the
   repo root, so that accidental secret shipping is impossible.
5. As a guest or anonymous visitor under `MINIMAL_MODE`, I want no settings
   gear in the header, so that the flag hides the administrator door from
   ranks that cannot use it.
6. As an administrator under `MINIMAL_MODE`, I want the gear visible and the
   settings dialog openable, so that the surface stays reachable where it is
   permitted.
7. As an operator with the flag off, I want the header byte-identical to
   today, so that the follow-on changes nothing for flag-off deployments.

## Slices

Each slice lists the ledger bindings, before-state notes, postcondition, and
gate inventory. The env-clear prefix is the 016 canonical list, copied
verbatim. The PIN-FROM-OUTLINE rule binds: plan-time signatures below are
prose, and the builder replaces every pinned string with the byte-exact
outline text after implementation. Unchanged contract symbols pin from the
current outline truth.

### S1 Hermetic runner-skills registration

Delivers: the deterministic capability mock in the runner-skills suite, the
same-family audit, and the retirement of the tolerated-failure doctrine across
the four records that carry it.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `tests/agent-runtime/runner-skills-registration.test.ts` | file | gains a `vi.mock` of `@/lib/server/agent-runtime/web-search` returning `resolveWebSearchCapability: () => null`, mirroring the runner-wakeup pattern | modified: the suite runs with a deterministic no-web-search toolset, so the asserted tool array and allowlist hold on any operator config |
| `docs/research/013-implementation-diagnosis.md` | file | item 5 gains a resolution note naming batch 020 | modified: the tolerated-failure record closes with the fix and the two-run proof |
| `docs/specs/017-publishing-visibility.md` | file | the "1 tolerated failure" line gains a one-line resolution pointer to batch 020 | modified: historical run result stays, the follow-up closure is recorded |
| `docs/specs/018-admin-suite.md` | file | the "1 tolerated failure" line gains a one-line resolution pointer to batch 020 | modified: historical run result stays, the follow-up closure is recorded |
| `docs/specs/019-role-permission-editor.md` | file | the "1 tolerated failure" line gains a one-line resolution pointer to batch 020 | modified: historical run result stays, the follow-up closure is recorded |
| `lib/server/agent-runtime/web-search.ts::resolveWebSearchCapability` | function | `(): WebSearchCapability \| null` | contract symbol, unchanged: the resolver S1 mocks at the module boundary |
| `tests/agent-runtime/runner-wakeup.test.ts` | file | hermetic web-search mock already present | contract symbol, unchanged: the mock pattern S1 copies |

Before-state capture notes: `runner-skills-registration.test.ts` mocks the
store, the persistence provider, session materials, the entry tree, the
driver model, the stream function, `buildAgent`, and the user-skill store
(`:46-106`), but it never mocks `@/lib/server/agent-runtime/web-search`, so
`runSession` reaches the real `resolveWebSearchCapability()` through
`lib/server/agent-runtime/runner.ts:1389`. The resolver reads live operator
config through `resolveClassroomWebSearchConfig({})`
(`lib/server/web-search-config.ts:55-74`), which merges env vars via
`WEB_SEARCH_ENV_MAP` (`lib/server/provider-config.ts:134-144`) and the yaml
file loaded at `lib/server/provider-config.ts:208` from `server-providers.yml`
(`:354`, gitignored at `.gitignore:53-54`). On this machine the shell exports
`TAVILY_API_KEY` and `BRAVE_SEARCH_API_KEY`, so the capability resolves to
tavily and the array assertion at `:255` fails with `web_search` inserted
after `ask_user`. The hermetic mock pattern already ships in
`tests/agent-runtime/runner-wakeup.test.ts:134-136`, in
`tests/agent-runtime/runner-web-search-registration.test.ts:86-92`, and in
`tests/agent-runtime/runner-voice-registration.test.ts:86-91`. The web-search
unit suite `tests/agent-runtime/web-search.test.ts` tests the real resolver
intentionally and stays unmocked.

Postcondition: the suite passes with the operator config present AND with it
emptied, because the mock replaces the capability source entirely. The full
baseline runs 100 percent green with zero tolerated failures, and the four
doctrine records point at batch 020. The `lint-llm-entry-guard.test.ts`
matrix is untouched.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/agent-runtime/runner-skills-registration.test.ts tests/agent-runtime/runner-web-search-registration.test.ts tests/agent-runtime/runner-voice-registration.test.ts tests/agent-runtime/runner-wakeup.test.ts; A=$?; { test -f server-providers.yml && cp server-providers.yml /tmp/skills-gate-020.yml && echo '' > server-providers.yml; }; unset TAVILY_API_KEY BRAVE_SEARCH_API_KEY WEB_SEARCH_CLAUDE_API_KEY WEB_SEARCH_CLAUDE_BASE_URL WEB_SEARCH_CLAUDE_MODELS WEB_SEARCH_MINIMAX_API_KEY WEB_SEARCH_MINIMAX_BASE_URL WEB_SEARCH_DOUBAO_API_KEY WEB_SEARCH_DOUBAO_BASE_URL; pnpm test tests/agent-runtime/runner-skills-registration.test.ts tests/agent-runtime/runner-web-search-registration.test.ts tests/agent-runtime/runner-voice-registration.test.ts tests/agent-runtime/runner-wakeup.test.ts; B=$?; { test -f /tmp/skills-gate-020.yml && cp /tmp/skills-gate-020.yml server-providers.yml && rm -f /tmp/skills-gate-020.yml; }; test $A -eq 0 && test $B -eq 0 && echo RUNNER_HERMETIC_OK` expects `RUNNER_HERMETIC_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 2. The gate runs the family twice in one command, once with the operator config in place and once with the yaml emptied and the web-search env cleared, and the marker fires only when both runs exit 0. Run A and run B each drive the four registration and wakeup suites that execute the real runner capability path: skills, web-search, voice, and wakeup. The yaml is restored either way. On an env-only machine run A proves the mock removes the env dependence and run B proves the cleared env surface, which the unset list covers, discovers no capability; on a yaml machine the same pair proves that a present-and-emptied operator file produces identical run results. The skills, voice, and wakeup suites already mock the capability at the module boundary, so run A and run B assert identical results and the gate proves no path reads live operator config hermetically wrong anymore.

### S2 i18n strays and repo hygiene

Delivers: the two new admin error keys across all 12 locales, the four
component fallback swaps, and the deletion of the stray root config file.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/i18n/locales/en-US.json` | file | `admin.users.loadFailed` gains value `"Failed to load users"`, `admin.roles.loadFailed` gains value `"Failed to load roles"` | modified: source-of-truth keys for the admin error fallbacks |
| `lib/i18n/locales/ar-SA.json` | file | `admin.users.loadFailed` and `admin.roles.loadFailed` gain a translated value | modified: 12-locale parity |
| `lib/i18n/locales/de-DE.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/es-MX.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/fr-FR.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/ja-JP.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/ko-KR.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/pt-BR.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/ru-RU.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/vi-VN.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/zh-CN.json` | file | same | modified: 12-locale parity |
| `lib/i18n/locales/zh-TW.json` | file | same | modified: 12-locale parity |
| `components/admin/users-section.tsx::UsersSection` | function | `()` | modified: the two `'Failed to load users'` literals at `:51` and `:54` become `t('admin.users.loadFailed')`, signature unchanged |
| `components/admin/roles-section.tsx::RolesSection` | function | `()` | modified: the two `'Failed to load roles'` literals at `:57` and `:60` become `t('admin.roles.loadFailed')`, signature unchanged |
| `auth.config.mjs` | file | deleted | removed: the stray untracked root config with the hardcoded `test-secret-for-schema-gen` value (currently `auth.config.mjs`, untracked per `git status`) |

Before-state capture notes: the users group carries 17 keys and the roles
group carries 32 keys in every locale file (`lib/i18n/locales/*.json`), none
of them `loadFailed`, and the groups are key-parity clean across all 12
locales. Both components already hold `useI18n()` and destructure `t`
(`components/admin/users-section.tsx:33`, `components/admin/roles-section.tsx:31`).
No test asserts the raw English strings, and the root-level grep for
`auth.config.mjs` returns zero matches across tracked, untracked, and hidden
files (`rg -n "auth\.config\.mjs" --hidden -g '!node_modules' -g '!.git' .`
exits 1 with no output). The file never shipped in git history
(`git log -- auth.config.mjs` is empty). The key-parity checker
(`scripts/check-i18n-keys.mjs`) treats `en-US.json` as the source of truth and
demands identical leaf keys across all locale files, so the two new keys land
in all 12 files in the same change.

Postcondition: `admin.users.loadFailed` and `admin.roles.loadFailed` exist in
all 12 locales with key parity, the four component fallbacks read through
`t(...)`, `pnpm check:i18n-keys` passes, and a grep for the two English
strings across `components/` returns zero. The repo root no longer holds
`auth.config.mjs`.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm check:i18n-keys && ! grep -rn "Failed to load users\|Failed to load roles" components/ && test ! -f auth.config.mjs && echo I18N_OK` expects `I18N_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 1. The gate asserts key parity, zero raw English strings in
`components/`, and the absence of the root config file in one command, and the
marker fires only when all three hold.

### S3 settingsGated gear visibility

Delivers: the flag pass-through from the home page composition, the gear
assertions in the existing minimal-layout family, and the Safari flag-on
proof.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/page.tsx::HomePage` | function | `()` | modified: the `HeaderCapsule` call at `:741-749` gains `settingsGated={minimalMode}`, where `minimalMode` is the already-computed `isMinimalModeClientEnabled()` at `:139`, signature unchanged |
| `tests/minimal-mode/minimal-layout.test.ts` | file | the header capsule describe block gains a gear-visibility describe with a `LAYOUT_OK:` marker, rendering `HeaderCapsule` with `settingsGated` and asserting the `SETTINGS_ICON` mock guard | modified: flag ON without `settings.manage` hides the gear, flag ON with `settings.manage` shows it, flag OFF shows it always |
| `components/header-capsule.tsx::HeaderCapsule` | function | `({ onSettingsOpen, accountSlot, settingsGated }: HeaderCapsuleProps)` | contract symbol, unchanged: the gate logic at `:131` already implements the required behavior, and the props interface at `:26-38` already ships `settingsGated` |
| `components/account-zone.tsx` | file | `can('settings.manage')` gates the settings entry at `:58` | contract symbol, unchanged: the hook path S3 reuses |
| `lib/hooks/use-permissions.ts::usePermissions` | function | `(): PermissionState` | contract symbol, unchanged: the client permission hook already used by both `HeaderCapsule` and `AccountZone` |

Before-state capture notes: `HeaderCapsule` reads `usePermissions()` and
computed `minimalMode = isMinimalModeClientEnabled()` internally
(`components/header-capsule.tsx:41-47`), and the gear render condition sits at
`:131` as `{(!settingsGated || can('settings.manage')) && ...}`. The home page
is a client component (`app/page.tsx:1`) that already imports both
`isMinimalModeClientEnabled` and `usePermissions` (`app/page.tsx:89-91`),
computes `minimalMode` at `:139`, and renders the capsule at `:741-749`
without `settingsGated`. Passing `settingsGated={minimalMode}` makes the flag
the only switch: flag off resolves to `false`, which keeps today's always-visible
gear byte-identical, and flag on resolves to `true`, which forces the
`can('settings.manage')` check. The account menu already hides its settings
entry under the same check (`components/account-zone.tsx:58`), and the
settings route sub-paths are server-guarded, so the gear becomes the last
ungated door and the fix closes it. The minimal-layout family
(`tests/minimal-mode/minimal-layout.test.ts`) renders the real `HeaderCapsule`
through the flag and permission stack, mock `lucide-react` turns `Settings`
into `SETTINGS_ICON`, and the existing capsule describe block covers the Pro
toggle only. The branding markup test (`tests/branding/header-capsule.test.ts`)
renders the capsule without `settingsGated` and asserts the gear is present,
so it stays green without edits.

Postcondition: under `NEXT_PUBLIC_MINIMAL_MODE=true`, a principal without
`settings.manage` sees no gear, and a principal with it sees the gear and
opens the settings dialog. With the flag off, the header renders byte-identical
to today for every rank. The minimal-layout family carries the new gear
assertions with the `LAYOUT_OK:` marker, and the branding markup test still
passes.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/minimal-mode/minimal-layout.test.ts tests/branding/header-capsule.test.ts && echo LAYOUT_OK` expects `LAYOUT_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 2. The layout gate renders the real capsule through the real flag
and permission stacks in the existing minimal-layout family
(`tests/minimal-mode/minimal-layout.test.ts`) and the branding markup family
(`tests/branding/header-capsule.test.ts`), with `settingsGated` exercised
explicitly. The Safari checkpoint runs before certification with the flag on:
an anonymous visitor sees no gear, and an administrator sees the gear and
opens the dialog.

## Implementation Decisions

- The hermetic mock replaces the capability source, not the code under test.
  `runner-skills-registration.test.ts` gains
  `vi.mock('@/lib/server/agent-runtime/web-search', ...)` with
  `resolveWebSearchCapability: () => null`, byte-for-byte the runner-wakeup
  pattern at `tests/agent-runtime/runner-wakeup.test.ts:134-136`. The runner,
  the skill loader, the allowlist builder, and the prompt assembly stay real.
  The test keeps proving the registration logic, and the operator config stops
  deciding the outcome.
- Same-family audit, no sweep. `runner-wakeup`,
  `runner-web-search-registration`, and `runner-voice-registration` already
  mock the capability at the module boundary, so they are hermetic as shipped.
  `runner-contract` builds its own tool groups, `runner-event-order`,
  `runner-tool-call-integrity`, and `runner-tool-timeout-cancel` make no
  toolset or prompt assertions, and the web-search unit suite tests the real
  resolver by design. Only `runner-skills-registration` reads live config
  against an exact-list assertion, so only it changes.
- The doctrine records get resolution notes, not rewrites. Each of the three
  batch research updates keeps its historical run result and gains a one-line
  pointer to batch 020. The 013 diagnosis item 5 gains the closure note. The
  `tests/lint-llm-entry-guard.test.ts` matrix stays untouched, because S1
  changes no import boundary and no eslint rule.
- The gate is a single marker command with an internal two-run proof. The
  first run carries the operator config, the second empties the yaml and
  clears the web-search env surface, the yaml restores either way, and
  `RUNNER_HERMETIC_OK` fires only when both runs pass. This closes the
  "yaml present AND emptied" acceptance in one oracle. The restore protocol is pinned by an explicit POSIX `trap` on the shell's EXIT signal, which copies the backup back into `server-providers.yml` and removes the `/tmp` copy, so an interrupt between the backup and the restore block leaves no truncated operator file.
- The i18n keys follow the existing admin group shape. `admin.users.loadFailed`
  and `admin.roles.loadFailed` land in `en-US.json` first as the source of
  truth, then the same two keys in the other 11 locales in one change, so the
  key-parity checker never sees a partial state
  (`scripts/check-i18n-keys.mjs`).
- The component swap reuses the already-destructured `t`. Both sections hold
  `useI18n()` already, so the swap is two literals per file, signature
  unchanged, and the error path keeps `data.message` precedence exactly as
  today.
- The stray file deletion is verified, not assumed. The root grep returns
  zero matches, `git log` shows no history for the file, and no script or
  config references it. `better-auth` wires through `lib/auth/` explicitly, so
  no convention auto-discovers a root `auth.config.mjs`.
- The gear wiring reuses the page's own flag value. `minimalMode` is already
  computed at `app/page.tsx:139`, so the capsule call gains exactly one prop.
  Flag off passes `false`, which the render condition treats identically to
  `undefined`, so the DOM stays byte-identical today.
- No new env var ships. The flag and the capability come from existing
  surfaces, so `.env.example` is untouched.
- The Safari checkpoint covers the flag-on states only. Flag-off is pinned by
  the layout gate byte-equality, and the i18n swap is pinned by the parity and
  grep gates.

## Testing Decisions

- New or changed coverage lives in place. S1 edits the existing
  `runner-skills-registration.test.ts`, S3 edits the existing
  `tests/minimal-mode/minimal-layout.test.ts` and keeps
  `tests/branding/header-capsule.test.ts` green, and S2 needs no new suite
  because the parity and grep checks prove the contract.
- The env-clear prefix is the 016 canonical list, copied verbatim, on every
  vitest gate. `MINIMAL_MODE` is not set inline for S3 because the layout
  family drives the real `isMinimalModeClientEnabled()` through
  `NEXT_PUBLIC_MINIMAL_MODE` per test, exactly as it does today.
- The hermetic runner family keeps the real code under test. Only the
  capability resolver is mocked at the module boundary, matching the
  established sibling pattern. The web-search unit suite stays unmocked.
- The baseline claim is a full-suite run, not a slice run. After S1 lands, the
  verifier runs `pnpm test` and records the total with zero failures,
  replacing the "1 tolerated failure" line that every batch recorded since
  batch A.
- No pg contract suite is needed. None of the three slices touches a database
  table, a route guard, or a server session.
- The i18n parity check runs wherever copy lands, per the program rule
  (`docs/meta-specs/rbac-minimal-mode.md:229-231`).
- The PIN-FROM-OUTLINE rule binds on every binding above. The plan-time
  signatures are prose, and the builder re-pins byte-exact from machine
  outline text after implementation.
- Plan-time state: `tests/minimal-mode/minimal-layout.test.ts` gains its gear
  describe in S3, and LAYOUT_OK is a regression gate that is green pre-fix by design, with the S3 delta's RED proof carried by the new gear assertions' presence and the Safari flag-on checkpoint.

## Out of Scope

- Any production change to the runner, the skill loader, the web-search
  resolver, or the provider config. S1 changes a test file only.
- Any change to `tests/lint-llm-entry-guard.test.ts` or the eslint boundary
  matrix it pins.
- Deleting or relaxing the `web_search` exact-list assertions in the runner
  family. The assertions are correct. The environment is the leak.
- New admin copy beyond the two error keys. The users and roles groups keep
  their current keys.
- Any new operator env var or `.env.example` change.
- Server-side settings guarding. The settings routes stay under their existing
  server guards and the account zone stays as shipped.
- Any change to the account zone, the settings dialog, or the capsule render
  order. The gear logic already exists and only gains a caller.
- The tower-of-doctorate cleanup of the other 11 locales. Only the two new
  keys land.

## Further Notes

- The program record is `docs/meta-specs/rbac-minimal-mode.md`. Batch 020 is
  the follow-up batch that closes the certified program's owed items. It
  assumes everything 013 through 019 shipped, in particular the admin roles
  section, the `usePermissions` hook, the `settingsGated` prop, and the
  minimal-layout test family.
- The tolerated-failure doctrine ends with this batch. Every suite-run record
  since batch A names `tests/agent-runtime/runner-skills-registration.test.ts:255`
  as the single tolerated failure (`docs/research/013-implementation-diagnosis.md:22`).
  S1 makes the suite deterministic, and the doctrine records gain closure
  notes. The `tests/lint-llm-entry-guard.test.ts` matrix stays untouched and
  no import boundary moves.
- The settingsGated finding is closed as Batch E intended
  (`docs/specs/018-admin-suite.md:785-788`). The gear becomes flag-aware
  without a component change, because the render condition and the prop both
  existed. This batch only supplies the caller.
- The meta-spec requires a Safari visual checkpoint for UI batches
  (`docs/meta-specs/rbac-minimal-mode.md:296-299`). S3 owns it, flag on:
  anonymous sees no gear, administrator sees the gear and opens the dialog.
- The two-run gate is self-restoring. It backs up `server-providers.yml` to
  `/tmp`, empties it for run B, and copies it back on both success and
  failure paths. A shell abort between backup and restore strands the yaml in
  `/tmp/skills-gate-020.yml`, so the verifier checks for that stale file after
  an interrupted gate run.
- Commit convention for this batch: `feat(rbac): ...` for behavior changes and
  `chore(rbac): ...` for the docs and the file removal.