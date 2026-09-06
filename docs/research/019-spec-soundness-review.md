# Batch 019 spec soundness review

Reviewer: independent spec-soundness reviewer (fresh eyes for 019; previously
reviewed batches 013, 014, 015, 016, 017, and 018). The reviewer did not write
the spec. Probes and gate dry-runs ran on 2026-09-07 against the working tree
at HEAD on `main`.

Reviewed documents:

- `docs/specs/019-role-permission-editor.md` (draft, batch F).
- Certified predecessors for context and anchors: `docs/specs/015` (batch B),
  `docs/specs/016` (batch C), `docs/specs/017` (batch D), `docs/specs/018`
  (batch E). Prior reviews `docs/research/016-spec-soundness-review.md` and
  `docs/research/018-spec-soundness-review.md` for shape and doctrine.
- `docs/meta-specs/rbac-minimal-mode.md` (Q-register, capability matrix,
  per-batch dependency row, process rules).
- Live sources probed: `lib/auth/permissions-server.ts`, `lib/auth/schema.ts`,
  `lib/auth/permissions.ts`, `lib/auth/roles.ts`, `lib/auth/roles-config.ts`,
  `lib/auth/invites.ts`, `lib/auth/index.ts`, `lib/auth/server.ts`,
  `lib/persistence/admin-users.ts`, `lib/persistence/audience.ts`,
  `lib/persistence/document-access.ts`, `lib/persistence/server-provider.ts`,
  `components/admin/users-section.tsx`, `app/admin/settings/page.tsx`,
  `app/api/auth/permissions/route.ts`, `app/api/admin/users/route.ts`,
  `app/api/admin/courses/route.ts`, `app/api/admin/invites/route.ts`,
  `app/api/generate/image/route.ts`,
  `tests/permissions/role-permissions.pg.test.ts`,
  `tests/permissions/role-permissions.test.ts`,
  `tests/admin/cold-boot-owner.pg.test.ts`,
  `tests/admin/admin-page-gate.test.ts`,
  `tests/minimal-mode/live-wire.pg.test.ts`,
  `tests/providers/provider-neutrality-guard.test.ts`, and a `psql` probe of
  the live dev database for the `roles` constraints.

Method: file-to-line existence checks against live source, symbol signature
comparisons, env-prefix byte comparison against the 018 gate text, a live
`psql` constraint probe, a WeakMap lifetime trace through the shipped caller
chain, gate dry-runs from the repo root with the exact `unset` prefixes
(presented below), and tier re-count from the spec file. No code changed and
no gate suite ran. Only this file was created.

## Verdict

**Approve-after-fixes.** One blocker. B1 is the enforcement-wiring promise:
the spec says an override reaches route guards on the very next request
because `resolvePermissionSet` caches per request, but the shipped cache is
keyed on the module-cached pool and lives for the process lifetime in
production. The S3 postcondition cannot hold as written, and the GUARD_LIVE_OK
gate cannot detect the failure because it resolves each role once per process.
Everything else holds. The contract cites, the rank-drop migration, the
lockout guard shape, the tier counts, and all 19 gate dry-runs are correct.

## BLOCKERS

### B1. The enforcement-wiring promise rests on a cache that is process-global in production.

The S3 postcondition says a `role_permissions` grant "lets a learner pass the
real image generate route guard under MINIMAL_MODE on the very next request"
and that "the per-request WeakMap cache means the change applies from the next
request and never stales across requests" (`019:239-246`). The
Implementation Decisions repeat the claim (`019:394-398`). The shipped code
does not deliver it.

