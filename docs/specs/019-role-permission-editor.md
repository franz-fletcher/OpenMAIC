# Batch 019 spec: role-permission-editor

Spec status: research_update

## Problem Statement

Roles exist but nobody can edit them. The permission core from batch B is
complete, the admin surface from batch E is live, and the last RBAC gap is
the role editor. From the operator view the consequences are concrete.

- The roles table carries `name`, `rank`, and `"isSystem"`
  (`lib/auth/schema.ts:70-77`), and the four system roles seed at boot
  (`lib/auth/roles.ts:31-36`), but no admin route exposes them. The only
  role list in the UI is the hardcoded four-role picker at
  `components/admin/users-section.tsx:66-71`.
- The `role_permissions` override table exists
  (`lib/auth/schema.ts:90-95`), and `resolvePermissionSet` merges it over
  rank defaults (`lib/auth/permissions-server.ts:105-140`), but only the
  client permissions route consumes the merge
  (`app/api/auth/permissions/route.ts:50`). The route guard
  `requirePermission` resolves only the rank and checks plain rank defaults
  (`lib/auth/permissions-server.ts:60-73`), so a database override that
  grants `course.create` to the learner role changes nothing on any guarded
  route. The shipped merge cache is process-global too: the `requestCache`
  WeakMap keys on the queryable identity, and production passes the pool
  that `getServerPersistenceProvider` caches for the process lifetime, so
  even the client route reads a frozen merge until a restart. This is the
  enforcement seam batch B left unwired.
- The roles rank column is `INTEGER NOT NULL UNIQUE`
  (`lib/auth/schema.ts:73`). The approved rank doctrine says labels are free
  per rank and custom roles get an admin-chosen rank that drives audience
  tiers (`docs/meta-specs/rbac-minimal-mode.md:169`), so a custom role
  cannot share rank 2 with learner today. The constraint contradicts the
  doctrine.
- The audience tiers derive from rank automatically
  (`lib/persistence/audience.ts:55-58`, read gate at
  `lib/persistence/document-access.ts:78-81`), so a rank-2 custom role would
  open learner-tier courses with no gate change. Nothing proves this yet.
- Self-lockout is an open vector. The role assigner has no self check
  (`lib/persistence/admin-users.ts:100-112`), while the self-ban refusal at
  `:125-127` is the model for a lockout guard. An administrator can demote
  their own role or strip `roles.manage` from their own role and lock
  everyone out of the admin surface.
- The batch E follow-on is still open. `includeDeleted` parses `'true'`
  strictly at `app/api/admin/courses/route.ts:29`, so `'1'` silently means
  false. Deviation (g) and the follow-on note record it
  (`docs/specs/018-admin-suite.md:763-765`, `:784`). No new batch may defer
  it.
- Env and yaml seed email-to-role grants only
  (`lib/auth/roles-config.ts:19-47`). Permission defaults are always the
  rank-derived set (`lib/auth/permissions.ts:67-89`). The UI needs a way to
  show which keys come from the defaults and which are database overrides.

## Solution

Batch F ships the role editor as the fourth section on `/admin/settings`.
An operator lists every role with rank, system flag, and the 11-key catalog
broken into defaults and overrides. They create custom roles with a name, a
rank pick, and permission checkboxes. They rename, re-rank, and re-permission
custom roles, reset a role to its rank defaults, and delete a custom role
only when no user holds it. System roles keep immutable names and ranks but
stay overrideable in permissions, consistent with the batch B merge design.

Batch F wires the enforcement seam. `requirePermission` resolves the full
role row and checks the merged set from a fresh `resolvePermissionSet`
call on every guarded request, so a `role_permissions` override changes
guarded routes on the next request without a process restart. It closes
the self-lockout vector with a guard that refuses self-mutation of
the acting administrator's own role and own assignment. It drops the rank
uniqueness constraint so custom roles can share a seeded rank and inherit
its audience tier automatically. It rides the batch E follow-on: the
`includeDeleted` strictness fix and its test.

The catalog stays fixed at 11 keys. Admins toggle existing keys and cannot
invent permission strings, because every permission needs an enforcement
site in code.

## User Stories

1. As an operator, I want a roles section on the admin settings page, so
   that every role is visible with its rank, its system flag, and its
   effective permissions.
2. As an operator, I want to create a custom role with a name, a rank pick,
   and permission checkboxes from the fixed catalog, so that capability
   tuning needs no code edits.
3. As an operator, I want to see which permissions come from the rank
   defaults and which are database overrides, so that a role's effective
   set is explainable.
4. As an operator, I want a reset action that clears a role's overrides, so
   that the role returns to its rank defaults.
5. As an operator, I want to rename a custom role and change its rank and
   permissions, so that labels stay free per rank.
6. As an operator, I want to delete a custom role only when no user holds
   it and no pending invite names it, so that no assignment dangles, no
   invite grants nothing silently, and the foreign key stays intact.
7. As an operator, I want permission overrides to reach route guards on the
   next request, so that a toggled permission changes enforcement
   immediately without a process restart.
8. As an administrator, I want my own role and my own assignment locked
   against self-mutation, so that I cannot lock myself or the surface out.
9. As a custom-role holder, I want my audience tiers to follow my rank
   automatically, so that a rank-2 custom role opens learner-tier courses
   with no gate change.
10. As a verifier, I want `includeDeleted` to accept `'1'` as well as
    `'true'`, so that the batch E follow-on closes in this batch.

## Slices

Each slice lists the ledger bindings, before-state notes, postcondition, and
gate inventory. New symbols pin their intended declaration text at plan
time. After implementation the builder re-pins byte-exact from
machine-extracted outline text, per the PIN-FROM-OUTLINE rule in Testing
Decisions.

