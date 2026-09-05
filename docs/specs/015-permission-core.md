# Batch 015 spec: permission-core

Spec status: closed

## Problem Statement

Batch A certified identity but no capability model. A signed-in user of any
role can call every route, and the UI cannot decide what to show. From the
operator view the consequences are concrete.

- Every LLM route is unaudited by identity today: `app/api/quiz-grade/route.ts`
  (POST handler at the top of the file) calls `callLLM` with no session check.
- The account zone renders a Settings entry at
  `components/account-zone.tsx:108` for every signed-in user, with no
  permission behind it.
- The capability matrix in the program record promises differentiated
  behavior per rank, but nothing enforces it
  (`docs/research/rbac-minimal-mode-decision-round-1.md:72-82`).
- Role assignments live in the database (`roles` and `user_roles`), but no
  permission statement exists to make them meaningful.

Batch B turns role ranks into enforceable capabilities: a fixed permission
catalog, rank-derived defaults, database overrides, a server guard, one
reference adoption, and the client affordance surface.

## Solution

Batch B ships the permission catalog in code, the `can()` helper, a
`role_permissions` override table, a server guard `requirePermission`, one
reference adoption in the quiz-grade route, a client hook, a permission-gate
component, and the account-zone consumption. `can()` is pure and hermetic.
The database overrides defaults per role, merged per request. The custom-role
groundwork needs no schema change because the `roles` table already carries
its system flag at `lib/auth/schema.ts:74` (`"isSystem"`).

The catalog is fixed. Admins toggle existing permission keys in batch F and
cannot invent new strings, because every permission needs an enforcement site
in code. Full route-by-route gating ships in batch C. Batch B proves the seam
once, on quiz-grade.

## User Stories

1. As a guest, I want quiz grading, so that the graded-test path has a
   permission gate before batch C caps its quota.
2. As a learner, I want in-class chat, TTS, and ASR, so that the classroom is
   usable without authoring rights.
3. As a creator, I want to create, edit, delete, and publish courses, so that
   the authoring surface is gated by capability, not by luck.
4. As an operator, I want role permission overrides stored in the database,
   so that the admin UI can tune capabilities without code edits.
5. As a signed-in user, I want the account zone to show only the entries my
   permissions allow, so that hidden affordances match the server.
6. As a UI developer, I want a permission-gate component and a hook, so that
   affordance hiding stays consistent with the server guard.

## Slices

Each slice lists the ledger bindings, before-state notes, postcondition, and
gate inventory. New symbols pin their intended declaration text at plan time.
After implementation the builder re-pins byte-exact from machine-extracted
outline text, per the PIN-FROM-OUTLINE rule in Testing Decisions. The
env-clear prefix `ENV_CLEAR` is the 013 canonical list, copied verbatim
(`DATABASE_URL`, `PERSISTENCE_DEV_TOKEN`, `ACCESS_CODE`,
`OPENMAIC_AGENT_RUNTIME_ENABLED`, `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED`,
`NEXT_PUBLIC_MAIC_EDITOR_ENABLED`).

### S1 Catalog, rank defaults, and the pure `can()` helper