`resolvePermissionSet` caches in the module-scope `requestCache` WeakMap at
`lib/auth/permissions-server.ts:19`. The cache keys on the `queryable`
identity (`:110-116`, `:138`). The only production caller is the client
permissions route, which passes the app's cached pool
(`app/api/auth/permissions/route.ts:22` and `:50`). `getServerPersistenceProvider`
caches that exact pool object for the process lifetime behind a
`Symbol.for` global (`lib/persistence/server-provider.ts:31-35`, `:72-93`).
WeakMap entries live as long as their key lives. The key is the pool. The
pool lives as long as the process. Therefore a role's merged set is computed
once per process and every later request reads the frozen stale copy until a
process restart or a provider reset. The cache spans requests. It is not per
request.

The batch B verification never saw this because the pg suite builds a brand
new pool for every assertion with the comment "Use a fresh pool for cache
isolation" (`tests/permissions/role-permissions.pg.test.ts:116-120`,
`:128-132`, `:153-157`, `:177-181`, `:200-204`). A fresh pool is a fresh
WeakMap key. The production pool identity is never exercised. The unit cache
suite (`tests/permissions/role-permissions.test.ts:121-143`) uses one
queryable twice and cannot see the staleness either. The doctrine at
`docs/specs/015-permission-core.md:280-287` assumed a per-request queryable.
The wiring never provided one.

The S3 change makes the guard call this same resolver with the same cached
pool, so route guards inherit the stale cache. The result is user story 7
inverted: a toggled permission changes nothing until the process restarts.
And GUARD_LIVE_OK as sequenced cannot catch it. The gate grants
`course.create` to a learner, drives the route once, then revokes a creator
default and drives the route once for the creator. Both roles resolve for
the first time in that process, so both reads are fresh. The gate passes
even with the stale-cache bug present. Verification would certify a broken
seam, the same failure class as 015 deviation (a).

Fix, two sentences in S3: key the permission cache to true request scope (a
per-request queryable wrapper or an explicit clear on each guarded call) or
drop the cache for the `requirePermission` path, and make GUARD_LIVE_OK drive
the SAME role twice across a toggle (grant then drive, revoke then drive the
same learner) so the gate asserts non-staleness instead of first-resolution
freshness.

## CONCERNS

### C1. The RSC probe does not pin its transport mechanics.

The S4 gate is a vitest gate with the env-clear prefix and no server boot
(`019:303`). It cannot assume a running dev server, and none is started. The
probe must render the page in-process, exactly as the shipped
`admin-page-gate.test.ts` does (`:170-208`, `renderToStaticMarkup` over the
page function), with a `next/headers` transport stub that returns the REAL
signed cookie captured from the better-auth sign-in (the `createSignedSession`
recipe at `tests/admin/cold-boot-owner.pg.test.ts:111-148` is the right
model). "Never mocks getSession or the page guard" is satisfiable only
because the transport stub carries the real cookie bytes. State that one
sentence. Without the pin, a server-spawning reading of "drives
/admin/settings with real cookies" fails at verification.

### C2. The users-route self-demote refusal would surface as a 500.

S2 pins `setUserRole` to refuse when `grantedBy === userId`, mirroring the
self-ban refusal (`019:186`). The self-ban refusal converts its Error to a
typed 400 in the route at `app/api/admin/users/route.ts:84-89`. The new
`setRole` refusal has no pinned conversion, and the users-route outer catch
rethrows plain Errors (`:99-102`). Without one line in S2, the lockout gate
asserts "an admin cannot demote their own assignment" against a raw 500, and
the users route is not in the S2 binding list so the delta is easy to miss.
Pin the Error-to-Response conversion next to the self-ban block.

### C3. The existing admin-page-gate suite is untracked in S4.

`tests/admin/admin-page-gate.test.ts` imports the real page (`:161`, `:170`,
`:205`) and mocks only the three existing sections. The S4 page delta adds a
real `RolesSection` import. Under that suite's mocks the section must import
cleanly and render without server-only dependencies or effect-time fetches.
The spec does not pin the admin-page-gate delta, so the shipped 018 gate can
regress silently. One sentence in S4: add the roles-section mock to that
suite or prove the section renders under its mocks.

