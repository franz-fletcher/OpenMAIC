# Batch 013 spec: rbac-auth-foundation

Spec status: implementation

## Problem Statement

The app has no accounts. Ownership comes from the `anonymous_id` cookie.
`resolveRequestOwnerId` returns `anon:<uuid>` and mints the cookie
(`lib/server/agent-runtime/owner.ts:52-65`, cookie name at `owner.ts:3`). The
function already accepts an `authenticatedOwnerId`, but no caller passes one
and its comment says a future auth integration must thread it
(`owner.ts:46-50`). From the operator view the consequences are concrete.

- A course a visitor builds is bound to a cookie. It orphans the moment the
  browser clears cookies, the visitor switches devices, or an account
  eventually exists.
- The publish route refuses anonymous owners with `401 login_required`
  (`app/api/stages/[id]/publish/route.ts:26-31`), but no login exists. The
  refusal is a dead end for every owner who wants to publish.
- There is no email delivery, so there is no way to verify anyone owns an
  address.
- There is no role, so there is no way to seed an admin before any admin UI
  ships in batches E and F.
- Documents are stored with no ownership partition behind the dev token
  (`lib/persistence/server-auth.ts:2-13`, the "Production must replace this
  module" note at `:10-12`), and agent sessions partition under anonymous
  owners.

Batch A makes an account real without gating anything. Auth is available the
day it ships. Minimal mode and every permission guard arrive in later
batches.

## Solution

Batch A ships better-auth 1.7.x, pinned and fully wrapped, on the existing
`pg.Pool`. It delivers email and password signup with mandatory email
verification, login and logout, verification resend, a header account menu,
and signup, login, and verify pages with i18n keys. It creates the auth
tables plus the role tables on the app-side pool through the lazy idempotent
`ensureSchema` pattern. It seeds four system roles with integer ranks and
grants email to role from `ADMIN_EMAILS` and `server-roles.yml`. It claims
anonymous-owned courses and agent sessions on the first verified sign-in and
threads the authenticated owner id through every owner-resolving route. It
ships a mailer transport interface with SMTP, Resend, and a console-link
fallback so verification works with no mail server.

`MINIMAL_MODE` is not introduced here. That is batch C. Batch A ships
auth-available-but-gating-off: the app behaves exactly as today, and an
operator can seed users and roles before any gate exists. `ACCESS_CODE`
handling in `middleware.ts:60-86` is untouched (Q14).

All decision references below resolve to `docs/research/rbac-minimal-mode-decision-round-1.md`
and the recorded round-2 deltas, as transcribed in
`docs/meta-specs/rbac-minimal-mode.md`.

## User Stories

1. As an operator, I want signup and login live before minimal mode is on, so
   that I can seed users and roles ahead of switching the gate.
2. As a visitor, I want to sign up with an email and password and verify my
   address, so that my courses hold under a durable identity.
3. As a returning visitor, I want my anonymous courses and agent sessions to
   follow my account on the same device, so that nothing I built is orphaned.
4. As a signed-in user, I want a header account menu that shows my session and
   lets me sign out, so that I know when I am authenticated.
5. As an operator, I want to seed roles from env and yaml, so that the first
   admin exists before any admin UI ships.
6. As an operator, I want verification email that works without a mail server,
   so that the flow is testable and self-hostable.
7. As a new visitor, I want to create an account and land as a verified guest,
   so that I know what my account can do before I am elevated.

## Slices

Each slice lists the ledger bindings for its target symbols, the before-state
capture notes, the postcondition, and the gate inventory. The postcondition
bindings use the rivr v2 form: `--after-kind` with `--after-signature`
written as `(params): Return` (function name and async stripped) for
functions, or an exists and shape clause for constants and components. The
tables land as behavior of `ensureAuthSchema`, not as separate symbols.

Gate types follow the repo convention: `smoke`, `unit`, `integration`,
`adversarial`. One tag per gate. Tier 3 needs at least three gates with one
integration tag. Tier 4 needs at least four gates with one adversarial tag.
Every gate echoes a literal success marker. The env-clear prefix `ENV_CLEAR`
is defined in Testing Decisions and is identical on every vitest gate.

### S01 Auth bootstrap and session surface

Delivers: the pinned better-auth dependency, the server factory with email
and password plus mandatory verification, a thin database adapter over the
existing pool, the auth schema in the lazy ensure chain, and the `lib/auth`
public surface (`getSession`, `requireSession`, `listRoles`).

Ledger bindings:

| file::symbol | kind | after-signature or shape | behavior |
| --- | --- | --- | --- |
| `lib/auth/schema.ts::ensureAuthSchema` | function | `(queryable: Queryable): Promise<void>` | creates the six tables idempotently. Tables: `user`, `session`, `account`, `verification` (better-auth canonical shapes), `roles`, `user_roles` |
| `lib/auth/server.ts::createAuthServer` | function | `(options: AuthServerOptions): AuthServer` | returns the wrapped better-auth server with email and password, mandatory verification, the verification callback wired, and verified signups assigned the guest default role |
| `lib/auth/index.ts::getSession` | function | `(headers: Headers): Promise<Session | null>` | returns the session for valid cookies, null otherwise |
| `lib/auth/index.ts::requireSession` | function | `(headers: Headers): Promise<Session>` | returns the session or a 401-style refusal |
| `lib/auth/index.ts::listRoles` | function | `(queryable: Queryable): Promise<Role[]>` | returns all roles with ranks |
| `lib/persistence/server-provider.ts::createServerPersistenceProvider` | function | `(connectionString: string, poolFactory?: PersistencePoolFactory): Promise<ServerPersistenceProvider>` | modified: composes `ensureAuthSchema` into the lazy chain beside the five existing ensures |

Before-state capture notes: `createServerPersistenceProvider` runs five
ensures at `lib/persistence/server-provider.ts:43-47` (`ensureSchema`,
`ensureDocumentSchema`, `ensureStageMetaSchema`, `ensureOwnerMaterialSchema`,
`ensureAssetSchema`). `lib/auth` does not exist. `package.json` has no
better-auth entry (`npm view better-auth dist-tags.latest` returns 1.7.2,
verified 2026-09-04).

Postcondition: after provider bootstrap the six tables exist. A valid session
cookie resolves a session object. A missing session makes `requireSession`
refuse. `lib/auth` is the only module that imports better-auth. The
better-auth dependency is pinned in `package.json` and `node_modules` has it.
A verified signup without a configured grant defaults to guest (rank 1).

Gates:

- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/auth/auth-core.test.ts && echo AUTH_CORE_OK` expects `AUTH_CORE_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/auth/session-roundtrip.test.ts && echo SESSION_RT_OK` expects `SESSION_RT_OK`
- smoke: `node -e "const p=require('./package.json'); if(!p.dependencies?.['better-auth']) process.exit(1)" && echo PKG_OK` expects `PKG_OK`

Risk tier: 3. The integration gate is the signup to verified session
roundtrip through the real better-auth stack against the mocked pool.

### S02 Role model, rank integers, env and yaml seeds

Delivers: the `roles` and `user_roles` tables, the `ROLE_RANKS` constants
with anonymous 0 virtual and guest 1, learner 2, creator 3, admin 4 seeded
as system rows, the `ADMIN_EMAILS` env seed, the `server-roles.yml` loader,
and idempotent non-destructive reseeding where the database is truth.

Ledger bindings:

| file::symbol | kind | after-signature or shape | behavior |
| --- | --- | --- | --- |
| `lib/auth/roles.ts::ROLE_RANKS` | constant | shape `{ ANONYMOUS: 0, GUEST: 1, LEARNER: 2, CREATOR: 3, ADMIN: 4 }` | the stable rank constants, anonymous virtual |
| `lib/auth/roles.ts::seedRoleGrants` | function | `(queryable: Queryable, grants: RoleGrantSeed[]): Promise<number>` | seeds grants idempotently, non-destructive, overriding the guest default for emails with a configured role, returns applied count |
| `lib/auth/roles.ts::listRoles` | function | `(queryable: Queryable): Promise<Role[]>` | returns all roles with ranks |
| `lib/auth/roles-config.ts::loadRoleDefaults` | function | `(): RoleDefaults` | merges the `ADMIN_EMAILS` env and `server-roles.yml` default filename into defaults |

Before-state capture notes: no `roles` or `user_roles` tables exist. No
`server-roles.yml` exists. `.env.example` has no `ADMIN_EMAILS` entry. The
js-yaml loader to model is `loadYamlFile` at
`lib/server/provider-config.ts:208` with `DEFAULT_FILENAME` at `:354`.

Postcondition: after bootstrap, four system role rows exist with ranks 1
through 4. Every email listed in `ADMIN_EMAILS` or `server-roles.yml` has
exactly one grant. Running the seed a second time changes no rows. The
database owns truth after the first seed. Anonymous rank 0 is a module
constant and has no row. The `ADMIN_EMAILS` variable is documented in
`.env.example`.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/auth/role-seed.test.ts && echo ROLE_SEED_OK` expects `ROLE_SEED_OK`
- smoke: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/providers/provider-neutrality-guard.test.ts && echo NEUTRAL_OK` expects `NEUTRAL_OK`
- smoke: `grep -q "ADMIN_EMAILS" .env.example && echo SEED_ENV_OK` expects `SEED_ENV_OK`

Risk tier: 2.

### S03 Signup, login, verification pages and the header account menu

Delivers: signup, login, and verify pages, email and password signup with
mandatory verification, sign in, sign out, verification resend, the header
account menu, and the `auth.*` i18n namespace in all 12 locale files.

Ledger bindings:

| file::symbol | kind | after-signature or shape | behavior |
| --- | --- | --- | --- |
| `app/signup/page.tsx::default` | component | exists | renders the signup form |
| `app/login/page.tsx::default` | component | exists | renders the login form |
| `app/verify/page.tsx::default` | component | exists | renders the verification status and resend action |
| `components/header.tsx::Header` | component | exists | modified: renders the account menu with signed-in state and sign out |
| `lib/auth/client.ts::createAuthClient` | function | `(opts: AuthClientOptions): AuthClient` | returns the wrapped client for signup, sign in, sign out, resend |

Deliverables (gate-bound, not symbol-bound): the `auth` namespace in
`lib/i18n/locales/en-US.json` and its 11 mirrors. The I18N_NS_OK and I18N_OK
gates bind it.

Before-state capture notes: `Header` is exported at
`components/header.tsx:34` and has no account affordance. No auth pages
exist under `app/`. The locale set is the 12 files in `lib/i18n/locales` and
`en-US.json` is the source of truth. No `auth` key exists in any locale.

Postcondition: a visitor can sign up, receive a verification link, verify
the address, and sign in. The header shows an account menu with the
signed-in state and a sign out action. Every visible string resolves through
an `auth.*` key. Locale parity holds.

Gates:

- smoke: `pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/auth/session-routes.test.ts && echo SESSION_ROUTES_OK` expects `SESSION_ROUTES_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`
- smoke: `node -e "const l=require('./lib/i18n/locales/en-US.json'); if(!l.auth) process.exit(1)" && echo I18N_NS_OK` expects `I18N_NS_OK`

Risk tier: 3. The integration gate is the signup route to session cookie to
`getSession` roundtrip at the route level.

### S04 Anonymous owner claim migration

Delivers: the authenticated owner id scheme `user:<auth-user-id>`, the
one-time claim of `anon:` owned rows on first verified sign-in, and the
`authenticatedOwnerId` thread through the wrapper and the three direct call
sites.

The claim reads the `anonymous_id` cookie from the first verified-sign-in
request. That cookie value is minted in `lib/server/agent-runtime/owner.ts`
(cookie name at `owner.ts:3`, read at `owner.ts:7-20`, `anon:` prefix at
`owner.ts:60`). That value is the only `anon:` id the migration rewrites for
the user, so a sign-in on a different device, which carries a different
cookie, claims nothing of this user.

Exact tables and columns the claim touches, all verified:

- `stage_meta.owner_id` (`lib/persistence/stage-meta.ts:27`)
- `document_stages.owner_id` (`packages/@openmaic/storage/src/document/pg.ts:84-96`)
- `document_folders.owner_id` (`document/pg.ts:60`, primary key at `:66-67`)
- `agent_sessions.owner_id` (`packages/@openmaic/storage/src/agent-session/pg.ts:90`)
- `agent_owner_session_events.owner_id` (`agent-session/pg.ts:162-171`, primary key at `:171`)
- `agent_owner_session_event_counters.owner_id` (`agent-session/pg.ts:156-160`, a primary key, so the counters must merge on conflict, not collide)
- `agent_user_skill.owner_id` (`packages/@openmaic/storage/src/skill/pg.ts:51-53`)
- `owner_material.owner_id` (`lib/persistence/owner-materials.ts:105`)

Ledger bindings:

| file::symbol | kind | after-signature or shape | behavior |
| --- | --- | --- | --- |
| `lib/auth/claim.ts::claimAnonOwnership` | function | `(anonId: string, userId: string): Promise<number>` | rewrites the owner columns listed above from `anon:<id>` to `user:<id>`, returns the row count |
| `lib/server/agent-runtime/owner.ts::resolveRequestOwnerId` | function | `(req: Pick<Request, 'headers'>, responseHeaders: Headers, authenticatedOwnerId?: string): string` | modified: the accepted parameter becomes actually threaded by callers |
| `lib/server/agent-runtime/with-owner.ts::withRequestOwnerId` | function | `(req: Pick<Request, 'headers'>, handler: OwnerHandler): Promise<Response>` | modified: resolves `user:<id>` when a session is present, else the anon identity |
| `app/api/agent/owner-events/route.ts::GET` | function | `(req: NextRequest): Promise<Response>` | modified: resolves the authenticated owner when signed in |
| `app/api/agent/sessions/[id]/events/route.ts::GET` | function | `(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response>` | modified: resolves the authenticated owner when signed in |
| `app/api/stages/[id]/freshness/route.ts::GET` | function | `(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response>` | modified: resolves the authenticated owner when signed in |

Before-state capture notes: `resolveRequestOwnerId` accepts
`authenticatedOwnerId` and returns it verbatim, but no caller passes it
(`owner.ts:57`, the comment at `owner.ts:46-50`). The three direct resolver
calls are at `app/api/agent/owner-events/route.ts:49`,
`app/api/agent/sessions/[id]/events/route.ts:77`, and
`app/api/stages/[id]/freshness/route.ts:50`. The wrapper is at
`lib/server/agent-runtime/with-owner.ts:12` and consumes the resolver at
`:17`.

Postcondition: after the first verified sign-in on a device, every owner
column in the list above that held that device's `anon:<uuid>` is now
`user:<id>`. The workbench lists show the claimed courses and sessions. A
re-run of the claim changes nothing. A sign-in on a different device claims
nothing.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/auth/claim-migration.test.ts && echo CLAIM_OK` expects `CLAIM_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/auth/claim-scheme.test.ts && echo CLAIM_SCHEME_OK` expects `CLAIM_SCHEME_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/auth/owner-threading.test.ts && echo THREADING_OK` expects `THREADING_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; test -n "$PG_CONTRACT_URL" && pnpm test tests/auth/claim.pg.test.ts && echo CLAIM_PG_OK` expects `CLAIM_PG_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/auth/claim-adversarial.test.ts && echo CLAIM_ADV_OK` expects `CLAIM_ADV_OK`

Risk tier: 4. The adversarial gate runs the strongest concrete attack: a
forged `anonymous_id` cookie whose `anon:<uuid>` rows a different user
already claimed. The second claim must not rewrite rows now owned by the
other user. The same suite races two concurrent claims for one anon id and
asserts exactly one owner with no lost rows. The integration gate needs a
reachable PostgreSQL admin URL in `PG_CONTRACT_URL`. It follows the app-side
contract pattern (`tests/agent-runtime/event-notify.pg.test.ts:32,57` reads
the URL and skips without it), and the suite provisions its own scratch
database (`:58-72`). CI provides the URL through the postgres:16 service
(`.github/workflows/storage-pg-contract.yml:32-33`). Without the URL the
gate fails closed with no marker, which is intended for a tier-4 gate. The
claim-scheme unit gate proves the `user:<id>` scheme, owner-prefix
non-overlap, and that non-anon owners are never rewritten. The threading
unit gate proves the wrapper and the three routes resolve the authenticated
owner when signed in.

### S05 Mailer transport and verified email delivery with console fallback

Delivers: the mailer transport interface at `lib/auth/mailer.ts`, the smtp
transport via nodemailer, the resend transport via the Resend SDK, the
console-link fallback for unconfigured mail, the verification callback on
signup, verification resend, and the `.env.example` entries.

Ledger bindings:

| file::symbol | kind | after-signature or shape | behavior |
| --- | --- | --- | --- |
| `lib/auth/mailer.ts::createMailer` | function | `(env: MailerEnv): Mailer` | selects the transport by `MAIL_TRANSPORT`: smtp, resend, or console fallback |
| `lib/auth/mailer.ts::sendVerificationLink` | function | `(to: string, url: string): Promise<void>` | sends the verification link through the selected transport |
| `lib/auth/server.ts::createAuthServer` | function | `(options: AuthServerOptions): AuthServer` | modified: the verification callback calls the mailer |

Deliverables (gate-bound, not symbol-bound): the `.env.example` entries for
`MAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`MAIL_FROM`, `RESEND_API_KEY`, `AUTH_SECRET`. The ENV_DOC_OK gate binds
them.

Before-state capture notes: no mail section exists in `.env.example`. No
email path exists anywhere in the app. The only send path is the site-wide
`ACCESS_CODE` cookie, which is not mail.

Postcondition: with `MAIL_TRANSPORT` unset, the mailer logs a verification
link to the server console. A fresh signup triggers the verification
callback. Opening the link verifies the address. Setting
`MAIL_TRANSPORT=smtp` selects nodemailer, and `=resend` selects the Resend
SDK. The interface is invite-agnostic: it sends a verification link by email
without any invite machinery, ready for batch E.

Gates:

- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MAIL_TRANSPORT AUTH_SECRET RESEND_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM; pnpm test tests/auth/mailer.test.ts && echo MAILER_OK` expects `MAILER_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MAIL_TRANSPORT AUTH_SECRET RESEND_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM; pnpm test tests/auth/mailer-transports.test.ts && echo TRANSPORTS_OK` expects `TRANSPORTS_OK`
- smoke: `grep -q "MAIL_TRANSPORT" .env.example && echo ENV_DOC_OK` expects `ENV_DOC_OK`

Risk tier: 3. The integration gate is the signup to verified-session
roundtrip against a captured console sink. It exercises the real server
factory, the verification callback, and the mailer seam with the pool mocked
per the repo pattern. The transports unit gate proves
`MAIL_TRANSPORT=smtp` and `=resend` select nodemailer and the Resend SDK
with the env shape, without sending.

## Implementation Decisions

- Dependency pin. `better-auth` is pinned at `~1.7.2` because
  `npm view better-auth dist-tags.latest` returns 1.7.2, verified 2026-09-04.
  Minor versions can carry breaking changes, so the minor is pinned (Q1).
- The wrapper rule. `lib/auth/index.ts` is the only module that exports the
  public surface: `getSession`, `requireSession`, and role helpers such as
  `listRoles`. The server factory, the client module, the database adapter,
  and the mailer live under `lib/auth/`. Nothing outside `lib/auth` imports
  better-auth.
- Next integration. Session verification is DB-backed in the Node runtime.
  A cookie-presence fast path is allowed only where it performs no database
  call. `middleware.ts` stays Edge and gains no database calls. The existing
  middleware already keeps server-only checks out of the Edge path
  (`middleware.ts:53`). The `ACCESS_CODE` HMAC logic at `middleware.ts:60-86`
  is untouched (Q14).
- Table placement and migration format. All six tables live app-side on the
  existing `pg.Pool`. The checked-in idempotent TypeScript ensure script is
  chosen over a raw `.sql` file and over the better-auth migrate CLI. The
  repo precedent is inline schema constants executed lazily
  (`lib/persistence/stage-meta.ts:24-55`, composed at
  `lib/persistence/server-provider.ts:43-47`). A separate `.sql` file would
  need a new loader, and the CLI adds a workflow the repo does not use. The
  script emits `CREATE TABLE IF NOT EXISTS` with the better-auth canonical
  column shapes for `user`, `session`, `account`, and `verification`, then
  the app tables `roles` and `user_roles`. Exact table list: `user`,
  `session`, `account`, `verification`, `roles`, `user_roles`.
- The roles table. Columns are `id`, `name`, `rank` (integer, unique),
  a system flag, and timestamps. The `user_roles` table uses `user_id` as its
  primary key and foreign key to `user.id`, plus `role_id` to `roles.id`,
  `granted_by`, and `granted_at`. A user holds exactly one role, because the
  audience rank is a single integer (Q12). The alternative name
  `role_grants` was rejected because it implies many-to-many grants.
- Owner id scheme. The authenticated owner id is `user:<auth-user-id>` where
  `auth-user-id` is the stable better-auth user id. The prefix is distinct
  from `anon:` (`owner.ts:60`). The claim migration is a plain ownership
  UPDATE over the columns enumerated in S04.
- Role seed. `ADMIN_EMAILS` env plus the optional `server-roles.yml` file
  map emails to roles. The loader is js-yaml modeled on
  `loadYamlFile` (`lib/server/provider-config.ts:208`) with a default
  filename in the same style (`:354`). Seeding is idempotent and
  non-destructive. The database is truth after the first seed.

  A verified email-and-password signup defaults to the `guest` role (rank 1).
  An email present in `ADMIN_EMAILS` or `server-roles.yml` receives its
  configured role grant at seed time, which overrides the default. A rank-1
  session is legitimate and renders the Guest badge. Promotion beyond guest
  happens only through admin assignment or an accepted invite (batch E).
- UTC-midnight quota day belongs to batch C. The owner id scheme is defined
  here because the claim migration needs it. Role rank integers are defined
  here because the roles table lands here. Anonymous rank 0 is a virtual
  constant for unauthenticated requests. `MINIMAL_MODE` is not introduced
  here and no batch A code reads it.
- Mailer transport. `createMailer` selects the transport from env.
  `MAIL_TRANSPORT=smtp` uses nodemailer. `MAIL_TRANSPORT=resend` uses the
  Resend SDK. An unset or unknown value selects the console-link fallback.
  The interface stays invite-agnostic so batch E adds one small adapter for
  invite mail (Q13).
- Env var names, all added to `.env.example` in this change:
  `AUTH_SECRET`, `ADMIN_EMAILS`, `MAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `RESEND_API_KEY`. No name contains
  the substrings "token" or "plan", because the provider-neutrality guard
  derives those words as vendor vocabulary from the registry id
  `qwen-token-plan-tts` (`tests/providers/provider-neutrality-guard.test.ts:212-217`)
  and later batches must guard files already on `PROVIDER_NEUTRAL_FILES`
  (`tests/providers/provider-neutrality-guard.test.ts:58-90`).
  `NEXT_PUBLIC_MINIMAL_MODE` and `NEXT_PUBLIC_MIRROR` are batch C names and
  are not introduced here.
- Version-bump exemption. Every added or modified file is app-side under
  `lib/`, `components/`, `app/`, or `tests/`. Nothing lands under
  `packages/@openmaic/*`. The version-bump gate ignores `docs/`, `test/`,
  `.gitignore`, and `vitest.config.ts` as inputs and diffs only the package
  directories (`scripts/check-package-version-bumps.mjs:8-11` for the ignored
  inputs, `:181-203` for the package-directory diff), so an app-side diff
  cannot trip it. This is verified at review time by listing the changed
  paths.
- Better-auth session verification replaces nothing in
  `lib/persistence/server-auth.ts` in this batch. That dev-only module stays
  as is. Its replacement note (`server-auth.ts:10-12`) is honored by later
  gating batches.

## Testing Decisions

- Hermetic unit tests live under `tests/auth/`. Root vitest only picks up
  `tests/**/*.test.ts` (`vitest.config.ts:11`), and `.env.local` is not
  loaded (`tests/setup-env.ts:4`).
- The canonical env-clear prefix applies to every vitest gate verbatim:

  ```
  unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED
  ```

  The S05 mailer and transports gates extend it with
  `MAIL_TRANSPORT AUTH_SECRET RESEND_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM`.
  The S04 contract gate keeps `PG_CONTRACT_URL` untouched because the suite
  requires it. Any flag a future auth test observes joins the list, never
  leaves it.
- Env changes inside tests follow the save and restore pattern in
  `tests/config/feature-flags.test.ts:21-38`: an `ENV_KEYS` list, a
  `beforeEach` delete, and an `afterEach` restore.
- The database is faked by mocking `getServerPersistenceProvider` from
  `@/lib/persistence/server-provider` with a pool-shaped object, following
  the established fake in
  `tests/agent-runtime/stage-meta-routes.test.ts:1-33`.
- The claim-migration test proves that anonymous courses and agent sessions
  follow the user across the sign-in (Q6), using the exact column list in
  S04.
- Non-capturable deliverables bind through gates only. The rivr capture
  symbol router supports only `.rs`, `.md`, `.markdown`, `.txt`, `.text`,
  `.ts`, `.tsx`, `.js`, `.jsx`. `package.json`, `.env.example`, and locale
  `.json` files are not capturable, so they never appear as target symbols.
  Their deliverables bind through gates and evidence strings: `PKG_OK` for
  the dependency, `SEED_ENV_OK` and `ENV_DOC_OK` for `.env.example`,
  `I18N_NS_OK` for the `auth` locale namespace. The ledger builder must keep
  this rule.
- Gate hygiene. Every gate command echoes a literal success marker. No gate
  relies on exit code alone. The rivr gate runner treats expect strings as
  literal substrings, so every marker is a plain literal.
- Plan-time state. Gates whose suites do not exist yet fail today with "No
  test files found" and no marker. The presence gates fail until their
  variables land in `.env.example` or the locale namespace exists. The
  soundness review verified the marker mechanics on the S02 probe
  (`docs/research/013-spec-soundness-review.md:182-190`). These failures are
  the documented deliverable-dependent state, not gate defects.
- The lint entry guard stays untouched. Auth code makes no model calls and
  never imports `ai` or `lib/ai/llm.ts` outside that module. If a
  password-reset email path ever needs LLM copy, it does not, so no guard
  change is made. Run `tests/lint-llm-entry-guard.test.ts` as a probe.
- The provider-neutrality guard stays green. Run it in S02.
- i18n parity is enforced by `pnpm check:i18n-keys` (`package.json:19`),
  with `en-US.json` as the source of truth and the `auth.*` namespace filled
  in all 12 locale files.
- Commands to name per slice: S01 runs `auth-core.test.ts` and
  `session-roundtrip.test.ts`. S02 runs `role-seed.test.ts` and the provider
  guard. S03 runs `session-routes.test.ts` and the i18n checks. S04 runs
  `claim-migration.test.ts`, `claim-scheme.test.ts`,
  `owner-threading.test.ts`, `claim.pg.test.ts`, and
  `claim-adversarial.test.ts`. S05 runs `mailer.test.ts`,
  `mailer-transports.test.ts`, and the `.env.example` presence checks.

## Out of Scope

- Gating and quotas (batch C), the permission catalog and `can()` (batch B),
  publishing and audience (batch D), the admin UI and invites (batch E), and
  custom role CRUD (batch F).
- Password reset email. Verification resend ships. Password reset is stated
  as deferred.
- OAuth providers, the organization plugin, 2FA, and SaaS auth surfaces.
- Any change to `@openmaic/storage` or any other publishable package.

## Further Notes

- The program record is `docs/meta-specs/rbac-minimal-mode.md`. Read it
  alongside this spec. It holds the decision register, the capability
  matrix, the global constraints, and the acceptance criteria.
- The soundness review re-dry-runs every gate command in this spec against
  the live CLI before implementation starts.
- The visual-preview checkpoint runs before implementation. Login, signup,
  and account-menu mockups render in localhost and are approved in Safari
  first, per the approved extension of Q9 to batch A.
- Commit convention for this batch: `feat(auth): ...`.
- Every new operator-facing env var is documented in `.env.example` in the
  same change (S02 and S05).
- The client mirror flag for minimal mode is deferred to batch C. Batch C
  owns the final name. The meta-spec register records the two candidate
  names, `NEXT_PUBLIC_MINIMAL_MODE` and `NEXT_PUBLIC_MIRROR`, for batch C.
  Neither is introduced in this batch.

## Amendment 2026-09-04 (guest default role)

The design-pass review caught that this spec did not state the default signup role. The approved decision record Q3 (`docs/research/rbac-minimal-mode-decision-round-1.md`) assigns `guest` at verified signup. This amendment records the explicit statement in the Role seed decision, user story 7, and the two clause refinements on S01 `createAuthServer` and S02 `seedRoleGrants`. The gate inventory is unchanged. The ledger binds this text via a `correction` amend and then re-syncs expectations.