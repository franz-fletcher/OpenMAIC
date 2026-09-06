# Batch 018 spec: admin-suite

Spec status: research_update

## Problem Statement

Admins have permissions but no admin surface. The account menu renders an
Admin entry that leads nowhere, and the Settings entry is a stub with a
"soon" badge. From the operator view the consequences are concrete.

- The account zone gates a Settings entry by `settings.manage` and an Admin
  entry by `users.manage`, but neither button has a destination
  (`components/account-zone.tsx:50-68`). The Admin entry is a dead end.
- There is no way to see who signed up, what role anyone holds, or whether an
  address is verified. The `user`, `user_roles`, and `roles` tables hold the
  data (`lib/auth/schema.ts:13-84`), but no read surface exists.
- There is no way to assign a role after signup. The only grant path is the
  env and yaml seed (`lib/auth/roles.ts:64-95`) and the guest default hook
  (`lib/auth/server.ts:71-94`). Promotion beyond guest is impossible today.
- There is no way to revoke access for an abusive account. The user table has
  no ban state and the batch A server wires no admin plugin
  (`lib/auth/schema.ts:13-21`, `lib/auth/server.ts:57-98`).
- There is no invite path. The decision register pins a hand-rolled
  `invites` table, one create route, one accept page, and one email template
  for batch E (`docs/meta-specs/rbac-minimal-mode.md:159`), and the batch A
  mailer was built invite-agnostic for this batch
  (`docs/specs/013-rbac-auth-foundation.md:412`).
- The settings dialog surface is ungated. Batch C gated only the verify probes
  and deferred the dialog itself to batch E
  (`docs/specs/016-minimal-mode-gating.md:504-505`). The provider config
  routes are also deferred (`docs/specs/016-minimal-mode-gating.md:397`).
- Two items are owed to batch E from batch D. The classroom-media byte server
  still serves any file with `public, max-age=86400, immutable` and no
  audience check, so draft-stage media stays readable by anyone holding the
  path (`docs/specs/017-publishing-visibility.md:465-476`). A cold-boot
  transient wrote `anon:` as the owner on a real session on the first PUT
  after boot, and batch D owes the probe
  (`docs/specs/017-publishing-visibility.md:629-631`).
- The capability matrix promises admin-only settings and admin user
  management, but nothing enforces those rows
  (`docs/meta-specs/rbac-minimal-mode.md:211-212`).

## Solution

Batch E ships a full admin settings page at `/admin/settings`, gated by
`users.manage`. The page has three server-verified sections: user management,
invites, and course administration. User management lists users with role,
verification, and ban state, assigns the single role per user, and bans or
deactivates accounts with session revocation. Invites create a single-use
code for an email and role, send the accept link through the existing mailer
transports, and grant the invited role on the verified signup. Course
administration lists every course with owner, status, audience, and publish
date, and surfaces the batch D unpublish-any override plus a new admin
delete-any route.

The provider settings dialog stays a modal for provider config, exactly as
the batch A work shipped it. Batch E gates that surface to `settings.manage`
under `MINIMAL_MODE` and leaves flag-off behavior untouched. The account zone
entries become real: Settings opens the provider dialog, Admin navigates to
the admin page.

Batch E also closes the two owed seams. The classroom-media route gains the
audience gate under `MINIMAL_MODE` with cache headers that stop claiming
public immutability, and the cold-boot transient gains a regression probe
plus a hardening fix in the session resolution path.

## User Stories

1. As an operator, I want the Admin account entry to open an admin settings
   page, so that user management is reachable with one click.
2. As an operator, I want to see every user with email, verification state,
   role, and join date, so that I know who is in the system.
3. As an operator, I want to search and filter the user list, so that a large
   directory stays usable.
4. As an operator, I want to assign any user any existing role, so that
   promotion beyond guest does not require env re-seeding.
5. As an operator, I want to ban a user and have their sessions die
   immediately, so that a revoked account cannot keep acting.
6. As an operator, I want to invite an email to a role with an expiry, so
   that a new user lands at the right capability after verification.
7. As an invited person, I want the accept page to prefill my signup and
   grant my invited role on the first verified sign-in, so that the flow is
   one form.
8. As an operator, I want to list pending invites and revoke one, so that a
   bad email address stops working instantly.
9. As an operator, I want an admin course table with owner, status, audience,
   and publish date, so that I can see and control every course.
10. As an admin, I want to unpublish and delete any course, so that a course
    is not hostage to its creator.
11. As a verifier, I want media bytes served only when the viewer passes the
    course audience rule under the flag, so that the second deferral closes
    without a leak.
12. As a verifier, I want a cold-boot probe that proves the first authenticated
    PUT writes the owned stage meta, so that the transient cannot regress
    silently.

## Slices

Each slice lists the ledger bindings, before-state notes, postcondition, and
gate inventory. New symbols pin their intended declaration text at plan time.
After implementation the builder re-pins byte-exact from machine-extracted
outline text, per the PIN-FROM-OUTLINE rule in Testing Decisions.

The env-clear prefix is the 016 canonical list, copied verbatim, including
the two batch C variables:

`unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE;`

The invite-mailer gates extend the prefix with the batch A mailer variables
(`MAIL_TRANSPORT AUTH_SECRET RESEND_API_KEY SMTP_HOST SMTP_PORT SMTP_USER
SMTP_PASS MAIL_FROM`), exactly as 013 S05 does. Gates that exercise flag-on
behavior set the relevant variable inline instead, per the 016 pattern.

Hermetic unit suites run without `PG_CONTRACT_URL`, where `getSession`
returns null through the catch path and every guarded call would look
anonymous. Each unit gate family seeds its own session fixture. The
users-admin, invites, admin-courses, and media-gate suites mock
`getSession` at the module boundary and return a session with the rank the
family needs. The admin-page suite stubs the permission hook at the
component boundary. The invite-mailer suite needs no session. The
cold-boot-session suite stubs the provider and auth bootstrap seams and
never mocks `getSession` itself, because it exercises the readiness
hardening. The pg and adversarial gates never mock `getSession`: they seed
real better-auth sessions in the scratch database, and the guard and
enforcement seams stay real.