### C4. The GUARD_LIVE_OK pass assertion is unpinned.

With no image provider configured, a learner that passes the guard receives
`MISSING_PROVIDER` 400 from the route (`app/api/generate/image/route.ts:67-69`),
and a blocked caller receives `permission_denied` 403. Pin those two expected
responses in the gate text. The current prose ("asserts the learner passes")
is satisfiable by any non-403 status and would not discriminate a miswired
flag read.

### C5. The users picker current-role highlight breaks for custom roles.

The select value is `user.role`, which is the role NAME from
`lib/persistence/admin-users.ts:86`. The option values are role IDs
(`components/admin/users-section.tsx:181-189`). System roles work because id
equals name (`lib/auth/roles.ts:49-55` seeds id from name). Custom roles get
uuid ids, so the current role renders as a blank selection. One sentence in
S4 covers the cosmetic consequence of the picker delta.

### C6. The lockout guard protects the acting role, not the admin role.

The self-refusal compares the target role against the acting session's
current role. A custom non-admin role that holds a `roles.manage` override
can edit the system admin role's permissions and strip `users.manage` or
`roles.manage` from every real admin. The spec deliberately keeps system role
permissions editable (`019:375-381`), so the capability exists by design.
State the trust boundary in the spec. The current sentence "blocks the
demote-to-lockout and the strip-`roles.manage` lockout in one symmetric rule"
(`019:399-406`) reads as if the guard closes all lockouts, which it does not
for a delegated holder. Related asymmetry: the page keeps the `users.manage`
guard, so a `roles.manage`-only holder owns the API routes but sees only the
not-authorized page.

## Open questions answered

### 1. Is dropping `roles_rank_key` safe on the live dev database?

Yes. A `psql` probe of the dev database shows `roles_rank_key` exists as a
unique constraint today, alongside `roles_name_key`. The proposed
`ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_rank_key` is the correct
Postgres name for the auto-named column constraint, idempotent on every boot,
and safe in the lazy ensure chain next to the ban-column ALTERs
(`lib/auth/schema.ts:127-131`). A repository grep finds no code reference to
`roles_rank_key` anywhere outside the spec. The system-role seed upserts by
name (`ON CONFLICT (name)`, `lib/auth/roles.ts:50-55`), not by rank, so the
drop changes no boot path. `listRoles` orders by rank ascending
(`lib/auth/roles.ts:114`); ties then order non-deterministically, which the
spec accepts with the system-first UI sort.

### 2. Can the only admin self-lock, and is the role guard symmetric with the ban refusal?

No self-lockout path remains after S2. The three lockout paths are refused:
self-demote through the users route (`setUserRole` refuses when
`grantedBy === userId`, the new mirror of the ban refusal at
`lib/persistence/admin-users.ts:125-127`), self-strip of `roles.manage`
through the roles PATCH route, and self-delete of the acting role through the
roles DELETE route. The ban side is symmetric and already shipped: an admin
cannot ban themselves (`admin-users.ts:125-127`). The delete guard also
refuses any role with an attached `user_roles` row, so a second admin cannot
delete a colleague's custom role out from under them. The remaining risk is
delegation, not self-mutation, and is covered in C6.

### 3. What does an invite for a deleted custom role grant at signup?

Nothing, silently. `createInvite` validates the role name at creation time
(`isValidRole`, `app/api/admin/invites/route.ts:50`). The grant runs in the
better-auth `user.create.after` hook, which consumes the invite and then
inserts the role with `INSERT INTO user_roles ... SELECT $1, id, now() FROM
roles WHERE name = $2` (`lib/auth/server.ts:119-124`). When the role was
deleted after the invite was created, the SELECT matches no row, nothing is
inserted, and the user lands at rank 0. The no-invite and concurrent-consume
branches fall back to guest (`:128-143`), but the named-role branch does not.
`deleteRole` refuses roles with attached users only, never pending invites.
The spec defers this interaction explicitly (`019:497-499`). One line closes
it either way: refuse delete while a pending invite references the name, or
fall back to guest when the role lookup misses.