Delivers: the fixed permission catalog, the rank-derived default statements,
and the pure `can()` function in `lib/auth/permissions.ts`. The module stays
client-safe: it imports nothing from Node and nothing from the database.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/auth/permissions.ts::PERMISSION_CATALOG` | constant | shape: 11 string literals, listed in Implementation Decisions | the fixed, exhaustive permission vocabulary |
| `lib/auth/permissions.ts::defaultPermissionsForRank` | function | `(rank: number): Permission[]` | the rank-derived default statement set per the matrix |

The `can` signature is multi-line in source and stores verbatim, so its
binding uses the code-block pattern:

- `lib/auth/permissions.ts::can` (kind function, after-signature):

  ```
  (
    principal: Principal | null,
    permission: Permission,
    overrides?: ReadonlyMap<Permission, boolean>,
  ): boolean
  ```

  Behavior: pure: rank defaults plus override booleans, no I/O

Before-state capture notes: `lib/auth/permissions.ts` does not exist. No
`can` symbol exists anywhere. `ROLE_RANKS` and `SYSTEM_ROLES` live at
`lib/auth/roles.ts:7` and `:31-36`.

Postcondition: the catalog is exhaustive and fixed. Rank defaults match the
capability matrix. `can()` returns false for anonymous, true for matrix
cells, and honors override booleans without touching the database.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/permissions/permissions-core.test.ts && echo PERM_CORE_OK` expects `PERM_CORE_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`
- smoke: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/providers/provider-neutrality-guard.test.ts && echo NEUTRAL_OK` expects `NEUTRAL_OK`

Risk tier: 2.

### S2 Role permission overrides and the server resolver

Delivers: the `role_permissions` table in the lazy ensure chain, the
server resolver that merges database rows over rank defaults, the
per-request cache, and the custom-role groundwork on the existing
`"isSystem"` column.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/auth/schema.ts::ensureAuthSchema` | function | `(queryable: Queryable): Promise<void>` | modified: composes `role_permissions` into the ensure chain beside the six tables |

The `resolvePermissionSet` signature is multi-line in source and stores
verbatim, so its binding uses the code-block pattern:

- `lib/auth/permissions-server.ts::resolvePermissionSet` (kind
  function, after-signature):

  ```
  (
    queryable: Queryable,
    role: Role,
  ): Promise<PermissionSet>
  ```

  Behavior: merges rank defaults with `role_permissions` rows. Granted true adds, granted false removes. Caches per request

Before-state capture notes: the ensure chain in `lib/auth/schema.ts` ends at
line 86 with the `user_roles_role_id_idx` index. No `role_permissions` table
exists. The roles table already carries `"isSystem"` at `lib/auth/schema.ts:74`,
and `lib/auth/roles.ts:108,112,120` read it as `is_system`.

Postcondition: the override table exists app-side. A denied row removes the
permission from the default set, and a granted row adds it. The resolver
resolves once per request. Custom roles resolve through their rank even
without new schema, because the system flag row already exists.

The override-table contract suite runs against a real PostgreSQL, following
the app-side pattern in `tests/agent-runtime/event-notify.pg.test.ts:32,57`
and the fail-closed guard from 013. Without `PG_CONTRACT_URL` the gate fails
closed with no marker, which is intended for a tier-3 gate.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/permissions/role-permissions.test.ts && echo ROLE_PERM_OK` expects `ROLE_PERM_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; test -n "$PG_CONTRACT_URL" && pnpm test tests/permissions/role-permissions.pg.test.ts && echo ROLE_PERM_PG_OK` expects `ROLE_PERM_PG_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3.

### S3 Server guard and the quiz-grade reference adoption