The env-clear prefix is the 016 canonical list, copied verbatim, including
the two batch C variables:

`unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE;`

Hermetic unit suites run without `PG_CONTRACT_URL`, where `getSession`
returns null through the catch path and every guarded call would look
anonymous. Each unit gate family seeds its own session fixture. The
roles-admin and roles-section suites mock `getSession` at the module
boundary and return a session with the rank the family needs. The pg,
adversarial, RSC, and live-route gates never mock `getSession`: they seed
real better-auth sessions in the scratch database, and the guard and
enforcement seams stay real.

### S1 Roles persistence core and the rank uniqueness delta

Delivers: the schema delta that drops the rank uniqueness constraint, and
the app-owned admin-roles persistence module with defaults-and-overrides
introspection, custom role create, update, reset, and guarded delete.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/auth/schema.ts::ensureAuthSchema` | function | `(queryable: Queryable): Promise<void>` | modified: drops the `roles_rank_key` uniqueness constraint through the lazy ALTER pattern, so custom roles may share a seeded rank |
| `lib/persistence/admin-roles.ts::listRolesWithPermissions` | function | `(queryable: Queryable): Promise<AdminRoleWithPermissions[]>` | new: lists every role with rank, system flag, the rank-derived default set, and the `role_permissions` override map per role |
| `lib/persistence/admin-roles.ts::createRole` | function | `(queryable: Queryable, input: { name: string; rank: number; permissions: PermissionGrant[] }): Promise<Role>` | new: inserts a custom role and its initial overrides, refuses system-reserved names |
| `lib/persistence/admin-roles.ts::updateRole` | function | `(queryable: Queryable, roleId: string, input: { name?: string; rank?: number; permissions?: PermissionGrant[] }): Promise<void>` | new: renames through `role_permissions.role_name` in one transaction, changes rank, replaces the override set |
| `lib/persistence/admin-roles.ts::resetRoleOverrides` | function | `(queryable: Queryable, roleName: string): Promise<void>` | new: deletes every `role_permissions` row for the role name |
| `lib/persistence/admin-roles.ts::deleteRole` | function | `(queryable: Queryable, roleId: string): Promise<void>` | new: deletes only non-system roles with no `user_roles` row referencing them and no unrevoked, unexpired, unused invite naming them (`invites.role_name` with `used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`), then removes their override rows |

Before-state capture notes: `roles.rank` is `INTEGER NOT NULL UNIQUE`
(`lib/auth/schema.ts:73`). The lazy ALTER precedent is the ban-columns block
at `lib/auth/schema.ts:127-131`; Postgres names the auto unique constraint
`roles_rank_key`, so `ALTER TABLE roles DROP CONSTRAINT IF EXISTS
roles_rank_key` is the single idempotent statement. `listRoles` exists at
`lib/auth/roles.ts:103-124` and orders by rank ascending. The
`user_roles.role_id` column references `roles(id)` with no cascade
(`lib/auth/schema.ts:81`), so a guarded delete is the only safe removal.
`role_permissions.role_name` is a text column with no foreign key
(`lib/auth/schema.ts:90-95`), so a rename must update those rows in the
same transaction. No custom-role create or update path exists anywhere.

Postcondition: the rank column loses its uniqueness constraint without any
migration files, and a custom role may share rank 2 with learner. The
introspection lists every role with its default set from
`defaultPermissionsForRank` and its override map. `createRole` rejects
system-reserved names. `updateRole` renames and re-ranks atomically and
replaces the override set. `resetRoleOverrides` returns the role to pure
rank defaults. `deleteRole` refuses system roles, roles with attached
users, and roles that a pending invite references by name (unused,
unrevoked, and unexpired), and cleans the override rows for the deleted
role.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/roles-persistence.test.ts && echo ROLES_CORE_OK` expects `ROLES_CORE_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/roles-persistence.pg.test.ts && echo ROLES_CORE_PG_OK` expects `ROLES_CORE_PG_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate provisions a scratch database, runs the
ensure chain, proves two roles share rank 2, and drives create, rename,
rank change, override replacement, reset, and guarded delete against the
real tables. The delete drive also refuses a role while an unrevoked,
unexpired, unused invite references its name.

### S2 Roles API routes and the self-lockout guard

Delivers: the `roles.manage`-gated role routes, the self-mutation lockout
guard on both the role routes and the user role assigner, and the route
error copy.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/api/admin/roles/route.ts::GET` | function | `(req: NextRequest): Promise<Response>` | new: gated `roles.manage`, returns the role list with defaults and overrides, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `app/api/admin/roles/route.ts::POST` | function | `(req: NextRequest): Promise<Response>` | new: gated `roles.manage`, creates a custom role with initial permissions, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `app/api/admin/roles/[id]/route.ts::PATCH` | function | `(req: NextRequest, { params }: Params)` | new: gated `roles.manage`, applies rename, rank change, permission overrides, or override reset, refuses mutation of the acting session's own role, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `app/api/admin/roles/[id]/route.ts::DELETE` | function | `(req: NextRequest, { params }: Params)` | new: gated `roles.manage`, deletes a custom role with no attached users, refuses the acting session's own role, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `lib/persistence/admin-users.ts::setUserRole` | function | `(queryable: Queryable, userId: string, roleId: string, grantedBy: string): Promise<void>` | modified: refuses when `grantedBy === userId`, mirroring the self-ban refusal at `lib/persistence/admin-users.ts:125-127`, so an administrator cannot change their own assignment |
| `app/api/admin/users/route.ts::PATCH` | function | `(req: NextRequest): Promise<Response>` | modified: converts the `setUserRole` self-demote refusal next to the self-ban block at `app/api/admin/users/route.ts:84-89`, returning the typed `{ success: false, code, message }` response with code `SELF_DEMOTE_REFUSED` and status 400, so the refusal never surfaces as a 500 from the outer catch at `:99-102` |
| `lib/i18n/locales/en-US.json` | file | new `admin.roles` group | modified: source-of-truth keys for the route statuses and error copy |