## VERIFIED-OK

- Contract cites, checked against live source:
  - `requirePermission` resolves only the rank and checks plain defaults at
    `lib/auth/permissions-server.ts:60-73`, with the ban check above at
    `:40-58`. Exact. `resolvePermissionSet` spans `:105-140`, the WeakMap at
    `:19` and the lookup at `:110-116`. Exact. The only production merge
    consumer is `app/api/auth/permissions/route.ts:50`. Exact. The route
    resolves the full role row at `:25-49`, so the "full role row" pattern
    S3 pins already has a live model.
  - `lib/auth/schema.ts:70-77` roles table with `rank INTEGER NOT NULL
    UNIQUE` at `:73`, `role_permissions` at `:90-95`, the ban-column lazy
    ALTER precedent at `:127-131`, `ensureAuthSchema` at `:138-148`. Exact.
  - `lib/persistence/admin-users.ts:100-112` `setUserRole` with no self
    check, `:125-127` the self-ban refusal. Exact.
  - `lib/auth/permissions.ts:13-24` the 11-key catalog, `:43-55`
    `PERMISSION_CATALOG`, `:67-89` rank defaults, `:86-88` the empty default
    for unknown ranks. Exact.
  - `components/admin/users-section.tsx:66-71` the hardcoded four-role
    picker. Exact.
  - `app/admin/settings/page.tsx:20-28` the `users.manage` guard, `:34-46`
    the not-authorized state, `:60-78` the three sections. Exact. The page
    renders sections unconditionally under one guard. The 019 roles section
    is the first client-gated section, which the spec states correctly.
  - `app/api/admin/users/route.ts:21-26` and `:37-40` the nested
    Response-rethrow, `:84-89` the SELF_BAN_REFUSED conversion, `:99-102`
    the outer catch. Exact. The 019 role routes pin the same passthrough, so
    the 018 B1 class is adopted this time.
  - `app/api/admin/courses/route.ts:29` the strict `'true'` parse. Exact.
  - `app/api/generate/image/route.ts:48-54` the flag-gated guard. Exact.
  - `lib/persistence/audience.ts:55-58` the rank join, and
    `lib/persistence/document-access.ts:78-81` the `viewerRank < audience`
    read gate. Exact. A custom rank-2 role inherits the learner tier with no
    gate change, as the spec claims.
  - `lib/auth/roles.ts:31-36` the four system roles, `:103-124` `listRoles`
    ordered by rank at `:114`. Exact. `lib/auth/roles-config.ts:19-47` the
    env and yaml email grants with no permission surface. Exact.
  - `lib/auth/index.ts:39-41` `resetAuth`, `:76-102` the getSession retry,
    so the 018 B2 cold-boot seam is closed and the 019 S4 probe can rely on
    it. Exact.
- Spec anchors: `docs/specs/018-admin-suite.md:729-734` the RSC empty-headers
  lesson, `:763-765` deviation (g), `:784` the includeDeleted follow-on,
  `:789-790` the real-cookie RSC doctrine. All exact, and 019 rides all four.
  `docs/specs/015-permission-core.md:280-287` the cache doctrine and `:392`
  the live-wire-proof rule. Exact. Meta-spec anchors: Q8 at `:165` the 11-key
  catalog, Q12 at `:169` the rank model and the delete-requires-reassign
  rule, the matrix row at `:211`, the i18n parity rule at `:229-231`, the
  gate marker rule at `:245-250`, the batch F dependency row at `:267`, the
  process rules at `:296-299`. All exact.
- The env-clear prefix at `019:112` matches the byte-identical text at
  `018:107`, which the 018 review tied to the 016 canonical list.