### S1 Admin settings page and account navigation

Delivers: the gated admin page shell, the account-zone navigation delta, the
settings-dialog wiring, and the new i18n keys.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/admin/settings/page.tsx::AdminSettingsPage` | function | `()` | new: server component that enforces `users.manage`, resolves the locale, renders the three admin sections, no tenancy leaks, catches the guard throw and renders a dedicated not-authorized state instead of letting the `Response` reach the error boundary |
| `components/account-zone.tsx::AccountZone` | function | `({ onSignOut, onOpenSettings, onOpenAdmin }: AccountZoneProps)` | modified: Settings entry calls `onOpenSettings`, Admin entry calls `onOpenAdmin`, the `soon` badge leaves the Settings entry; the two new props ship optional |
| `components/header-capsule.tsx::HeaderCapsule` | function | `({ onSettingsOpen, accountSlot, settingsGated }: HeaderCapsuleProps)` | modified: hides the settings gear for non-`settings.manage` ranks under the client mirror, keeps today's visibility off; the new `settingsGated` prop ships optional |
| `components/admin/users-section.tsx` | file | client section for the user table | new: search, role picker, ban toggle |
| `components/admin/invites-section.tsx` | file | client section for the invite table | new: create invite form, list, revoke |
| `components/admin/courses-section.tsx` | file | client section for the course table | new: status, audience, publish, delete actions |
| `tests/minimal-mode/minimal-layout.test.ts` | file | suite | modified: keeps rendering the real `AccountZone` (`:161-163`) and the real `HeaderCapsule` (`:240-245`, `:257-262`, `:276-281`); stays green because the new S1 props ship optional, so root `tsc --noEmit` keeps passing across every smoke gate |
| `lib/i18n/locales/en-US.json` | file | new `admin` group | modified: source-of-truth keys for the page, sections, and actions |

Before-state capture notes: `AccountZone` has no destination props. The
menu block spans `components/account-zone.tsx:44-68`, with the Settings
gate at `:50` and the Admin gate at `:61`, both dead buttons. The
`onSettingsOpen` prop on `HeaderCapsule` is the gear handler
(`components/header-capsule.tsx:26-33`), and the gear itself is ungated at
`:124-132`. `HomePage` renders the `HeaderCapsule` at `app/page.tsx:741`
and hosts the `SettingsDialog` at `:742-749`. The locale
keys `auth.account.settings`, `auth.account.admin`, and `auth.common.soon`
exist at `lib/i18n/locales/en-US.json:2047-2062`. The settings section union
lives at `lib/types/settings.ts:3-14`.

Postcondition: a holder of `users.manage` reaches `/admin/settings` and sees
the three sections. A denied rank receives the typed 403 and sees no page
content: the page catches the guard throw and renders a dedicated
not-authorized state, so the `Response` never reaches the error boundary.
The account menu Admin entry navigates, the Settings entry opens the
provider dialog, and the `soon` badge is gone from Settings. Under the client
mirror the gear hides for non-holders and flag-off keeps today's gear. The
new account and capsule props ship optional, so
`tests/minimal-mode/minimal-layout.test.ts` keeps compiling and passing
unchanged. All new strings pass the 12-locale parity check. The page renders
in Safari.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/admin-page-gate.test.ts && echo ADMIN_PAGE_OK` expects `ADMIN_PAGE_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 2. Required Safari checkpoint: the admin settings page and the
account menu delta.

### S2 User management: list, search, role assign, and ban

Delivers: the user listing query, the single-role assigner, the ban state on
the user table, session revocation, the enforcement points, and the client
section.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/auth/schema.ts::ensureAuthSchema` | function | `(queryable: Queryable): Promise<void>` | modified: appends the ban columns to the `user` table |
| `lib/persistence/admin-users.ts::listUsers` | function | `(queryable: Queryable, filter?: { query?: string; roleName?: string; banned?: boolean }): Promise<AdminUser[]>` | new: joins `user`, `user_roles`, and `roles`, returns email, verified, role, rank, banned, created, never password data |
| `lib/persistence/admin-users.ts::setUserRole` | function | `(queryable: Queryable, userId: string, roleId: string, grantedBy: string): Promise<void>` | new: upserts the single `user_roles` row |
| `lib/persistence/admin-users.ts::setUserBanned` | function | `(queryable: Queryable, userId: string, banned: boolean, reason?: string): Promise<void>` | new: writes the ban columns and revokes every session for the user |
| `lib/auth/permissions-server.ts::requirePermission` | function | `(headers: Headers, permission: Permission): Promise<Session>` | modified: denies banned sessions with the typed 403 code `banned` |
| `lib/persistence/audience.ts::resolveViewerRank` | function | `(queryable: Queryable, ownerId: string): Promise<number>` | modified: returns 0 for banned users so every rank-based gate revokes them |
| `app/api/admin/users/route.ts::GET` | function | `(req: NextRequest): Promise<Response>` | new: gated `users.manage`, returns the filtered user list, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `app/api/admin/users/route.ts::PATCH` | function | `(req: NextRequest): Promise<Response>` | new: gated `users.manage`, applies role or ban mutations, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `components/admin/users-section.tsx` | file | see S1 | modified: search input, role picker, ban toggle wired to the routes |

Before-state capture notes: the user table ends at the `updatedAt` column
(`lib/auth/schema.ts:13-21`) with no ban state. `requirePermission` resolves
only the rank at `lib/auth/permissions-server.ts:40-57`. `resolveViewerRank`
skips any ban check (`lib/persistence/audience.ts:31-46`). The `user_roles`
primary key is `user_id` (`lib/auth/schema.ts:79-84`), so a user holds
exactly one role and assignment is an upsert. The rank query
`lib/auth/permissions-server.ts:43-46` is the model for adding the ban check.