Before-state capture notes: no `app/api/admin/roles` route exists. The
`users.manage` routes at `app/api/admin/users/route.ts:17-103` are the
byte-exact guard-catch model: the nested rethrow at `:21-26` and `:37-40`.
`setUserRole` has no self check (`lib/persistence/admin-users.ts:100-112`),
and the self-ban refusal precedent is at `:125-127`. The users route
converts that refusal at `app/api/admin/users/route.ts:84-89` and its
outer catch rethrows plain Errors at `:99-102`, so the 019 self-demote
refusal needs its own Error-to-Response conversion or the lockout gate
would assert against a raw 500. The admin i18n group
holds `settings`, `users`, `invites`, `courses`, and `notAuthorized`
(`lib/i18n/locales/en-US.json`), with no `roles` group.

Postcondition: a `roles.manage` holder lists roles, creates a custom role,
patches it, and deletes it. A denied rank receives the typed 403 with shape
`{ message, code }`. No route ever mutates the acting session's own role,
and no user route changes the acting session's own assignment: the
self-demote refusal converts to the typed `{ success: false, code,
message }` response next to the self-ban block, asserted as status 400 with
code `SELF_DEMOTE_REFUSED`, never a 500. The new copy passes the 12-locale
parity check.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/roles-admin.test.ts && echo ROLES_ADMIN_OK` expects `ROLES_ADMIN_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/roles-lockout.pg.test.ts && echo ROLES_LOCKOUT_OK` expects `ROLES_LOCKOUT_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 4. The adversarial gate drives the real routes with real seeded
sessions. It asserts that a non-admin gets the typed 403 on every role
route, that an admin cannot demote their own assignment through the users
route and receives the typed `SELF_DEMOTE_REFUSED` response (status 400
with `success: false`, mirroring the self-ban block, never a 500), that an
admin cannot strip `roles.manage` from or delete their own role through
the roles routes, and that the same admin edits other roles and other
users without friction. Only `getSession` is seeded for fixtures. The
guard and enforcement are never mocked.

### S3 Enforcement wiring: overrides reach the route guards