Delivers: `requirePermission` in the server module, re-exported through the
public surface, and the single reference adoption in the quiz-grade route
that proves the seam end to end.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/api/quiz-grade/route.ts::POST` | function | `(req: NextRequest): Promise<Response>` | modified: adopts the guard as the single batch B route, preserving the existing `callLLM` flow |

Both guard rows carry multi-line signatures the outline reports verbatim.
Their exact parameter text pins them:

- `lib/auth/permissions-server.ts::requirePermission` (kind
  function, after-signature):

  ```
  (
    headers: Headers,
    permission: Permission,
  ): Promise<Session>
  ```

  Behavior: returns the session or throws the typed 403 refusal with shape `{ message, code }`

- `lib/auth/index.ts::requirePermission` (kind
  function, after-signature):

  ```
  (
    headers: Headers,
    permission: Permission,
  ): Promise<Session>
  ```

  Behavior: modified: re-exports the guard through the public surface

Before-state capture notes: `app/api/quiz-grade/route.ts` has no auth gate
and calls `callLLM` from `@/lib/ai/llm` (import at the route head). The
refusal 403 shape follows the apiError pattern in the route.

Postcondition: an anonymous quiz-grade request returns the typed 403. A
guest holds `quiz.grade` and passes the guard. The LLM call never runs
before the guard resolves.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/permissions/require-permission.test.ts && echo REQPERM_OK` expects `REQPERM_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/permissions/quiz-grade-gate.test.ts && echo QUIZ_GATE_OK` expects `QUIZ_GATE_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate drives the real route with `@/lib/ai/llm`
and `@/lib/server/resolve-model` both mocked, asserting the 403 shape, the
allow path, and that the LLM call is guarded. The 403 path needs neither
mock.

### S4 Client surface and account zone consumption

Delivers: the permissions route, the client hook with defaults-deny, the
permission-gate component, and the account zone visibility delta.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/api/auth/permissions/route.ts::GET` | function | `(_req: NextRequest): Promise<NextResponse>` | returns the resolved permission list for the session. Defaults-deny for anonymous |
| `lib/hooks/use-permissions.ts::usePermissions` | function | `(): PermissionState` | fetches the permission list, defaults to empty, pure import graph |
| `components/permission-gate.tsx::PermissionGate` | component | `({ permission, fallback = null, children }: PermissionGateProps)` | render-prop hiding: shows children when allowed, fallback otherwise |
| `components/account-zone.tsx::AccountZone` | function | `({ onSignOut }: AccountZoneProps)` | modified: Settings entry gated by `settings.manage`, Admin entry gated by `users.manage` |

Before-state capture notes: `app/api/auth/permissions/route.ts` does not
exist. The catch-all `app/api/auth/[...path]/route.ts` currently owns every
auth path. `components/account-zone.tsx` renders the Settings entry at `:108`
through `auth.account.settings` with no permission. No `use-permissions`
hook and no `permission-gate` component exist.