Postcondition: an operator lists users with search and filter, assigns one
role per user, and bans or un-bans a user. A banned user loses every session
immediately, receives the typed 403 with code `banned` from any guarded call,
and resolves to rank 0 on every rank gate. The typed 403-body assertions
depend on the pinned Response-rethrow passthrough, because the two outer
catch layers would flatten the throw to a 500 without it. An admin cannot ban
their own session. The identity never renders in the UI. The section renders in Safari.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/users-admin.test.ts && echo USERS_ADMIN_OK` expects `USERS_ADMIN_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/users-admin.pg.test.ts && echo USERS_ADMIN_PG_OK` expects `USERS_ADMIN_PG_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/ban-adversarial.pg.test.ts && echo BAN_ADV_OK` expects `BAN_ADV_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 4. The adversarial gate drives the real routes and the real
guard stack: it bans a live user, asserts the revoked session dies, asserts
the banned user gets code `banned` on a guarded call and rank 0 on the
read gate, and asserts a non-admin never reaches the admin routes. Only
`getSession` is seeded for fixtures. The guard and enforcement are never
  mocked.

### S3 Invite by email: create, send, accept, and revoke

Delivers: the `invites` table, the invite service, the mailer extension, the
create and list and revoke routes, the accept page, the verified-grant hook,
and the i18n keys.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/auth/schema.ts::ensureAuthSchema` | function | `(queryable: Queryable): Promise<void>` | modified: composes the `invites` table into the ensure chain |
| `lib/auth/invites.ts::createInvite` | function | `(queryable: Queryable, email: string, roleName: string, createdBy: string, expiresAt: Date): Promise<Invite>` | new: writes one row with a single-use code, returns it |
| `lib/auth/invites.ts::consumeInvite` | function | `(queryable: Queryable, code: string, userId: string): Promise<string | null>` | new: atomically marks one unused, unexpired row used and returns the invited role, null otherwise |
| `lib/auth/invites.ts::listPendingInvites` | function | `(queryable: Queryable): Promise<Invite[]>` | new: lists unused, unrevoked, unexpired rows |
| `lib/auth/invites.ts::revokeInvite` | function | `(queryable: Queryable, id: string): Promise<void>` | new: writes the revoked state so the link dies |
| `lib/auth/mailer.ts::Mailer` | interface | `{ transport; sendVerificationLink; sendInviteLink }` | modified: adds the invite send across all three transports with the same DI seam |
| `app/api/admin/invites/route.ts::POST` | function | `(req: NextRequest): Promise<Response>` | new: gated `users.manage`, validates email and role, creates and sends the invite, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `app/api/admin/invites/route.ts::GET` | function | `(req: NextRequest): Promise<Response>` | new: gated `users.manage`, returns pending invites, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `app/api/admin/invites/[id]/route.ts::DELETE` | function | `(req: NextRequest, { params }: Params)` | new: gated `users.manage`, revokes one invite, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `app/invite/accept/page.tsx::Page` | function | `()` | new: validates the code, prefills the signup form, renders the invited role and expiry |
| `lib/auth/server.ts::createAuthServer` | function | `(options: AuthServerOptions): AuthServer` | modified: the user-create hook consumes a valid invite before the guest default and grants the invited role in the same transaction |
| `lib/i18n/locales/en-US.json` | file | new `invite` group | modified: source-of-truth keys for the flow |

Before-state capture notes: the schema text ends at the `quiz_grade_quota`
table (`lib/auth/schema.ts:99-104`). The mailer interface exposes only
`sendVerificationLink` (`lib/auth/mailer.ts:19-22`). The guest default hook
inserts guest for every new user (`lib/auth/server.ts:71-94`). The signup
pages render the batch A flow (`app/signup/page.tsx::Page`). No `invites`
table and no invite route exist.

Postcondition: an admin creates an invite for an email and role with a
default expiry, the mailer sends the accept link through console, smtp, or
resend, and the pending list shows it. The accept page prefills the email.
The user-create hook consumes the invite and grants the invited role in the
same transaction at user creation, before email verification. The grant stays
inert until the first verified sign-in because no session exists before
verification, and an invited email that never verifies still consumes the
invite, an operational cost, not a leak. A second use, an expired invite, and
a revoked invite all render the invalid state and grant nothing. The mailer
keeps its flag-off console behavior. The flow renders in Safari.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/invites.test.ts && echo INVITES_OK` expects `INVITES_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE MAIL_TRANSPORT AUTH_SECRET RESEND_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM; pnpm test tests/admin/invite-mailer.test.ts && echo INVITE_MAILER_OK` expects `INVITE_MAILER_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/invites.pg.test.ts && echo INVITES_PG_OK` expects `INVITES_PG_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/invite-race.pg.test.ts && echo INVITE_RACE_OK` expects `INVITE_RACE_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate drives the real invite create, the real
signup, the real verified-session hook, and asserts the invited role lands
in `user_roles` and the invite row is used. The single-use and expiry paths
run against the scratch database, never against a mocked consume. The race
gate mirrors the batch C `QUOTA_RACE_OK` precedent
(`docs/specs/016-minimal-mode-gating.md:289`): it fires N concurrent accepts
against the real hook and asserts exactly one role grant and one used row,
with the consume and the role insert sharing one client transaction.

### S4 Course administration list and delete-any

Delivers: the admin course list query, the admin delete route, and the
section that surfaces the batch D unpublish-any override.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/persistence/admin-courses.ts::listAllCoursesForAdmin` | function | `(queryable: Queryable): Promise<AdminCourse[]>` | new: joins `stage_meta` and `document_stages`, left-joins `user` for the owner email, returns owner, status, audience, publish date, deleted state |
| `lib/persistence/admin-courses.ts::deleteCourseForAdmin` | function | `(queryable: Queryable, stageId: string, ownerId: string): Promise<void>` | new: deletes the document row through the owner scope so the cascade removes children and `stage_meta` |
| `app/api/admin/courses/[id]/route.ts::DELETE` | function | `(req: NextRequest, { params }: Params)` | new: gated `requirePermission(headers, 'course.delete')` plus an explicit rank-4 check, resolves the owner from stage meta, deletes, guard wrapped in the nested Response-rethrow catch so the typed 403 survives both outer catch layers |
| `components/admin/courses-section.tsx` | file | see S1 | modified: table with owner, status, audience, publish date, unpublish and delete actions |