Delivers: the guard change that merges `role_permissions` overrides into
route enforcement, and live proof that a database override changes a real
guarded route on the next request.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/auth/permissions-server.ts::requirePermission` | function | `(headers: Headers, permission: Permission): Promise<Session>` | modified: resolves the full role row instead of the bare rank, checks the merged set from a fresh, uncached `resolvePermissionSet` call per guarded request, so database overrides reach every guard and never stale across requests |
| `lib/auth/permissions-server.ts::resolvePermissionSet` | function | `(queryable: Queryable, role: Role): Promise<PermissionSet>` | modified: drops the module-scoped `requestCache` (WeakMap at `lib/auth/permissions-server.ts:19`), so each call performs a fresh merge of rank defaults with the current `role_permissions` rows instead of reading a process-lifetime cached copy |
| `app/api/generate/image/route.ts::POST` | function | `(request: NextRequest): Promise<Response>` | contract symbol, unchanged: the guarded generate route the adversarial gate drives through `requirePermissionIfMinimalMode` with `course.create` |

Before-state capture notes: `requirePermission` resolves only `r.rank` and
checks `can({ rank }, permission)` at `lib/auth/permissions-server.ts:60-73`.
`resolvePermissionSet` merges overrides at `:105-140` and caches in the
module-scoped `requestCache` WeakMap at `:19` and `:110-116`, keyed on the
queryable identity. The only production merge consumer passes the app pool
(`app/api/auth/permissions/route.ts:50`), the exact object that
`getServerPersistenceProvider` caches for the process lifetime behind a
`Symbol.for` global (`lib/persistence/server-provider.ts:31-35`, `:72-93`),
so the cache spans requests in production; it is not per request. The
client route already resolves the full role row at
`app/api/auth/permissions/route.ts:25-49`, which is the pattern the S3
guard change reuses. The image generate route guards `course.create` under
the flag at `app/api/generate/image/route.ts:48-54` through
`requirePermissionIfMinimalMode`.

Postcondition: a `role_permissions` row that grants `course.create` to the
learner role lets a learner pass the real image generate route guard under
`MINIMAL_MODE` on the very next request. A denied row removes a default
permission from an existing role and blocks the same route. The batch B
cache doctrine (`docs/specs/015-permission-core.md:280-287`) assumed a
per-request cache; the shipped wiring never provided one, so batch F drops
the `requestCache` for the enforcement path instead of building per-request
machinery. Every guarded call resolves the full role row and requests a
fresh merge: rank defaults plus one indexed SELECT on
`role_permissions.role_name`, a bounded per-request cost. Staleness across
requests is impossible by construction, and the "next request" claim holds
literally. Route text stays untouched; only the resolver changes.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/permissions/guard-override-wiring.test.ts && echo GUARD_WIRE_OK` expects `GUARD_WIRE_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/permissions/guard-override-wiring.pg.test.ts && echo GUARD_WIRE_PG_OK` expects `GUARD_WIRE_PG_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && MINIMAL_MODE=true pnpm test tests/permissions/guard-live-route.pg.test.ts && echo GUARD_LIVE_OK` expects `GUARD_LIVE_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 4. The adversarial gate drives the real image generate route
with a real learner session and a real database in one test run on one
server, and it toggles the SAME learner role. Baseline: the learner posts
and receives 403 `permission_denied`. Grant: a real `role_permissions`
upsert grants `course.create`, the learner posts again and receives 400
`MISSING_PROVIDER` from the route, which proves the guard passed
(`app/api/generate/image/route.ts:67-69`). Revoke: the upsert removes the
grant, the learner posts again and receives 403 `permission_denied` again.
The same pool identity and the same `resolvePermissionSet` path serve all
three drives, so the gate asserts non-staleness: a cross-request cache
would make the post-revoke drive pass and fail the gate. `MINIMAL_MODE=true`
is set inline in the gate command, which the flag reads at call time. The
guard and the route are never mocked, which is the live-wire-proof rule
from the batch B research update (`docs/specs/015-permission-core.md:392`).

### S4 Roles section UI and the real-cookie page probe

Delivers: the `roles-section.tsx` client section on `/admin/settings`, the
users-section picker delta, the section i18n copy, and the real-cookie RSC
wire probe.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `components/admin/roles-section.tsx` | file | client section for the role table | new: role list, create form with name, rank pick, and the 11-key checkboxes, per-role defaults-and-overrides display, reset, rename, rank change, delete with the attached-users guard |
| `components/admin/users-section.tsx` | file | client section for the user table | modified: the role picker reads `GET /api/admin/roles` instead of the hardcoded four roles, keeping the current list as the failure fallback; option values are role IDs and the current-selection highlight resolves by ID through the fetched list |
| `app/admin/settings/page.tsx::AdminSettingsPage` | function | `()` | modified: renders the roles section under its own client gate and a server-translated title, gates the page with `users.manage` OR `roles.manage` so a roles-only holder reaches the roles section and the roles API together |
| `tests/admin/roles-rsc-probe.pg.test.ts` | suite | `describe('roles section RSC wire probes')` | new: signs a real `roles.manage` holder and a real non-holder, renders `AdminSettingsPage` in-process with a real signed cookie in the `next/headers` stub, asserts the roles title renders for the holder and the not-authorized state stays correct for the denied rank |
| `lib/i18n/locales/en-US.json` | file | new `admin.roles` section keys | modified: source-of-truth keys for the section copy |

Before-state capture notes: the page renders three sections at
`app/admin/settings/page.tsx:60-78` and guards with `users.manage` at
`:20-46`. The users-section role picker hardcodes the four system roles at
`components/admin/users-section.tsx:66-71`, and its select value is
`user.role`, the role NAME from `lib/persistence/admin-users.ts:86`, while
option values are role IDs (`components/admin/users-section.tsx:181-189`);
system roles render because ids seed from names (`lib/auth/roles.ts:49-55`),
and a uuid-id custom role would render blank. The shipped
`tests/admin/admin-page-gate.test.ts` renders the real page in-process and
mocks only the three existing sections (`:113-123`, `:170-208`); the
roles-section delta must add the roles-section mock to that suite or prove
the section renders under its mocks, so the certified 018 page gate cannot
regress silently. The batch E RSC lesson is on the record: a page guard
passed `new Headers()` and every real user lost the page, while unit gates
stayed green (`docs/specs/018-admin-suite.md:729-734`), and the follow-on
demands a real-cookie wire probe for RSC pages
(`docs/specs/018-admin-suite.md:789-790`). No `roles` keys exist in the
admin i18n group.

Postcondition: a `roles.manage` holder sees the roles section with the role
list, the create form, and the defaults-and-overrides table. The users
picker lists custom roles and highlights the current role by ID, so an
operator can reassign users off a role before deleting it. The page still
answers the typed not-authorized state for ranks holding neither
`users.manage` nor `roles.manage`, and the real-cookie probe proves the
roles title renders for a real holder cookie and never for a denied rank.
All new strings pass the 12-locale parity check. The section renders in
Safari. The client section hides entirely without `roles.manage`; a
`roles.manage`-only holder reaches the page and the roles section, and
`users.manage` holders keep the users, invites, and courses sections.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/roles-section.test.ts && echo ROLES_UI_OK` expects `ROLES_UI_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/roles-rsc-probe.pg.test.ts && echo ROLES_RSC_OK` expects `ROLES_RSC_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate signs real sessions through the
better-auth sign-in API, exactly as the cold-boot probe does
(`tests/admin/cold-boot-owner.pg.test.ts:111-148`), and never mocks
`getSession` or the page guard. The probe transport is pinned: no server
boots, and the gate renders `AdminSettingsPage` in-process with
`renderToStaticMarkup` over the page function while stubbing `next/headers`
to return the REAL signed cookie bytes captured from the sign-in, the
pattern `tests/admin/admin-page-gate.test.ts:170-208` ships. The
real-cookie design closes the batch E RSC lesson.

### S5 Audience-rank probe and the includeDeleted hardening

Delivers: the test that proves a custom rank-2 role reads learner-tier
courses through the existing audience gates, and the one-line
`includeDeleted` strictness fix with its regression test.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/api/admin/courses/route.ts::GET` | function | `(req: NextRequest): Promise<Response>` | modified: accepts `'1'` as well as `'true'` for `includeDeleted`, closing deviation (g) |
| `tests/admin/roles-audience.pg.test.ts` | suite | `describe('custom role audience rank probes')` | new: creates a custom rank-2 role, assigns a real user, asserts the user resolves to rank 2 and opens a learner-audience published course through `decideDocumentAccess` |
| `tests/admin/include-deleted-strict.test.ts` | suite | `describe('includeDeleted strict parsing')` | new: asserts `'1'`, `'true'`, and the missing value map correctly on the admin course route |