- Gate dry-runs (exact commands, repo root, on 2026-09-07):
  - S1 unit `roles-persistence.test.ts`: exit 1, no marker. Suite absent,
    plan-time RED as documented.
  - S1 integration `roles-persistence.pg.test.ts`: exit 1 at the PG guard,
    no marker. Fail-closed RED.
  - S2 unit `roles-admin.test.ts`: exit 1, no marker. Suite absent.
  - S2 adversarial `roles-lockout.pg.test.ts`: exit 1 at the PG guard, no
    marker. Fail-closed RED.
  - S3 unit `guard-override-wiring.test.ts`: exit 1, no marker. Suite
    absent.
  - S3 integration `guard-override-wiring.pg.test.ts`: exit 1 at the PG
    guard, no marker.
  - S3 adversarial `guard-live-route.pg.test.ts` with `MINIMAL_MODE=true`
    inline: exit 1 at the PG guard, no marker. Fail-closed RED.
  - S4 unit `roles-section.test.ts`: exit 1, no marker. Suite absent.
  - S4 integration `roles-rsc-probe.pg.test.ts`: exit 1 at the PG guard, no
    marker.
  - S5 unit `roles-audience.test.ts`: exit 1, no marker. Suite absent.
  - S5 integration `roles-audience.pg.test.ts`: exit 1 at the PG guard, no
    marker.
  - S5 unit `include-deleted-strict.test.ts`: exit 1, no marker. Suite
    absent.
  - S2 and S4 i18n `pnpm check:i18n-keys && echo I18N_OK`: exit 0, `I18N_OK`
    echoed. Parity passes today with no new keys.
  - The five identical smoke gates `npx tsc --noEmit && echo TSC_OK`: exit
    0, `TSC_OK` echoed (run once, textually identical).
  - All 19 gates accounted for. No false marker. Every marker is a short
    literal under the expectation cap.
- Tier compliance: S1 tier 3 with 3 gates and the integration tag on
  ROLES_CORE_PG_OK. S2 tier 4 with 4 gates and the adversarial tag on
  ROLES_LOCKOUT_OK. S3 tier 4 with 4 gates and the adversarial tag on
  GUARD_LIVE_OK. S4 tier 3 with 4 gates and the integration tag on
  ROLES_RSC_OK. S5 tier 3 with 4 gates and the integration tag on
  ROLE_AUDIENCE_PG_OK. The 018 C3 tier shortage does not recur.
- Adversarial shape: ROLES_LOCKOUT_OK drives the real routes with real
  seeded sessions and refuses the three self-lockout paths. GUARD_LIVE_OK
  drives the real generate route under the flag with a real session and a
  real database, in-process like the 016 live-wire suite
  (`tests/minimal-mode/live-wire.pg.test.ts:134-152`). No gate spawns a
  server and none assumes port 3000. ROLES_RSC_OK uses the cold-boot sign-in
  recipe, pending the C1 transport pin.
- Constraint hygiene: new identifiers `role`, `rank`, `override`, `reset`,
  and `catalog` carry no "token" or "plan" segments. No file on
  `PROVIDER_NEUTRAL_FILES` is edited (`tests/providers/provider-neutrality-guard.test.ts:58-90`;
  the image route and `server-provider.ts` are on the list but unchanged).
  The neutrality claim holds. The catalog stays at 11 keys. i18n gates sit in
  both slices where new keys land, so the 018 C5 gap does not recur.

## Could not verify

- The fixtures of the unwritten `tests/admin/roles-*`,
  `tests/admin/include-deleted-strict`, and `tests/permissions/guard-*`
  suites. C3's admin-page-gate impact is asserted from the live suite
  structure, not a fixture.
- The response shapes of the new route self-refusals. Plan-time prose only
  (C2).
- Whether the GUARD_LIVE_OK pass drive resolves to `MISSING_PROVIDER` in
  every runner environment. The spec must pin the expected status (C4).
- The roles-section visual-preview mockup. The program defers it to the
  Safari checkpoint before implementation.