Before-state capture notes: the delete route today is owner-scoped through
`getOwnerScopedDocumentStore` (`app/api/stages/[id]/route.ts:180-189`), so a
foreign course answers 404 to a non-owner and no admin path exists. The
`stage_meta.stage_id` foreign key cascades on document delete
(`lib/persistence/stage-meta.ts:31-32`). The admin publish-any and
unpublish-any branches ship at `app/api/stages/[id]/publish/route.ts:53-63`
and `app/api/stages/[id]/unpublish/route.ts:52-62`. The gallery query at
`lib/persistence/gallery.ts:21-50` is the join model.

Postcondition: an admin sees every non-deleted course with owner, status,
audience, and publish date. The unpublish and republish actions drive the
certified 017 routes and work for any course. The delete action removes any
course, cascades stage meta, and never resurrects through PUT because PUT is
existence-gated (`app/api/stages/[id]/route.ts:161-162`). A creator without
`course.delete` gets 403 on the admin delete route. The section renders in
Safari.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/admin-courses.test.ts && echo ADMIN_COURSES_OK` expects `ADMIN_COURSES_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/admin-courses.pg.test.ts && echo ADMIN_COURSES_PG_OK` expects `ADMIN_COURSES_PG_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate seeds a creator and an admin, drives the
real admin delete route, and asserts the foreign course and its stage meta
are gone while a creator call answers the typed 403.

### S5 Classroom-media audience gate (owed item)

Delivers: the audience gate on the media byte server, the cache-header
change under the flag, and the flag-off parity proof.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/persistence/media-access.ts::decideMediaAccess` | function | `(queryable: Queryable, classroomId: string, ownerId: string): Promise<'allow' | 'deny'>` | new: resolves the viewer rank once, reads `stage_meta`, allows only published rows with `audience <= rank`, denies missing rows |
| `app/api/classroom-media/[classroomId]/[...path]/route.ts::GET` | function | `(req: NextRequest, { params }: Params)` | modified: under `MINIMAL_MODE` decides access before the file open, denies with 404, and swaps the cache header off public immutable; flag-off keeps today's bytes and headers exactly |

Before-state capture notes: the route serves any classroom id with
`CACHE_HEADERS = { 'Cache-Control': 'public, max-age=86400, immutable' }` at
`app/api/classroom-media/[classroomId]/[...path]/route.ts:24` and performs no
identity check in `GET` at `:40-131`. The read-gate decision seam,
`decideDocumentAccess`, was extended at `lib/persistence/document-access.ts:71-82`.
The classroom route already applies the audience rule only under the flag at
`app/api/classroom/route.ts:101-114`. Both deferrals are on the record at
`docs/specs/016-minimal-mode-gating.md:393` and
`docs/specs/017-publishing-visibility.md:465-476`.

Postcondition: under the flag, published everyone-audience media serves to
rank 0 and above, published guest media serves to rank 1 and above, published
learner media serves to rank 2 and above, drafts and wrong-audience courses
answer 404 with no bytes, and a media id with no `stage_meta` row answers
404. The gated responses carry a cache header that no longer claims public
immutability. Flag-off response bodies, statuses, and headers are byte-identical
to today. Range streaming keeps working on allowed media. The flag-on gate
never opens the file before the decision.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/media-gate.test.ts && echo MEDIA_GATE_OK` expects `MEDIA_GATE_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/media-gate.pg.test.ts && echo MEDIA_GATE_PG_OK` expects `MEDIA_GATE_PG_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && MINIMAL_MODE=true pnpm test tests/admin/media-no-leak.pg.test.ts && echo MEDIA_NO_LEAK_OK` expects `MEDIA_NO_LEAK_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 4. The adversarial gate drives the real byte route with real
seeded sessions and a real database, sets `MINIMAL_MODE=true` inline in the
gate command, which the flag reads at call time, and asserts the exact
status and header matrix for every audience tier, drafts, tombstoned courses,
missing rows, and banned users. Flag-off parity runs in the hermetic unit
gate with the real route and a temp classroom dir.

### S6 Cold-boot owner transient probe and hardening (owed item)

Delivers: the regression probe that reproduces the cold-boot owner
transient and the hardening in the session resolution path.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/auth/index.ts::getSession` | function | `(headers: Headers): Promise<Session | null>` | modified: on the first cold request, waits for provider and auth readiness before the session lookup, so a genuine session never falls back to the anon owner; the cold-boot probe drives both cold starts through the pinned reset seam |
| `lib/auth/index.ts::resetAuth` | function | `(): Promise<void>` | new: test-only reset that clears the module-scope `cachedAuth`, mirroring `resetServerPersistenceProvider`, so a probe can force the auth cold start deterministically |
| `lib/server/agent-runtime/with-owner.ts::withRequestOwnerId` | function | `(req, handler: OwnerHandler): Promise<Response>` | modified: hardens the session-failure fallback, keeping the anon identity only for requests without a valid session cookie |
| `tests/admin/cold-boot-owner.pg.test.ts` | suite | `describe('cold-boot owner transient probes')` | new: resets the provider and the auth bootstrap, signs a real user, fires the first PUT, asserts the stage meta owner is `user:<id>` |