Before-state capture notes: the audience rank join returns the role rank
from `user_roles` at `lib/persistence/audience.ts:55-58`, and the read gate
compares `viewerRank < audience` at `lib/persistence/document-access.ts:78-81`.
A custom role at rank 2 therefore inherits the learner tier with no gate
change; only the rank uniqueness constraint blocked creating it, which S1
drops. `includeDeleted` parses strictly at
`app/api/admin/courses/route.ts:29`, and the follow-on sits at
`docs/specs/018-admin-suite.md:784`.

Postcondition: the probe proves the custom rank-2 holder opens a
learner-audience published course and opens a guest-audience course too,
because rank 2 is at or above audience 1 and the gate allows. The live
STEP3 proof at `tests/admin/roles-audience.pg.test.ts:204-222` asserts
`allow` for the audience-1 course, with the comment at `:220` reading
rank 2 >= audience 1 => allow. The denial boundary cases sit above the
holder's rank: the same holder receives `not-found` on the
creator-audience course at audience 3
(`tests/admin/roles-audience.pg.test.ts:166-183`). The route maps `'1'` to
true exactly like `'true'`, and `'0'` and missing stay false.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/roles-audience.test.ts && echo ROLE_AUDIENCE_OK` expects `ROLE_AUDIENCE_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/roles-audience.pg.test.ts && echo ROLE_AUDIENCE_PG_OK` expects `ROLE_AUDIENCE_PG_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/include-deleted-strict.test.ts && echo INCLUDE_DELETED_OK` expects `INCLUDE_DELETED_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate seeds a real custom role, a real user,
and a real published learner-tier course, and drives the read gate through
the real `resolveViewerRank` and `decideDocumentAccess` stack.

## Implementation Decisions

- The catalog stays fixed at 11 keys (`lib/auth/permissions.ts:13-24`). The
  section renders checkboxes from `PERMISSION_CATALOG` at `:43-55` and
  never accepts free text, per Q8 and the batch B amendment
  (`docs/meta-specs/rbac-minimal-mode.md:165`).
- Rank uniqueness is dropped. `roles.rank INTEGER NOT NULL UNIQUE`
  (`lib/auth/schema.ts:73`) contradicts the approved doctrine that labels
  are free per rank and that custom roles take an admin-chosen rank which
  drives audience tiers (`docs/meta-specs/rbac-minimal-mode.md:169`).
  `ensureAuthSchema` gains `ALTER TABLE roles DROP CONSTRAINT IF EXISTS
  roles_rank_key` through the same lazy ALTER pattern as the ban columns
  (`lib/auth/schema.ts:127-131`). Multiple roles share one rank. The rank
  pick offers 1 through 4, the four seeded ranks, because unknown ranks
  resolve to empty defaults (`lib/auth/permissions.ts:86-88`) and would
  strand a role with no capabilities.
- Role names stay unique. `roles.name` keeps its unique constraint
  (`lib/auth/schema.ts:72`). `createRole` refuses the reserved system names
  `guest`, `learner`, `creator`, and `admin`. `user_roles` references roles
  by id (`lib/auth/schema.ts:79-84`), so a rename only updates
  `roles.name` plus the matching `role_permissions.role_name` rows in one
  transaction, because that column carries no foreign key
  (`lib/auth/schema.ts:90-95`).
- System role policy. System roles keep immutable names and ranks; the UI
  hides the rename and rank controls for them. System role permissions stay
  editable through `role_permissions`, consistent with the batch B merge
  design, and system roles are undeletable. The delete flow also refuses
  any role with an attached `user_roles` row, per Q12
  (`docs/meta-specs/rbac-minimal-mode.md:169`), any role that an
  unrevoked, unexpired, unused invite references by name, and cleans the
  override rows for the deleted role.
- Defaults and overrides display. Env and yaml seed email-to-role grants
  only (`lib/auth/roles-config.ts:19-47`); they define no permission sets.
  The displayed defaults are always `defaultPermissionsForRank(rank)`
  (`lib/auth/permissions.ts:67-89`), and the overrides come from
  `role_permissions`. Each catalog key shows default state, effective
  state, and an override badge when a row exists. Reset to defaults deletes
  the role's override rows. No new env or yaml surface ships.
- Enforcement wiring. `requirePermission` currently checks bare rank
  defaults (`lib/auth/permissions-server.ts:60-73`) while the override
  merge feeds only the client permissions route
  (`app/api/auth/permissions/route.ts:50`). The batch B doctrine assumed a
  per-request cache (`docs/specs/015-permission-core.md:280-287`), but the
  shipped `requestCache` WeakMap is keyed on the queryable identity and
  production passes the process-lifetime pool, so the cache spans requests.
  Batch F drops the cache for the enforcement path instead of preserving
  the bug: every guarded call resolves the full role row and performs a
  fresh merge, rank defaults plus one indexed SELECT on
  `role_permissions.role_name`. The client permissions route consumes the
  same uncached resolver, so the client hook and the server guards agree,
  and no cross-request staleness is possible.
- The lockout guard. An administrator cannot mutate their own active role
  or their own assignment. `setUserRole` refuses when `grantedBy` equals the
  target user, mirroring the self-ban refusal
  (`lib/persistence/admin-users.ts:125-127`), and the roles PATCH and
  DELETE routes refuse any target that is the acting session's current
  role. This blocks the demote-to-lockout, the strip-`roles.manage`
  lockout, and self-upgrade lock-in in one symmetric rule. Assignment and
  role edits for other users and other roles proceed. The guard protects
  the ACTING role only. A delegated holder, a custom non-admin role with a
  `roles.manage` override, can still edit the system admin role's
  overrides and strip `users.manage` or `roles.manage` from real admins.
  That is accepted under the admin-trust model: anyone granted
  `roles.manage` is trusted with the admin surface, so delegated lockout
  is out of scope (see Out of Scope).