Postcondition: the more specific route wins over the catch-all. Anonymous
clients receive an empty permission list. The hook never imports a server
module. The account zone hides Settings without `settings.manage` and shows
an Admin entry only with `users.manage`. Users without `settings.manage`
see no Settings entry at all. Holders see the entry with the
`auth.common.soon` badge, because the destination is a stub until batch E
replaces it.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/permissions/use-permissions.test.ts && echo PERMS_CLI_OK` expects `PERMS_CLI_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/permissions/permissions-route.test.ts && echo PERMS_ROUTE_OK` expects `PERMS_ROUTE_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/permissions/client-import-graph.test.ts && echo PERMS_GRAPH_OK` expects `PERMS_GRAPH_OK`
- smoke: `pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`

Risk tier: 3. The import-graph gate mirrors `tests/branding/client-import-graph.test.ts`
for the hook, exactly as the batch G and batch A lessons require.

## Implementation Decisions

- The catalog. Eleven permissions, fixed in code: `course.create`,
  `course.edit`, `course.delete`, `course.publish`, `classroom.chat`,
  `quiz.grade`, `tts.use`, `asr.use`, `settings.manage`, `users.manage`,
  `roles.manage`. The list is verified against the capability matrix
  (`docs/research/rbac-minimal-mode-decision-round-1.md:72-82`). Two deltas
  from the Q8 register: `course.edit`, `course.delete`, `tts.use`, and
  `asr.use` are added because the matrix rows "Create/edit/delete courses"
  and "TTS/ASR in-class features" demand them. One delta from the brief:
  `course.delete` is added because the same matrix row names delete.
  `course.publish` covers the publish route with the ownership condition
  staying app-level.
- Rank defaults. Anonymous and no session deny everything. Guest holds
  `quiz.grade` only (the batch C quota caps it at 5 per day). Learner holds
  `classroom.chat`, `quiz.grade`, `tts.use`, `asr.use`. Creator adds
  `course.create`, `course.edit`, `course.delete`, `course.publish`. Admin
  holds all eleven.
- The `role_permissions` table. Columns `role_name TEXT`, `permission TEXT`,
  `granted BOOLEAN NOT NULL DEFAULT true`, primary key
  `(role_name, permission)`. App-side, composed into the lazy ensure chain
  in `lib/auth/schema.ts`, never in a publishable package.
- The resolver. `resolvePermissionSet` starts from
  `defaultPermissionsForRank(role.rank)`, then applies every row where
  `role_name = role.name`: granted true adds, granted false removes. It
  returns an immutable set. The cache is per request, never global. The
  honesty note: a per-request cache means an admin override applies on the
  next request, and a multi-instance deployment can serve one request window
  of lag. A global in-memory cache was rejected because it would go stale
  across instances.
- Client purity. `lib/auth/permissions.ts` stays client-safe: the catalog,
  the rank defaults, and `can()` import nothing. The database resolver and
  the guard live in `lib/auth/permissions-server.ts`, imported only by the
  server surface. `usePermissions` never reaches the server module. The
  import-graph gate mirrors the branding guard and extends the server
  package list with `better-auth`, `kysely`, and `js-yaml`.
- The guard refusal. `requirePermission` returns the session or throws a
  typed refusal serialized as `{ message, code }`, with
  `code: 'permission_denied'`, status 403. Named
  `PermissionDeniedError` for callers to catch.
- The permissions route. `app/api/auth/permissions/route.ts::GET` wins over
  the catch-all at the exact path. It returns `{ permissions: string[] }`
  for the session and `{ permissions: [] }` for anonymous. The `ACCESS_CODE`
  curtain still applies at the middleware, per Q14. Not whitelisted.
- The account zone delta. Settings entry gated by `settings.manage` and an
  Admin entry gated by `users.manage`, using the approved mockups. Any new
  label rides the `auth.*` namespace with 12-locale parity.
- Custom role groundwork. The `roles` table already carries the system flag
  as `"isSystem"` (`lib/auth/schema.ts:74`), read as `is_system` by
  `lib/auth/roles.ts:112`. Batch F can add custom roles with no schema
  change. The resolver reads the flag so F's UI can distinguish built-ins
  from custom roles.
- Reference adoption only. Quiz-grade is the one batch B route. Full
  route-by-route gating is batch C, which rides this seam.

## Testing Decisions

- Hermetic unit tests live under `tests/permissions/`. Root vitest picks up
  `tests/**/*.test.ts` (`vitest.config.ts:11`) and `.env.local` is not
  loaded (`tests/setup-env.ts:4`).
- The env-clear prefix is the 013 canonical list, copied verbatim, on every
  vitest gate. The pg contract gate keeps `PG_CONTRACT_URL` untouched and
  fails closed without it.
- The PIN-FROM-OUTLINE rule, the hard lesson of batches A and G: pin
  signatures AFTER the code exists or from machine-extracted text, never
  from prose. For the new symbols above, the plan pins the intended
  declaration text. After implementation, the builder replaces every pinned
  string with the byte-exact outline text, exactly as the 013 rows were
  re-pinned in round 1. Multi-line signatures move to code-block bindings.
- The database is faked with the same mocked
  `getServerPersistenceProvider` pool shape as
  `tests/agent-runtime/stage-meta-routes.test.ts:1-33`.
- The override-table contract suite provisions its own scratch database per
  the app-side pg precedent (`tests/agent-runtime/event-notify.pg.test.ts:58-72`)
  and is gated fail-closed on `PG_CONTRACT_URL`.
- The client import graph is guarded by
  `tests/permissions/client-import-graph.test.ts`, mirroring
  `tests/branding/client-import-graph.test.ts`.
- The provider-neutrality guard runs in S1. New identifiers contain no token
  or plan segments, verified by inspection.
- The i18n parity check runs in S4. New `auth.*` keys get 12-locale parity.
- Plan-time state: the `tests/permissions/*` suites do not exist yet and
  fail with no marker until they do. These are the documented
  deliverable-dependent failures.

## Out of Scope

- Route-by-route gating and the minimal-mode enforcement (batch C).
- Quotas, including the guest 5 per day quiz grade cap (batch C).
- The admin settings UI and invites (batch E).
- Custom role CRUD UI (batch F).
- Publish audience and the read gate (batch D).
- Draft share lists and ownership-condition SQL. Own-course conditions
  stay app-level, never in the catalog.

## Further Notes

- The program record is `docs/meta-specs/rbac-minimal-mode.md`. Batch B
  depends on batch A and may assume `user`, `session`, `roles`,
  `user_roles`, `requireSession`, and the owner id scheme.
- Batch A certified lessons apply from day one: pin signatures from
  machine-extracted outline text, keep the client import graph pure, and
  prove persistence against a real chain, not only static checks.
- The soundness review re-dry-runs every gate in this spec against the live
  CLI before implementation starts.
- The visual-preview checkpoint runs before implementation. The account zone
  delta mockup renders in localhost and is approved in Safari first.
- Commit convention for this batch: `feat(auth): ...`.
- Batch 013 is closed, so a one-word correction is recorded here instead.
  013's roles-table prose says only "a system flag". The implemented column
  is `"isSystem"` (`lib/auth/schema.ts:74`), read as `is_system` by
  `lib/auth/roles.ts:112`.
- No new operator-facing env vars ship in batch B, so `.env.example` is
  unchanged.

## Amendment 2026-09-05 (S4 pin re-anchor)

A pre-verification diff-risk check found three prose pins deviating from outline truth. The rows were re-anchored per the pin-from-outline rule. Gates are untouched. Round-2 re-verification found prettier line-wrap drift on four pins; re-anchored to verbatim multi-line outline text.## Research update (2026-09-05)

Batch B shipped in `cf1fd4be` and the fix round in `2802459e`. This section records what shipped, what deviated from the plan, and what batch C inherits.

### What shipped

- `lib/auth/permissions.ts`: the 11-key catalog at :43, rank defaults at :67, and pure `can()` at :104.
- `lib/auth/permissions-server.ts`: `resolvePermissionSet` at :70 merges `role_permissions` rows at :90 over rank defaults. The WeakMap cache at :19 is per request, never global. `requirePermission` at :28 returns the session or throws the typed 403.
- `lib/auth/index.ts`: `requirePermission` forwards at :96.
- `app/api/auth/permissions/route.ts`: GET at :14 returns the resolved list and defaults-deny for anonymous.
- `lib/hooks/use-permissions.ts`: `usePermissions` at :25 fetches the list and stays empty on any error.
- `components/permission-gate.tsx`: `PermissionGate` at :24 hides children without the permission.
- `components/account-zone.tsx`: Settings gated by `settings.manage` at :49, Admin by `users.manage` at :60.
- `app/api/quiz-grade/route.ts`: POST at :29 adopts the guard at :35. It is the single batch B reference. The LLM call at :80 never runs before the guard.

### Deviations and lessons

(a) The headline finding. Round-1 gates all passed while the live seam was broken. `apiCall` built a relative-URL Request and Node's undici threw. `getSession` swallowed the throw to null at `lib/auth/index.ts:43-64`. Every signed-in user then hit the typed 403. The gate suites hid the break because they mock the seam: `tests/permissions/require-permission.test.ts:10-11`, `tests/permissions/permissions-route.test.ts:20-21`, and `tests/permissions/quiz-grade-gate.test.ts:20-22`. Commit `2802459e` fixed it with an absolute-URL `apiCall` in `lib/auth/server.ts` and honest error handling. The fix-round live probe returned guest exactly `[quiz.grade]`, creator 8 keys, and admin 11, matching the rank defaults at `lib/auth/permissions.ts:67-89`. Lesson: a gate suite that mocks the seam under test proves nothing about that seam. Live-wire proof is mandatory for guard and session code.

(b) Spec sentence inversion. The review-C3 fix stated non-holders keep the soon badge. The approved matrix says holders keep it. Ledger seq 76 corrected the sentence and the fix round live-proved it. The badge now sits inside the holder branch at `components/account-zone.tsx:49-59`. Safari proves non-holders see no Settings or Admin entry.

(c) Pin drift twice. First the prose pins for GET NextResponse, the PermissionGate default, and the AccountZone props (ledger seq 65). Then prettier line-wrap drift on four multi-line pins (ledger seq 82). Both fixed with the code-block dedent and byte-verify pattern. The final diff classifies 12 of 12 targets as matches.

(d) better-auth 1.7.2 email verification. It validates an HS256 JWT signed with the effective secret, not verification-table rows. The earlier "missing verification row" scare was a false alarm. The verified-guest recipe is documented at `docs/research/015-verification-report.md:94`.

(e) Retry accounting. The ledger reached 3 of 5 (count 3, max 5). That is one rejection-free stage return for the fix round (seq 75) plus two correction amendments (seq 65, seq 82). Consecutive same-cause is zero. No escalation fired. Forward edges are unaffected.

### Test results

All 13 gates passed green twice fresh: round 1 at ledger seq 71-74, round 2 at seq 78-81. The ledger records 13 gate runs, all exit 0. The pg contract gate provisioned its own scratch database and fails closed without `PG_CONTRACT_URL`. The unit and integration suites total 79 tests across 8 files. Full suite: 7613 passed, 1 failed. The failure is `runner-skills-registration`, the documented pre-existing family (`docs/research/013-implementation-diagnosis.md:22`). `npx tsc --noEmit` and the prettier check are clean. Safari shots: 15 of 16 console-clean, with screenshot 16 capturing the fixed guest state.

### What batch C inherits

- `requirePermission` is THE route guard. Batch C adopts it per route in its gating slices.
- The permissions route, the hook, and `PermissionGate` hide affordances client-side.
- The `role_permissions` override table is ready in the ensure chain at `lib/auth/schema.ts:90` for batches E and F.
- The live-wire-proof rule applies to every batch C gate.
- The JWT verification recipe at `docs/research/015-verification-report.md:94` feeds the batch C test probes.
## Certification Report

Certified: 2026-09-05T02:26:09.278Z
Signature: 66b0a9616ca73c4490aae480e30cf9ccc00db3f44478d50cd458ae40ca7f6532

### Summary

Slices: 4
Symbols: 12
Gates: 13

### Implemented Symbols

- **S1** (Catalog, rank defaults, and the pure can() helper):
  - lib/auth/permissions.ts::PERMISSION_CATALOG
  - lib/auth/permissions.ts::defaultPermissionsForRank
  - lib/auth/permissions.ts::can
- **S2** (Role permission overrides and the server resolver):
  - lib/auth/schema.ts::ensureAuthSchema
  - lib/auth/permissions-server.ts::resolvePermissionSet
- **S3** (Server guard and the quiz-grade reference adoption):
  - lib/auth/permissions-server.ts::requirePermission
  - lib/auth/index.ts::requirePermission
  - app/api/quiz-grade/route.ts::POST
- **S4** (Client surface and account zone consumption):
  - app/api/auth/permissions/route.ts::GET
  - lib/hooks/use-permissions.ts::usePermissions
  - components/permission-gate.tsx::PermissionGate
  - components/account-zone.tsx::AccountZone

### Gates Passed

- **S1**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/permissions/permissions-core.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/permissions/permissions-core.test.ts \u001b[2m(\u001b[22m\u001b[2m37 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 4\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m37 passed\u001b[39m\u001b[22m\u001b[90m (37)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:59:06\n\u001b[2m   Duration \u001b[22m 89ms\u001b[2m (transform 21ms, setup 13ms, import 15ms, tests 4ms, environment 0ms)\u001b[22m\n\nPERM_CORE_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"TSC_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/providers/provider-neutrality-guard.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/providers/provider-neutrality-guard.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 34\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:59:10\n\u001b[2m   Duration \u001b[22m 358ms\u001b[2m (transform 82ms, setup 14ms, import 254ms, tests 34ms, environment 0ms)\u001b[22m\n\nNEUTRAL_OK\n","passed":true}
- **S2**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/permissions/role-permissions.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/permissions/role-permissions.test.ts \u001b[2m(\u001b[22m\u001b[2m9 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 4\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m9 passed\u001b[39m\u001b[22m\u001b[90m (9)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:58:53\n\u001b[2m   Duration \u001b[22m 328ms\u001b[2m (transform 38ms, setup 14ms, import 245ms, tests 4ms, environment 0ms)\u001b[22m\n\nROLE_PERM_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/permissions/role-permissions.pg.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/permissions/role-permissions.pg.test.ts \u001b[2m(\u001b[22m\u001b[2m7 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 304\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m7 passed\u001b[39m\u001b[22m\u001b[90m (7)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:58:53\n\u001b[2m   Duration \u001b[22m 730ms\u001b[2m (transform 185ms, setup 14ms, import 354ms, tests 304ms, environment 0ms)\u001b[22m\n\nROLE_PERM_PG_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S3**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/permissions/require-permission.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/permissions/require-permission.test.ts \u001b[2m(\u001b[22m\u001b[2m7 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 11\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m7 passed\u001b[39m\u001b[22m\u001b[90m (7)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:59:15\n\u001b[2m   Duration \u001b[22m 103ms\u001b[2m (transform 23ms, setup 11ms, import 22ms, tests 11ms, environment 0ms)\u001b[22m\n\nREQPERM_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/permissions/quiz-grade-gate.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/permissions/quiz-grade-gate.test.ts \u001b[2m(\u001b[22m\u001b[2m6 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 6\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m6 passed\u001b[39m\u001b[22m\u001b[90m (6)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:59:16\n\u001b[2m   Duration \u001b[22m 129ms\u001b[2m (transform 29ms, setup 14ms, import 51ms, tests 6ms, environment 0ms)\u001b[22m\n\nQUIZ_GATE_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S4**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/permissions/use-permissions.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/permissions/use-permissions.test.ts \u001b[2m(\u001b[22m\u001b[2m7 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 19\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m7 passed\u001b[39m\u001b[22m\u001b[90m (7)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:59:25\n\u001b[2m   Duration \u001b[22m 105ms\u001b[2m (transform 23ms, setup 14ms, import 13ms, tests 19ms, environment 0ms)\u001b[22m\n\nPERMS_CLI_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/permissions/permissions-route.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/permissions/permissions-route.test.ts \u001b[2m(\u001b[22m\u001b[2m5 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 10\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m5 passed\u001b[39m\u001b[22m\u001b[90m (5)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:59:26\n\u001b[2m   Duration \u001b[22m 114ms\u001b[2m (transform 27ms, setup 14ms, import 33ms, tests 10ms, environment 0ms)\u001b[22m\n\nPERMS_ROUTE_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/permissions/client-import-graph.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/permissions/client-import-graph.test.ts \u001b[2m(\u001b[22m\u001b[2m1 test\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 1\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m   Start at \u001b[22m 13:59:26\n\u001b[2m   Duration \u001b[22m 76ms\u001b[2m (transform 13ms, setup 12ms, import 6ms, tests 1ms, environment 0ms)\u001b[22m\n\nPERMS_GRAPH_OK\n","passed":true}
  - g4: {"id":"g4","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 check:i18n-keys /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> node scripts/check-i18n-keys.mjs\n\ni18n key alignment check passed (12 locale files, source: en-US.json).\nI18N_OK\n","passed":true}

Certification hash: 66b0a9616ca73c4490aae480e30cf9ccc00db3f44478d50cd458ae40ca7f6532
Certified: 2026-09-05T02:26:09.278Z | Signature: 66b0a9616ca73c4490aae480e30cf9ccc00db3f44478d50cd458ae40ca7f6532 | Certifier: verifier