Before-state capture notes: the transient report is owed at
`docs/specs/017-publishing-visibility.md:629-631`. The likely race sits in
the unawaited seams: `getSession` swallows every error to null at
`lib/auth/index.ts:64-66`, `withRequestOwnerId` falls back to the anonymous
identity on any session failure at `lib/server/agent-runtime/with-owner.ts:27-38`,
the role seed is fire-and-forget at `lib/auth/server.ts:105-108`, and the
first-request auth cache builds lazily at `lib/auth/index.ts:29-38`. The
provider bootstrap is a cached promise at `lib/persistence/server-provider.ts:72-93`,
and `resetServerPersistenceProvider` at `:100-112` gives the probe a cold
start. The two caches are independent: `cachedAuth` holds one `AuthServer`
bound to the pool the provider reset ends, so the probe also clears the auth
cache through the new `resetAuth()` (`lib/auth/index.ts:29-38`) to force the
auth cold start.

Postcondition: the probe reproduces the failure class, the hardening keeps a
real signed-in session from resolving to anon on the first PUT after a cold
boot, and the probe passes across repeated cold boots. A request without a
session cookie still resolves the anon identity.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/cold-boot-session.test.ts && echo COLD_BOOT_OK` expects `COLD_BOOT_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/admin/cold-boot-anon.test.ts && echo COLD_BOOT_ANON_OK` expects `COLD_BOOT_ANON_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/admin/cold-boot-owner.pg.test.ts && echo COLD_BOOT_PG_OK` expects `COLD_BOOT_PG_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 4. A regression here silently writes `anon:` owners on real
sessions, corrupting ownership data, so the tier-4 floor holds: the anon
unit gate covers the cookie-less fallback, the readiness unit gate covers
the hardening, and the adversarial gate drives the real PUT route through
the real owner resolution across repeated cold boots and asserts the stage
meta owner never regresses to `anon:` for a real session. The probe drives
both cold starts through `resetServerPersistenceProvider` and `resetAuth`.
The expected failure mode is pinned: if either reset is miswired, the probe
signs in through a stale auth server against an ended pool, `getSession`
returns null via the swallow at `lib/auth/index.ts:64-66`, the request
resolves anonymous, and the assertion on the real owner bytes fails. A
miswired reset therefore cannot pass the gate vacuously.

## Implementation Decisions

- Placement. Admin work lives on a full page at `/admin/settings`, not in a
  modal. The page holds three data tables with search and mutation controls,
  which a modal cannot carry. The provider settings dialog stays a modal
  exactly as batch A shipped it (`components/settings/index.tsx:204`). This
  honors the original brief that batch E enables the current settings modal,
  and it matches the matrix rows: the dialog is the settings.manage surface
  and the page is the users.manage surface
  (`docs/meta-specs/rbac-minimal-mode.md:211-212`).
- The settings gate split. The provider surface, meaning the dialog and the
  deferred routes (`/api/server-providers`, `/api/azure-voices`,
  `/api/provider/probe-models`, `/api/usage`), gates with the batch C wrapper
  `requirePermissionIfMinimalMode(headers, 'settings.manage')`. Flag off
  keeps today's behavior byte-identical, which is the parity rule from Q4.
  The new admin surface gates unconditionally with `requirePermission` and
  `can()`, because those routes did not exist before and the publish route
  set the unconditional precedent in batch D
  (`docs/specs/017-publishing-visibility.md:371-385`). The client mirror hides
  the gear and the account entries as a second layer. Every new admin route
  wraps the guard call as `try { await requirePermission(...) } catch (err)`
  `{ if (err instanceof Response) return err; throw err; }`, the byte-exact
  shape 017 pinned (the quiz-grade pattern at
  `app/api/quiz-grade/route.ts:43-46`), so the typed 403 survives the route
  catch and the `withRequestOwnerId` callback catch, neither of which
  flattens to a 500. The admin page catches the guard throw and renders a
  dedicated not-authorized state instead of letting the `Response` reach the
  error boundary. The S2 and S3 adversarial 403-body assertions and the S4
  integration 403-body assertion depend on this passthrough.
- The account zone becomes real. Settings calls `onOpenSettings` and Admin
  calls `onOpenAdmin`, both threaded from `HomePage`. The `auth.common.soon`
  badge leaves the Settings entry. The Admin entry keeps no badge because its
  page exists.
- Single role per user is confirmed. `user_roles.user_id` is the primary key
  (`lib/auth/schema.ts:79-84`), and assignment is one upsert, the same shape
  as the seed writer (`lib/auth/roles.ts:88-92`). Batch F custom roles keep
  the same cardinality.
- Ban is an app-owned status, not the better-auth admin plugin. The plugin
  was not wired in 013, and it brings its own session role claims that
  conflict with the rank model. The user table gains `banned`, `banned_reason`,
  and `ban_expires` through `ADD COLUMN IF NOT EXISTS` statements in
  `ensureAuthSchema`. The vendor schema lesson
  (`docs/specs/013-rbac-auth-foundation.md:645-649`) applies to plugin
  adoption, so the columns are app-owned and minimal. Enforcement happens at
  `requirePermission` (typed 403 code `banned`) and at `resolveViewerRank`
  (rank 0), so every rank gate, including the media gate, revokes a banned
  user. The ban write deletes every `session` row for the user in the same
  call. Self-ban is refused. `getSession` itself needs no ban check: every
  guarded surface passes through `requirePermission` or reads a rank through
  `resolveViewerRank`, so the two enforcement points plus the session
  revocation suffice.
- The invites table follows Q2 and Q11: app-side in `lib/auth/schema.ts`,
  lazy ensure pattern, never in a package
  (`docs/meta-specs/rbac-minimal-mode.md:159,168`). Columns are `id`, `email`,
  `role_name`, `code`, `expires_at`, `used_at`, `revoked_at`, `used_by`,
  `created_by`, and `created_at`. The single-use code is a random string
  stored hashed, named `code` because the neutrality guard forbids new
  identifiers containing "token" or "plan"
  (`docs/meta-specs/rbac-minimal-mode.md:232-238`).
- Invite expiry defaults to seven days with no new env var. The expiry is a
  constant in the invite service, so `.env.example` is untouched. A custom
  expiry is out of scope.