- Route gate shape. Every new admin role route gates `roles.manage` and
  wraps the guard call in the nested Response-rethrow catch, byte-for-byte
  the E pattern at `app/api/admin/users/route.ts:21-26` and `:37-40`, so
  the typed 403 survives both outer catch layers. The section hides on the
  client without `roles.manage`, and the page gate becomes `users.manage`
  OR `roles.manage`. A `roles.manage`-only holder reaches the page and the
  roles section together with the roles API routes, closing the stranding
  where the API was reachable but the page was not; users, invites, and
  courses sections stay intact for `users.manage` holders. The users
  routes keep their `users.manage` gate unchanged.
- The users picker goes live. `users-section.tsx` swaps its hardcoded role
  list (`components/admin/users-section.tsx:66-71`) for `GET
  /api/admin/roles`, keeping the current four roles as the failure
  fallback. Option values are role IDs, and the current-selection
  highlight resolves by ID through the fetched list, because `user.role`
  carries the role NAME (`lib/persistence/admin-users.ts:86`) and custom
  role ids are uuids, not names. This makes reassign-off-before-delete
  usable in one place.
- The includeDeleted fix. The route accepts `'1'` and `'true'` for the
  `includeDeleted` query, closing deviation (g)
  (`docs/specs/018-admin-suite.md:763-765`). The hardening is one line in
  `app/api/admin/courses/route.ts:29` plus the regression suite.
- New identifiers avoid the substrings "token" and "plan". `role`, `rank`,
  `override`, `reset`, and `catalog` ship clean. No file on the
  provider-neutrality guard list is touched, so no neutrality gate is
  added.
- New i18n keys ship in `en-US.json` as the source of truth under
  `admin.roles`. All keys get 12-locale parity
  (`docs/meta-specs/rbac-minimal-mode.md:229-231`).

## Testing Decisions

- New suites live under `tests/admin/` for the persistence, route, lockout,
  UI, RSC, audience, and includeDeleted families, and under `tests/permissions/`
  for the guard-wiring family. Root vitest picks up `tests/**/*.test.ts`
  and `.env.local` is not loaded, per the established hermetic setup.
- The env-clear prefix is the 016 canonical list, copied verbatim, on every
  vitest gate. `MINIMAL_MODE=true` is set inline only where a gate must
  exercise flag-on behavior, exactly as batch C and batch E did.
- The PIN-FROM-OUTLINE rule is the hard lesson of batches A, B, G, C, and
  E. Pin signatures after the code exists or from machine-extracted text,
  never from prose. The planned signatures above are plan-time prose. The
  builder replaces every pinned string with the byte-exact outline text
  after implementation.
- The live-wire-proof rule drives the real route stack. The pg, adversarial,
  RSC, and live-route gates seed real better-auth users, sessions, and role
  rows in a scratch database. `requirePermission`, `getSession`, the
  audience gates, and the persistence queries are never mocked. The batch B
  research update records why: a gate suite that mocks the seam under test
  proves nothing about that seam
  (`docs/specs/015-permission-core.md:392`).
- The hermetic unit suites seed a session fixture per route family. The
  roles-admin and roles-section suites mock `getSession` at the module
  boundary and return a session with the rank the family needs. The
  roles-persistence and guard-wiring unit suites need no session.
- The pg contract suites provision their own scratch database per the
  app-side precedent (`tests/agent-runtime/event-notify.pg.test.ts:58-72`)
  and fail closed without `PG_CONTRACT_URL`, which is intended for tier-3
  and tier-4 gates.
- The RSC real-cookie probe follows the batch E doctrine. Any page work
  needs a real-cookie wire proof in the gates
  (`docs/specs/018-admin-suite.md:789-790`). The probe signs real sessions
  through the better-auth sign-in API, exactly as
  `tests/admin/cold-boot-owner.pg.test.ts:111-148` does, then renders the
  page function in-process and drives it with real cookie bytes through
  the `next/headers` transport stub, the pattern
  `tests/admin/admin-page-gate.test.ts:170-208` ships. No server boots.
- The shipped `tests/admin/admin-page-gate.test.ts` suite stays certified.
  The 019 page delta adds the roles-section import to the real page, so
  that suite gains a roles-section mock beside the existing users, invites,
  and courses mocks, or proves the section renders under its mocks, keeping
  the 018 page gate green.
- The adversarial gates run the real handlers. The lockout gate proves the
  typed 403 for non-admins and the self-mutation refusals through the live
  guard. The live-route gate proves the override reaches the real generate
  route on the next request by toggling the SAME learner role in one test
  run on one server: baseline 403 `permission_denied`, grant then 400
  `MISSING_PROVIDER` (the guard passed), revoke then 403
  `permission_denied` again. Non-staleness, not first-resolution
  freshness, is the assertion.
- The i18n parity check runs wherever copy lands. New `admin.roles.*` keys
  get 12-locale parity.
- The neutrality guard's file list covers model routes and
  `server-provider.ts`, none of which this batch touches, so no neutrality
  gate is added. The new identifiers contain no token or plan segments and
  are clean by inspection.
- Plan-time state: the `tests/admin/roles-*`, `tests/admin/include-deleted-strict`,
  and `tests/permissions/guard-*` suites do not exist yet and fail with no
  marker until they do. These are the documented deliverable-dependent
  failures.
- The rank tie order is accepted. `listRoles` orders by rank ascending
  (`lib/auth/roles.ts:114`), and roles that share a rank order
  nondeterministically. The UI sorts by system flag first so the four
  system roles always lead.

## Out of Scope

- New permission strings. The catalog stays fixed at 11 keys. Toggling
  existing keys is the whole surface.
- Org-scoped or tenanted roles, per the program record
  (`docs/meta-specs/rbac-minimal-mode.md:278-284`).
- Role assignment cardinality. `user_roles.user_id` stays the primary key;
  a user holds exactly one role.
- Custom ranks above 4. The rank pick offers the four seeded ranks only,
  because unknown ranks resolve to empty defaults.
- Renaming or re-ranking system roles, and deleting any system role.
- Per-role quotas or spending limits.
- Delegated admin capability. A custom role holding `roles.manage` can
  edit system-role overrides, including the admin role's own permissions.
  This is accepted under the admin-trust model: anyone granted
  `roles.manage` is trusted with the admin surface. Restricting delegated
  holders from admin-role edits is out of scope.
- Bulk role operations and role cloning.
- Invite-role validation changes. Batch E invites accept a role name as
  shipped; custom roles become invitable through the existing free-text
  role field without new code. The only re-specced interaction is the
  delete guard: a role is undeletable while an unrevoked, unexpired,
  unused invite names it, so an invite can never grant nothing silently.
- UI restyling of the admin page beyond the new section.
- Any new operator env var. `.env.example` is untouched by this batch.

## Further Notes

- The program record is `docs/meta-specs/rbac-minimal-mode.md`. Batch F
  depends on B per the table (`docs/meta-specs/rbac-minimal-mode.md:267`)
  and certifies last in the sequence. Because E certifies before F
  verifies, this spec assumes the certified `/admin/settings` page, the
  `users.manage` guard, the types-admin route shape, and the admin i18n
  group. The inherited `users.manage` page guard becomes `users.manage` OR
  `roles.manage` in S4 (see Implementation Decisions); the API gates stay
  per-permission.
- The batch B research update is the wiring contract for S3. The guard
  change completes the seam B named but did not wire: overrides merged at
  `resolvePermissionSet` now reach `requirePermission` with the
  cross-request cache dropped, so the capability matrix and the toggles
  agree end to end and never stale
  (`docs/specs/015-permission-core.md:264-267`).
- Batch B masked the cache bug. The pg suite built a brand new pool per
  assertion with the comment "Use a fresh pool for cache isolation"
  (`tests/permissions/role-permissions.pg.test.ts:116-120`, `:128-132`,
  `:153-157`, `:177-181`, `:200-204`; the unit suite reuses one queryable
  at `:121-143`), and a fresh pool is a fresh WeakMap key, so the suite
  proved resolution freshness, never the process-lifetime pool identity
  production uses. GUARD_LIVE_OK's same-role toggle sequence exists
  because of that lesson: it is the regression guard for cross-request
  staleness.
- The RSC real-cookie doctrine from batch E applies to the page delta in
  S4. The probe design is pinned in S4 so a miswired cookie cannot pass
  the gate vacuously, mirroring the cold-boot expected-failure note
  (`docs/specs/018-admin-suite.md:412-418`).
- The visual-preview checkpoint runs before implementation. The roles
  section mockup renders in localhost and is approved in Safari first, per
  the program process rules (`docs/meta-specs/rbac-minimal-mode.md:296-299`).
- The batch E follow-on rides this batch per the rule that no new batch may
  defer work. `includeDeleted` strictness closes as the S5 hardening
  (`docs/specs/018-admin-suite.md:784`).
- The audience tiers need no gate change for custom roles. Rank alone
  drives visibility through `resolveViewerRank`
  (`lib/persistence/audience.ts:55-58`) and the read gate
  (`lib/persistence/document-access.ts:78-81`). A rank edit re-resolves
  visibility live, per Q12 (`docs/meta-specs/rbac-minimal-mode.md:169`).
- Commit convention for this batch: `feat(rbac): ...`

## Research Update (2026-09-06)

Batch F shipped in six slice commits: `1e97f846` (S1), `7c9b30e8` (S2),
`f7c45e56` (S3), `05cfb7bc` (S4), `a95c7c50` (S5), and `6543b106` (the S4
fix). Round 1 verified S1, S2, S3, and S5 and sent S4 back at `89c80ba4`.
Round 2 verified all five slices at `cc559681`, chain 83. This section
records what shipped, what deviated from the plan, and what the next work
inherits.

### What shipped

- The roles persistence core ships at `lib/persistence/admin-roles.ts`.
  `listRolesWithPermissions` at `:51-115` lists every role with its rank,
  system flag, the rank-derived default set, and the `role_permissions`
  override map. `createRole` at `:117-159` inserts a custom role with its
  initial overrides and refuses the reserved system names at `:49`.
  `updateRole` at `:161-222` renames, re-ranks, and replaces the override
  set in one transaction. `resetRoleOverrides` at `:224-230` deletes the
  override rows. `deleteRole` at `:232-286` refuses system roles, roles
  with attached users, and roles that an unrevoked, unexpired, unused
  invite names, then cleans the override rows. The rank uniqueness
  constraint drops through `RANK_CONSTRAINT_SQL` at
  `lib/auth/schema.ts:133-137`.
- The roles API ships at `app/api/admin/roles/route.ts` (GET `:16-46`,
  POST `:48-94`) and `app/api/admin/roles/[id]/route.ts` (PATCH `:34-130`,
  DELETE `:132-209`). Every route gates `roles.manage` and keeps the typed
  403 alive through the nested Response-rethrow catch. The self-lockout
  guard refuses mutation of the acting session's own role with code
  `SELF_LOCKOUT_REFUSED` at `:75`, `:85`, and `:157`. `setUserRole`
  refuses self-demotion at `lib/persistence/admin-users.ts:108-112`, and
  the users route converts that refusal to the typed 400 code
  `SELF_DEMOTE_REFUSED` at `app/api/admin/users/route.ts:72`. The same
  session edits other roles and other users without friction, so the
  cross-admin recovery path stays open.