- The invite grant replaces the guest default inside the existing
  user-create hook (`lib/auth/server.ts:71-94`). The hook checks for an
  unused, unexpired, unrevoked invite for the email, consumes it with one
  atomic `UPDATE ... WHERE used_at IS NULL RETURNING`, and inserts the
  invited role in the same transaction, one client transaction covering the
  conditional consume and the grant. Both fire at user creation, before
  email verification. The role stays inert until the first verified sign-in,
  because no session exists before verification. A never-verifying signup
  still consumes the invite, an operational cost, not a leak. Without an
  invite it inserts guest, unchanged. The accept page validates the code
  read-only before rendering the prefill and never grants anything itself.
- The mailer gains one method. `Mailer` adds `sendInviteLink(to, url)`, and
  the three existing transports implement it with the same DI seam
  (`createMailer` takes injected transports, `lib/auth/mailer.ts:29-35`).
  The console transport logs the link, matching the verification behavior.
- The admin course list is a new app-owned query, never a reuse of the
  owner-scoped `GET /api/stages`. `listAllCoursesForAdmin` joins
  `stage_meta`, `document_stages`, and `user`, and returns only the
  non-deleted rows with owner, owner email when the owner is a user, status,
  audience, and publish date. It never returns document bytes.
- Delete-any resolves the owner from `stage_meta` and deletes through the
  owner's document store scope, keeping every store-level ownership check
  intact. The route gates `course.delete` plus an explicit rank-4 check,
  because delete-any is a strict superset of the batch D publish-any
  override and the catalog stays fixed at 11 permissions
  (`docs/specs/015-permission-core.md:260-268`). The `stage_id` cascade
  removes the stage meta and the child rows (`lib/persistence/stage-meta.ts:31-32`).
- The media gate closes the second deferral under the flag only. The byte
  route calls `decideMediaAccess` before opening the file, mirroring the
  classroom route rule at `app/api/classroom/route.ts:101-114`. Under
  `MINIMAL_MODE` the cache header drops public immutability for every gated
  response, because a shared immutable cache would serve revoked bytes after
  an unpublish. The gated header is `private, no-store` so every playback
  request revalidates. Flag-off uses today's literal `CACHE_HEADERS`
  (`app/api/classroom-media/[classroomId]/[...path]/route.ts:24`), and the
  416 unsatisfiable range already carries `no-store`. Everyone-tier media
  gets the same `private, no-store` under the flag, with no public-audience
  carve-out. A carve-out would restore a shared immutable cache for exactly
  the tier an unpublish must revoke, reopening the leak. The cost: under the
  flag every playback byte revalidates through the audience decision,
  trading shared caching for revocation safety, which the gated deployment
  accepts. Flag-off keeps today's immutable cache for every tier.
- The cold-boot hardening targets the resolution order, not a new flag. The
  fix makes `getSession` wait for the provider promise and the auth server
  on the first cold request before the lookup, so a ready session cannot be
  misread as anonymous. The regression probe drives both cold starts
  deterministically: it calls `resetServerPersistenceProvider`
  (`lib/persistence/server-provider.ts:100-112`) and the new test-only
  `resetAuth()` in `lib/auth/index.ts`, which clears the module-scope
  `cachedAuth`, then asserts the exact owner bytes. The expected failure
  mode is pinned in S6, so a miswired reset cannot pass the gate vacuously.
- New identifiers avoid the substrings "token" and "plan". `admin`,
  `invite`, `code`, `banned`, and `media-access` ship clean. The neutrality
  guard's file list covers model routes and `server-provider.ts` only
  (`tests/providers/provider-neutrality-guard.test.ts:58-90`). No slice in
  this batch touches a guarded file, so the guard makes no new assertion
  here and no neutrality gate is added.
- No new permission enters the catalog. `users.manage` covers list, assign,
  ban, and invites. `settings.manage` covers the provider dialog and routes.
  `course.delete` plus rank 4 covers delete-any. `roles.manage` stays for
  batch F.
- New i18n keys ship in `en-US.json` as the source of truth under `admin`
  and `invite` groups. All keys get 12-locale parity
  (`docs/meta-specs/rbac-minimal-mode.md:229-231`).

## Testing Decisions

- New suites live under `tests/admin/`. Root vitest picks up
  `tests/**/*.test.ts` and `.env.local` is not loaded, per the established
  hermetic setup.
- The env-clear prefix is the 016 canonical list, copied verbatim, on every
  vitest gate. The invite-mailer gate extends it with the 013 S05 mailer
  variables. `MINIMAL_MODE=true` is set inline only where a gate must
  exercise flag-on behavior, exactly as batch C did.
- The PIN-FROM-OUTLINE rule is the hard lesson of batches A, B, G, and C.
  Pin signatures after the code exists or from machine-extracted text, never
  from prose. The planned signatures above are plan-time prose. The builder
  replaces every pinned string with the byte-exact outline text after
  implementation.
- The live-wire-proof rule drives the real route stack. The user, invite,
  and course gates seed real better-auth users, sessions, and role rows in a
  scratch database. `requirePermission`, `getSession`, and the persistence
  queries are never mocked. Only `callLLM` and the model layer are mocked,
  and batch E has no model-spending route.
- The hermetic unit suites seed a session fixture per route family, per the
  rule in Slices. The users-admin, invites, admin-courses, and media-gate
  suites mock `getSession` at the module boundary and return a session with
  the rank the family needs. The admin-page suite stubs the permission hook
  at the component boundary. The invite-mailer suite needs no session. The
  cold-boot-session suite stubs the provider and auth seams and never mocks
  `getSession` itself, because it exercises the readiness hardening. The pg
  and adversarial gates never mock `getSession`: they seed real better-auth
  sessions in the scratch database, and the guard and enforcement seams stay
  real.
- The pg contract suites provision their own scratch database per the
  app-side precedent (`tests/agent-runtime/event-notify.pg.test.ts:58-72`)
  and fail closed without `PG_CONTRACT_URL`, which is intended for tier-3
  and tier-4 gates.
- The adversarial gates run the real handlers. The ban gate proves session
  revocation and rank zeroing through the live guard. The media gate proves
  the exact status and header matrix per seam, including the missing-row
  case, with `MINIMAL_MODE=true` set inline in the gate command. The
  cold-boot gate proves the owner bytes across repeated boots.
- The i18n parity check runs wherever copy lands. New `admin.*` and
  `invite.*` keys get 12-locale parity.
- The neutrality guard's file list covers model routes and
  `server-provider.ts`, none of which this batch touches, so no neutrality
  gate is added. The new identifiers contain no token or plan segments and
  are clean by inspection.
- Plan-time state: the `tests/admin/*` suites do not exist yet and fail with
  no marker until they do. These are the documented deliverable-dependent
  failures.
- The mailer tests keep the batch A pattern: `invite-mailer.test.ts` proves
  `MAIL_TRANSPORT=smtp`, `=resend`, and the console fallback select their
  transports for the invite link without sending.

## Out of Scope

- Custom role CRUD, catalog toggles, and yaml-default editing. That is batch
  F, which uses this batch's admin UI pattern.
- The organization plugin and SaaS auth providers, per the program record
  (`docs/meta-specs/rbac-minimal-mode.md:278-284`).
- Password reset email, OAuth providers, 2FA, and mobile auth flows.
- Per-user quotas, rate limits, and analytics on the admin surface.
- Permanent account deletion via the admin UI. Ban is the batch E control.
  Hard delete remains the course document delete route.
- Custom invite expiry configuration and bulk invite upload.
- Role reassignment for course ownership. Courses keep their owner rows.
- Media byte migration or backfill. Existing files stay in place and the
  gate reads stage meta only.
- Dropping the legacy `is_public` mirror column on `stage_meta`.
- Dropping any seeded role or the `roles.manage` permission.
- The ambient settings dialog redesign. Batch E gates and wires it, it does
  not restyle it.
- Any new operator env var. `.env.example` is untouched by this batch.

## Further Notes

- The program record is `docs/meta-specs/rbac-minimal-mode.md`. Batch E
  depends on A and B per the table
  (`docs/meta-specs/rbac-minimal-mode.md:266`), and it certifies after C and
  D in sequence. Because batch D is certified before batch E verifies, this
  spec assumes the certified `MINIMAL_MODE` flag, the audience rule, the
  publish-any and unpublish-any overrides, and the read-gate seams where the
  owed items demand them. The dependency table row for E stays unchanged.
- The two owed items are the second media-bytes deferral
  (`docs/specs/017-publishing-visibility.md:465-476`) and the cold-boot
  transient probe (`docs/specs/017-publishing-visibility.md:629-631`). This
  spec names them S5 and S6 and closes them.
- The register names the batch E scope as "admin settings section: user
  list, role assign, ban, invite by email". This spec adds course
  administration, the media gate, and the transient probe because the batch D
  research update and the program acceptance criteria demand them
  (`docs/meta-specs/rbac-minimal-mode.md:317-319`).
- The visual-preview checkpoint runs before implementation. The admin page,
  the account menu delta, the invite form, and the course table render in
  localhost and are approved in Safari first, per the program process rules.
- A banned user's rank resolves to 0 on every gate, matching the anonymous
  posture. Unban restores the stored role row, because the role assignment
  is never deleted by the ban.
- The media gate keeps the range-streaming path intact. Only the audience
  decision and the cache header change. The stream bridge at
  `app/api/classroom-media/[classroomId]/[...path]/route.ts:27-38` is
  untouched.
- Commit convention for this batch: `feat(rbac): ...`.

## Research Update (2026-09-06)

Batch E shipped in six slice commits: `6d1640ff`, `0cef9cb4`,
`b1695f52`, `8ca1301b`, `21bc61f1`, and `434b49f6`. Two fix rounds landed
in `b8d65102` and `2fccff4e`. Round 1 sent all six slices back at
`3c975660`. Round 2 cleared S2, S3, S5, and S6 and sent S1 and S4 back at
`3d46239a`. Round 3 cleared all six at `32377b5c`, chain 126. This section
records what shipped, what deviated from the plan, and what the next
batches inherit.

### What shipped

- The admin page ships at `app/admin/settings/page.tsx`. `AdminSettingsPage`
  calls `requirePermission` with `users.manage` at `:22` and reads the real
  `headers()` promise from `next/headers` at `:31`. The not-authorized
  branch renders a dedicated state at `:34-46` and keeps the `Response` off
  the error boundary. `serverTranslate` resolves the locale for the
  not-authorized copy at `:36` and for the three section titles at `:49-54`.
- `AccountZone` ships the optional `onOpenSettings` and `onOpenAdmin` props
  at `components/account-zone.tsx:17-24`. The Settings entry gates by
  `can('settings.manage')` at `:58`. The Admin entry gates by
  `can('users.manage')` at `:69` and navigates through `onOpenAdmin` at
  `:73`. The `soon` badge is gone. `HeaderCapsule` ships the optional
  `settingsGated` prop at `components/header-capsule.tsx:38` and gates the
  gear at `:131`.
- The ban columns land in `ensureAuthSchema` at `lib/auth/schema.ts:128-129`.
  `listUsers` at `lib/persistence/admin-users.ts:31-92` joins `user`,
  `user_roles`, and `roles` and returns email, verified, role, rank, banned,
  and created. It never selects password data. `setUserRole` at `:100-112`
  upserts the single `user_roles` row. `setUserBanned` at `:118-137` writes
  the ban columns, deletes every session row at `:135-137`, and refuses
  self-ban at `:125-127`.
- `requirePermission` denies banned sessions with the typed 403 code
  `banned` at `lib/auth/permissions-server.ts:50-53`. `resolveViewerRank`
  returns rank 0 for banned users at `lib/persistence/audience.ts:48-49`.
  GET and PATCH ship at `app/api/admin/users/route.ts:17-41` and `:43-103`
  with the nested Response-rethrow catch.