- The stale-cache fix is the batch centerpiece. `requirePermission` at
  `lib/auth/permissions-server.ts:26-97` resolves the full role row at
  `:59-69` and checks the merged set from a fresh, uncached
  `resolvePermissionSet` call at `:88`. `resolvePermissionSet` at
  `:125-149` documents a fresh merge on every call at `:123`. The
  module-scoped `requestCache` WeakMap is gone. The live-route proof at
  `tests/permissions/guard-live-route.pg.test.ts:135-168` toggles the SAME
  learner role on one pool identity in one server process: baseline 403
  `permission_denied` at `:135-141`, grant then 400 `MISSING_PROVIDER` at
  `:143-155`, revoke then 403 again at `:157-168`, with a second toggle
  cycle at `:170-189`. No restart anywhere in the run.
- The roles section UI ships at `components/admin/roles-section.tsx`. The
  page gate becomes `users.manage` OR `roles.manage` at
  `app/admin/settings/page.tsx:27` and `:33`. The users picker fetches
  `/api/admin/roles` at `components/admin/users-section.tsx:66`, values
  options by role id at `:208`, and highlights the current selection by
  roleId at `:203`. Guard messages became stable codes plus i18n templates
  in the S4 fix `6543b106`. The `admin.roles` key group lands at
  `lib/i18n/locales/en-US.json:2208`.
- The audience probe ships at `tests/admin/roles-audience.pg.test.ts` and
  the `includeDeleted` hardening at `app/api/admin/courses/route.ts:29-33`.
  The corrected audit semantics hold: rank 2 is at or above audience 1, so
  the guest-audience boundary allows. The live STEP3 proof at
  `tests/admin/roles-audience.pg.test.ts:204-222` asserts `allow`, with
  the comment at `:220` recording rank 2 >= audience 1 => allow.

### Deviations and surprises

(a) The batch B per-request cache claim was false as shipped. The
pool-keyed `requestCache` WeakMap spanned requests, and production passed
the process-lifetime pool, so every merge read a frozen copy until a
restart. Batch B's own pg suite masked the bug with fresh pools per
assertion (`tests/permissions/role-permissions.pg.test.ts:116-120`,
`:128-132`), because a fresh pool is a fresh WeakMap key. The fix drops
the cache instead of building per-request machinery, and the doctrine is
recorded in the S3 postcondition.

(b) Three implementer rounds used a false skip excuse: `PG_CONTRACT_URL`
is not CI-only. Orchestrator runs proved every pg gate passes locally.
Doctrine: pg gates run here, always.

(c) The S2, S4, and S5 pg suites each shipped broken-then-fixed. S2
shipped a fixture that pointed `DATABASE_URL` at the wrong target,
inserted unsigned raw-token session rows, and omitted `emailVerified`; the
rewrite signs real sessions through the better-auth sign-in API
(`tests/admin/roles-lockout.pg.test.ts`). S4's `next/headers` mock missed
the `cookies` export; the shipped mock exports it at
`tests/admin/roles-rsc-probe.pg.test.ts:36-44` and feeds the real signed
cookie at `:197` and `:246`. S5 provisioned `stage_meta` before its
`document_stages` parent; the suite now creates `document_stages` first at
`tests/admin/roles-audience.pg.test.ts:50-68`.

(d) S4 was rejected at round 1: the picker compared `value=name` against
`options=ID`, so a uuid-id custom role rendered blank and the highlight
never matched. Every unit gate stayed green. Only the live UI caught it
(`docs/research/ui-after/34-picker-admin-r2.png`). This is the 018(a)
lesson again: client-state bugs need DOM-level live proof, not
`renderToString`.

(e) Guard messages leaked raw English. The S4 fix `6543b106` replaced
them with stable codes plus i18n templates, `SELF_LOCKOUT_REFUSED` and
`SELF_DEMOTE_REFUSED`, under the `admin.roles` group at
`lib/i18n/locales/en-US.json:2208`.

(f) The diff classifier reports "missing" for file-basename pins. The
scratch-ledger experiment proved it is a tool artifact, not a spec gap.

(g) The create form persists explicit denies for unchecked boxes. The
plan assumed absence meant default; the shipped semantics record a
`granted=false` row. Documented and accepted.

(h) Four pre-existing `Failed to load` fallback strings remain i18n
strays. The round-2 findings carry the report-only list.

### Test results

All 19 gates passed green at round 2. The final table is 19 of 19: S1 3,
S2 4, S3 4, S4 4, S5 4. The doubles ran clean and the fail-closed behavior
is proven: every pg gate throws without `PG_CONTRACT_URL`. The full suite
ran 7933 tests with 1 tolerated failure. The production build exits 0.
Safari shots 31-34 are console-clean, with `34-picker-admin-r2.png`
committed at the round-2 verdict. The live-wire matrices hold:
stale-cache (`tests/permissions/guard-live-route.pg.test.ts:135-168`),
audience (`tests/admin/roles-audience.pg.test.ts`), and lockout
(`tests/admin/roles-lockout.pg.test.ts`).

### Follow-on notes

- The runner-skills-registration env-dependent baseline is a pre-existing
  owed ticket. It predates this batch.
- The four `Failed to load` strays await an i18n sweep. See deviation (h).
- `settingsGated` gear visibility stays open from batch E
  (`docs/specs/018-admin-suite.md:785-788`).
- The RSC live-probe doctrine is proven twice now: 018(a) and 019(d).
  Future page work keeps the real-cookie wire probe in its gates.

### Program closeout

- All seven meta children certify after this batch. The RBAC program
  closes with the role editor shipped and the enforcement seam wired end
  to end.
- The S5 postcondition correction in this update is the honest research
  record: the guest-audience boundary allows for a rank-2 holder, proven
  live at `tests/admin/roles-audience.pg.test.ts:204-222`.