- The invites table lands in `ensureAuthSchema` at `lib/auth/schema.ts:108`.
  `createInvite` at `lib/auth/invites.ts:51-88` stores the SHA-256 hash of
  a random single-use code. `consumeInvite` at `:100-121` marks one unused,
  unexpired, unrevoked row used with one atomic `UPDATE ... RETURNING`.
  The user-create hook at `lib/auth/server.ts:82-151` consumes the invite
  and grants the invited role in one client transaction, COMMIT at `:145`.
  The accept page wraps `useSearchParams` in Suspense at
  `app/invite/accept/page.tsx:201-211`. The revoke route ships at
  `app/api/admin/invites/[id]/route.ts:17-36`. `sendInviteLink` rides the
  `Mailer` interface at `lib/auth/mailer.ts:22` and all three transports
  implement it at `:58`, `:93`, and `:112`.
- `listAllCoursesForAdmin` at `lib/persistence/admin-courses.ts:46-91`
  left-joins `user` for the owner email at `:65` and returns non-deleted
  rows by default. `deleteCourseForAdmin` at `:103-112` tombstones stage
  meta then deletes the document row. The delete route at
  `app/api/admin/courses/[id]/route.ts:29-75` gates `course.delete` and
  adds the explicit rank-4 check at `:47-53`. The GET list route ships at
  `app/api/admin/courses/route.ts:16-37`.
- `decideMediaAccess` at `lib/persistence/media-access.ts:29-42` resolves
  the viewer rank once and reads stage meta. Missing rows, tombstones,
  drafts, and wrong-audience rows deny. The byte route gates under the flag
  at `app/api/classroom-media/[classroomId]/[...path]/route.ts:82-99` and
  answers 404 before opening the file. The gated cache header is
  `private, no-store` at `:28` and `:135`. Flag-off keeps the literal
  public immutable headers at `:27`. Range streaming stays intact at
  `:121-148`.
- `resetAuth` clears the module-scope auth cache at `lib/auth/index.ts:39-41`.
  `getSession` clears and retries once after a cold-start failure at
  `:76-101`. `withRequestOwnerId` at
  `lib/server/agent-runtime/with-owner.ts:34-62` answers 401 for a cookie
  without a valid session and keeps anon for cookie-less requests at
  `:47-48`. The three probes ship at `tests/admin/cold-boot-session.test.ts`,
  `tests/admin/cold-boot-anon.test.ts`, and
  `tests/admin/cold-boot-owner.pg.test.ts`. The pg probe points
  `DATABASE_URL` at the scratch database at `:53` and signs real sessions
  through the better-auth API at `:111-148`.

### Deviations and surprises

(a) Round 1's page guard passed `new Headers()` to `requirePermission`.
An empty Headers object carries no cookie, so every user lost the page.
All unit gates stayed green because the page suite mocked the permission
hook at the module boundary. Only Safari saw the permanent not-authorized
state. RSC pages need a real-cookie live probe in the gate or in
verification.

(b) `ADMIN_PAGE_OK` was tautological at round 1. It asserted module
exports and mocked `requirePermission` itself. The rewrite drives the real
`requirePermission` and the real `guard()` with a transport-only
`getSession` mock at `tests/admin/admin-page-gate.test.ts:77-84`.

(c) The cold-boot pg probe sent itself 401s at round 1. The fixture
pointed `DATABASE_URL` at the wrong target and inserted unsigned raw-token
session rows. A cookie without a valid session rightly answers 401, so the
fixture looked like a production failure. The production seam was sound.
The fixture now signs real sessions through the better-auth sign-in API at
`tests/admin/cold-boot-owner.pg.test.ts:111-148` and sets `DATABASE_URL`
to the scratch database at `:53`.

(d) GET `/api/admin/courses` never existed while the courses section
fetched it at `components/admin/courses-section.tsx:43`. No gate exercised
the list path, and Safari round 2 caught the 404 on every load. The route
now ships at `app/api/admin/courses/route.ts:16-37`.

(e) The first fix commit `b8d65102` introduced prettier violations in the
page and its gate suite. Round 2 sent S1 back for `pnpm check`.
`2fccff4e` restored the formatting.

(f) Test-state leakage. The tombstone test left `pg-course-bob`
tombstoned in the shared scratch database, and later assertions failed.
Restore lines landed at `tests/admin/admin-courses.pg.test.ts:172` and
`:274`.

(g) `includeDeleted` parses `'true'` strictly at
`app/api/admin/courses/route.ts:29`. A `'1'` silently means false. This is
accepted as non-blocking and is a candidate for a follow-up ticket.

(h) The 12-locale `admin.users` parity was silently missing until S3's
i18n check exposed it. All 12 locales now carry the `admin` group and
`admin.notAuthorized`.

### Test results

All 24 gates passed green at round 3. The doubles ran clean. The final
table is 24 of 24: S1 3, S2 4, S3 6, S4 3, S5 4, S6 4. The full suite ran
7863 tests with 1 tolerated failure. The production build exits 0. Safari
shots 27-30 are console-clean. The wire matrix: admin 200 on both course
routes, guest 403 on the admin routes, banned 403 with code `banned` and
rank 0 on the read gate, and the invite flow lands the invited role as
learner, not guest, through the console transport. The media matrix holds
every audience tier under the flag.

### Follow-on notes

- `includeDeleted` strictness is a follow-up ticket. See deviation (g).
- `settingsGated` is never passed as true. `app/page.tsx:741-750` renders
  `HeaderCapsule` without it, so the gear stays visible under the flag for
  every rank. The account Settings entry and the settings routes decide
  the surface. Batch F may revisit the gear.
- The RSC empty-headers lesson outlives this batch. A real-cookie live
  probe for RSC pages belongs in the gate design of future specs.