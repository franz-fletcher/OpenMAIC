# Meta-spec: rbac-minimal-mode

Meta-spec status: research

## Problem Statement

The app has no account concept. Identity is three primitives: a site-wide
`ACCESS_CODE` cookie lock, an `anonymous_id` owner cookie, and a public
development token. Every audit claim below was re-verified against the working
tree on 2026-09-04.

- The `ACCESS_CODE` lock checks an HMAC cookie in Edge middleware
  (`middleware.ts:60-86`, `verifyToken` at `middleware.ts:18-44`). Page
  requests pass and the frontend shows a modal. It has no notion of a user.
- The owner resolver returns an `anon:<uuid>` identity from the
  `anonymous_id` cookie, or a fresh UUID (`lib/server/agent-runtime/owner.ts:
  52-65`, cookie name at `owner.ts:3`). The function already accepts an
  `authenticatedOwnerId` parameter, but its own comment names the future auth
  integration as the reason (`owner.ts:46-50`), and no caller passes one.
- `stage_meta` already stores `owner_id`, `is_public`, `published_at`, and
  `deleted_at` (`lib/persistence/stage-meta.ts:24-48`). Publish refuses
  anonymous owners with `401 login_required`
  (`app/api/stages/[id]/publish/route.ts:26-31`), a dead end because no login
  exists.
- The document read gate ignores `is_public`: any live stage is readable
  (`lib/persistence/document-access.ts:70-74`). Privacy today is URL
  obscurity.
- Every LLM route is unauthenticated: `app/api/generate/*`
  (`app/api/generate/tts`, `app/api/generate/image`, `app/api/generate/video`,
  `app/api/generate/voice`), `app/api/chat`, `app/api/quiz-grade`,
  `app/api/pbl/v2`, `app/api/transcription`, `app/api/extract-document`,
  `app/api/web-search`, `app/api/usage`.
- No email infrastructure exists. No quotas exist: the quota hook is a stub
  (`lib/agent/runtime/quota.ts:3-13`) wired to `Number.MAX_SAFE_INTEGER`
  (`lib/agent/runtime/build-agent.ts:66`).
- No admin surface exists. Settings has a section union
  (`lib/types/settings.ts:3-14`) rendered by `SettingsDialog`
  (`components/settings/index.tsx`, props at `:204`), with no admin section.
- Persistence is raw `pg` with lazy, idempotent `CREATE TABLE IF NOT EXISTS`
  schema ensures and no migration files
  (`lib/persistence/server-provider.ts:36-67`, ensure chain at `:43-47`).
- A js-yaml operator config precedent exists: `server-providers.yml` with
  `DEFAULT_FILENAME` at `lib/server/provider-config.ts:354` and
  `loadYamlFile` at `lib/server/provider-config.ts:208`.
- The dev-only bearer token is documented as replaceable
  (`lib/persistence/server-auth.ts:2-13`, "Production must replace this module
  with real session verification" at `:10-12`).

Operators cannot seed users before going live, courses stay bound to cookies
that evaporate between browsers, there is no email delivery, and every
AI-spend route is open to anyone holding the access code. This program fixes
that with a seven-batch RBAC and minimal-mode build.

## Solution

The program ships a complete role-based access layer and a server-enforced
minimal mode, in seven sequenced child batches. Each batch is a full RIVR cycle
with its own spec, ledger, approval, and verification.

The library is better-auth 1.7.x, pinned to the minor version and fully
wrapped behind the app's own `lib/auth/` module. All auth tables live
app-side on the existing `pg.Pool`, never in the publishable
`@openmaic/storage` package. Identity becomes a stable per-user owner id,
anonymous courses and agent sessions auto-claim to that id on first verified
sign-in, and server-side guards enforce the approved capability matrix. A
server-only `MINIMAL_MODE` flag turns the guest experience into a locked-down
subset, while `ACCESS_CODE` keeps working as an independent network-level
curtain.

## Architecture Record

Target state after all seven batches, anchored to current code where the seams
already exist.

### Identity and owner ids

- The authenticated owner id is the string `user:<auth-user-id>` where
  `auth-user-id` is the better-auth user id. It is stable for the life of the
  user. The `anon:` prefix keeps its current meaning
  (`owner.ts:60`). The two prefixes never overlap.
- `resolveRequestOwnerId` already returns an explicit authenticated owner
  verbatim (`owner.ts:57`). Batch A threads it through the wrapper
  `withRequestOwnerId` (`lib/server/agent-runtime/with-owner.ts:12`) and the
  three direct call sites: `app/api/agent/owner-events/route.ts:49`,
  `app/api/agent/sessions/[id]/events/route.ts:77`, and
  `app/api/stages/[id]/freshness/route.ts:50`. Twenty routes consume the
  wrapper today (agent sessions, skills, folders, materials, persistence), so
  they all gain authenticated owners through it.
- `stage_meta.owner_id` holds whichever id claimed the document
  (`lib/persistence/stage-meta.ts:27`). The claim migration reads the
  `anonymous_id` cookie from the first verified-sign-in request
  (`owner.ts:3`), then rewrites that device's `anon:<uuid>` values to
  `user:<id>`. Exact owner columns touched: `stage_meta.owner_id`
  (`stage-meta.ts:27`), `document_stages.owner_id`
  (`packages/@openmaic/storage/src/document/pg.ts:84-96`),
  `document_folders.owner_id` (`document/pg.ts:60`), `agent_sessions.owner_id`
  (`packages/@openmaic/storage/src/agent-session/pg.ts:90`),
  `agent_owner_session_events.owner_id` (`agent-session/pg.ts:162`),
  `agent_owner_session_event_counters.owner_id` (`agent-session/pg.ts:156`),
  `agent_user_skill.owner_id` (`packages/@openmaic/storage/src/skill/pg.ts:53`),
  and `owner_material.owner_id` (`lib/persistence/owner-materials.ts:105`).
  The counters column is a primary key, so the migration merges, it does not
  collide.

### Persistence

- All new tables are app-owned and created through the same lazy idempotent
  `ensureSchema` pattern as `STAGE_META_SCHEMA`
  (`stage-meta.ts:24-55`), composed into the provider bootstrap chain
  (`server-provider.ts:43-47`). No migration framework is introduced.
- Table owners by batch: A creates `user`, `session`, `account`,
  `verification` (better-auth canonical schema), `roles`, and `user_roles`.
  B creates `role_permissions`. C creates `quota_daily`. E creates
  `invites`. This follows the Q11 decision recorded below.
- Roles carry integer ranks: anonymous 0, guest 1, learner 2, creator 3,
  admin 4. Anonymous rank 0 is a virtual constant for unauthenticated
  requests. The other four are seeded system rows.

### Mail

- A mailer transport interface lives at `lib/auth/mailer.ts`. The transport
  is chosen by `MAIL_TRANSPORT` (`smtp` or `resend`). nodemailer serves
  `smtp`, the Resend SDK serves `resend`, and an unset or unknown value
  selects the console-link fallback, which logs the link instead of sending.

### Session flow

- Session verification is DB-backed in the Node runtime. `middleware.ts`
  stays Edge and gains no database calls. The `ACCESS_CODE` HMAC logic at
  `middleware.ts:60-86` is untouched by every batch.

## Child Batches

| # | Batch | Ships | Depends on |
| --- | --- | --- | --- |
| A | auth-foundation | better-auth wiring, PG tables, signup and verification, login and logout, session helper, owner auto-claim, env and yaml role seeds | G |
| B | permission-core | role model, permission catalog, `can()` helper, server route guards, client affordance hooks | A |
| C | minimal-mode-gating | `MINIMAL_MODE` flag, gate every LLM route per matrix, guest 5 per day quota. The minimal-mode layout rule (composer container hidden for anonymous, guest, and learner; the library expands into a multi-column grid) is specced here and previewed in G's approved mockups | A, B |
| D | publishing-visibility | status and audience columns, publish UI, audience-enforced read gate, public gallery page | A, B |
| E | admin-suite | admin settings section: user list, role assign, ban, invite by email | A, B |
| F | role-permission-editor | custom role CRUD UI, catalog toggles, yaml-default display | B (E for UI pattern) |
| G | branding-header | branding config loader (env + `server-branding.yml`), public branding route and client hook, header chrome rebuild: top-left site name and tagline, V2 capsule standardization, Pro toggle seat, hero logo and tagline removal, site-wide logo visibility toggle | none |

The scope lines above are the approved Q9 decomposition, verbatim in intent
from `docs/research/rbac-minimal-mode-decision-round-1.md` (table at
`:160-168`). Batch A scope is fully specified in
`docs/specs/013-rbac-auth-foundation.md`. Batch G scope comes from the Round
3 section (`docs/research/rbac-minimal-mode-decision-round-1.md:206-228`) and
is fully specified in `docs/specs/014-branding-header.md`.

## Decision Register

All decisions approved. The register condenses the decision record and the
round-2 deltas.

| # | Decision | Approved answer |
| --- | --- | --- |
| Q1 | Auth library | Adopt better-auth 1.7.x, pinned to the minor, fully wrapped behind `lib/auth/`. No auth-library import anywhere else in the app. |
| Q2 | Invitations mechanism | Hand-rolled lightweight `invites` table, one create route, one accept page, one email template, batch E. Admin plugin for user management. Skip the organization plugin. Roles stay global, not org-scoped. |
| Q3 | Capability matrix | Rows as written. Guest is limited to quiz-grade only, 5 per day. Learner is unlimited in-class LLM. Guest quota day resets at UTC midnight (round-2 delta). |
| Q4 | MINIMAL_MODE semantics | Server-only `MINIMAL_MODE=true` is the source of truth because client flags are bypassable. A build-inlined `NEXT_PUBLIC_MINIMAL_MODE` mirror only hides UI affordances. Flag off means the app behaves exactly as today. Signup and login stay available when the flag is off so operators can seed users first. New vars go to `.env.example`. New identifiers avoid the words "token" and "plan" because of the provider-neutrality guard. |
| Q5 | First admin bootstrap | `ADMIN_EMAILS` env plus optional `server-roles.yml` mapping emails to roles. Env and yaml seed defaults. The database owns truth after seeding. The admin UI can override per user. |
| Q6 | Anonymous to authenticated migration | Auto-claim all `anon:`-owned rows on first verified login, and thread `authenticatedOwnerId` through the three documented call sites. A test proves agent sessions and courses follow the user. |
| Q7 | Publish audience model | Replace the boolean `is_public` with `status` (draft, published) plus `audience` (everyone, guest, learner) on `stage_meta`, via `ADD COLUMN IF NOT EXISTS`. The creator picks the audience at publish time. Drafts stay owner-visible only. Per-user draft share lists are deferred. The read gate returns 404 for unpublished and wrong-audience courses. Existing `is_public=true` rows migrate to published and everyone. |
| Q8 | Custom roles and permission granularity | A fixed permission catalog defined in code: `course.create`, `course.publish`, `classroom.chat`, `quiz.grade`, `settings.manage`, `users.manage`, `roles.manage`. Admins toggle catalog checkboxes per role and cannot invent new permission strings. Assignments live in the database, seeded from env and yaml, overridable in the UI. One `can(user, permission)` helper serves route guards and UI hiding alike. |
| Q9 | Program decomposition | Six child batches, each with its own spec, ledger, approval, and cycle, in the order A through F as tabled above. Round-2 delta: batches A and B join C through F in requiring a Safari localhost visual-preview checkpoint before code lands. Amended by the round-3 register: seven batches with G first. |
| Q10 | Email delivery | nodemailer over SMTP, credentials from env. When SMTP is unconfigured, verification and invite links log to the server console instead of sending. |
| Q11 | Table placement | Auth tables, `invites`, `role_permissions`, and `quota_daily` live app-side under `lib/auth/` with the lazy `ensureSchema` pattern on the existing `pg.Pool`. They do not go into the publishable `@openmaic/storage` package. This avoids a version bump, the byte-pinned schema contract churn, and the package-independence lint rules. |
| Q12 | Role rank model | Audiences store an integer ROLE RANK, never a role name. Roles carry a stable rank. Seeded ranks: anonymous 0, guest 1, learner 2, creator 3, admin 4. Custom roles get an admin-chosen rank. Rank edits re-resolve visibility live. Built-in roles are undeletable. Custom role deletion requires reassigning its users first. |
| Q13 | Mailer transport interface | A mailer transport interface selected by env: `MAIL_TRANSPORT=smtp|resend`. nodemailer for SMTP, Resend SDK for the HTTP API, console-link fallback when unconfigured. The interface keeps SendGrid and Postmark a small addition. |
| Q14 | ACCESS_CODE independence | `ACCESS_CODE` stays an independent network-level curtain in all modes, with no behavioral coupling to roles or minimal mode. Boot-time log warning when `MINIMAL_MODE` and `ACCESS_CODE` are both set. |

The mirror flag name is a settled deferral. Q4 and the decision doc name the
client mirror flag `NEXT_PUBLIC_MINIMAL_MODE`. The batch-A brief names it
`NEXT_PUBLIC_MIRROR`. Batch C owns the final name, and this register records
both candidates for it. Neither exists before batch C.

### Round 3 register (2026-09-04)

| # | Decision | Approved answer |
| --- | --- | --- |
| R3-Q1 | Capsule V2 placement | The account zone sits in the top header capsule, stage/classroom style. The hero GreetingBar retires from the hero. Batch A S03 rides the V2 chrome. |
| R3-Q2 | GreetingBar seat | The hero GreetingBar seat is retired. The greeting no longer renders on the home hero. |
| R3-Q3 | Branding config | The header top-left shows a configurable site name and tagline. Sources: env (`SITE_NAME`, `SITE_TAGLINE`), yaml, then the admin settings modal in batch E. The doctrine stays defaults then database. All OpenMAIC logos honor a visibility toggle (`SHOW_LOGO`) from env and yaml. |
| R3-Q4 | Capsule order | The top-right capsule order is language, theme, Pro toggle, account zone, settings gear. G ships the capsule with an empty account slot. |
| R3-Q5 | Minimal-mode layout rule | For anonymous, guest, and learner, the composer and generation-toolbar container is hidden and the library expands into a multi-column grid. The behavior ships in batch C. The branding and header work defines the layout, and G's approved mockups preview it. |
| R3-Q6 | Pro toggle semantics | The home capsule Pro toggle is a workbench entry affordance, the same intent as today's hero ProBadge routing to the Pro workbench. It is not the stage edit-mode switch. Visibility is creator and admin only, enforced in batch C. G preserves today's ungated visibility. |
| R3-Q7 | Hero headline | Batch G owns `home.headline` with the copy "Turn any material into a living classroom" and 12-locale parity at implementation. `SHOW_HEADLINE` (readBoolean, env + `server-branding.yml`, batch E admin override) toggles the hero headline visibility. |
| R3-Q8 | Config badge | The "env · yaml" config badge from the approved mockup is mockup-only. It does not ship in user UI. |
| R3-Q9 | Footer credit | The footer credit "OpenMAIC Open Source Project" stays static. `SHOW_LOGO` does not touch it. |

Program structure change: batch G certifies before batch A. The V2 capsule
chrome must exist before the account zone lands
(`docs/research/rbac-minimal-mode-decision-round-1.md:226-228`).

## Capability Matrix

Verbatim from `docs/research/rbac-minimal-mode-decision-round-1.md` (table at
`:72-82`). This matrix is the program's contract. Every cell must be enforced
server-side, not only hidden in the UI.

| Capability | anonymous | guest | learner | creator | admin |
|---|---|---|---|---|---|
| Browse public course gallery | yes | yes | yes | yes | yes |
| Open courses by link | only audience=everyone | + guest-targeted | + learner-targeted | yes | yes |
| In-class LLM chat / playback | no | no | yes | yes | yes |
| AI-graded tests (quiz-grade) | no | 5 per day | yes, unlimited | yes | yes |
| TTS/ASR in-class features | no | no | yes | yes | yes |
| Create/edit/delete courses (pro prompts) | no | no | no | yes | yes |
| Publish/unpublish | no | no | no | own courses | any |
| Settings modal (providers, keys) | no | no | no | no | yes |
| Admin user management | no | no | no | no | yes |

## Global Constraints

These bind every batch, including batch A.

- No publishable-package changes. All new code is app-side under `lib/`,
  `components/`, `app/`, and `tests/`. The version-bump gate diffs only the
  package directories (`scripts/check-package-version-bumps.mjs:181-203`),
  with ignored inputs at `:8-11`. No batch may touch `packages/@openmaic/*`.
  The authoritative package list is `scripts/openmaic-packages.mjs:34` (dsl,
  generation, storage, renderer, editor, importer). The "five owned packages"
  wording at `check-package-version-bumps.mjs:13-14` is stale prose, not gate
  logic.
- Every LLM call stays behind `callLLM` and `streamLLM` in `lib/ai/llm.ts`.
  The entry guard is pinned by `tests/lint-llm-entry-guard.test.ts` (`:44-58`).
  Auth code makes no model calls.
- All UI text uses i18n keys. `en-US.json` is the source of truth. Key parity
  must hold across all 12 locale files (`lib/i18n/locales`). The parity check
  is `pnpm check:i18n-keys` (`package.json:19`).
- New identifiers and env var names never contain the substrings "token" or
  "plan". The provider-neutrality guard derives vendor vocabulary from
  registry ids, and `qwen-token-plan-tts` already derives those two words
  (`tests/providers/provider-neutrality-guard.test.ts:212-217`). Batches that
  guard LLM routes edit files already on `PROVIDER_NEUTRAL_FILES`
  (`tests/providers/provider-neutrality-guard.test.ts:58-90`), so the
  vocabulary must stay clean from day one.
- `middleware.ts` stays Edge. No database calls there. `ACCESS_CODE` behavior
  is invariant (Q14).
- Databases change only through the lazy idempotent `ensureSchema` pattern.
  No migration framework files.
- Every operator-facing env var is documented in `.env.example` in the same
  change that introduces it.
- Gates must be silent-success-safe. Every gate command echoes a literal
  success marker on exit, because the rivr gate runner treats expect strings
  as literal substrings and exit-code-only oracles are dead. Env-sensitive
  vitest gates prefix `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE`
  because rivr gate children inherit `.env.local`. Root vitest is hermetic
  (`tests/setup-env.ts:1-19`), but the gate runner is not.
- Role rank integers, not role names, define audience. Rank edits re-resolve
  visibility live (Q12).

## Per-Batch Dependency Order

Each batch may assume exactly what its predecessors certified and nothing
more.

| Batch | Depends on | May assume from predecessors |
| --- | --- | --- |
| G | none | Defines the branding config surface and the V2 capsule chrome. Nothing else. |
| A | G | The V2 capsule chrome and its empty account slot from G, plus its own owner id scheme, roles table and ranks, and session surface. |
| B | A | `user`, `session`, `roles`, `user_roles` tables, `requireSession`, the owner id scheme. Adds the permission catalog, `role_permissions`, and `can()`. |
| C | A, B | Route guards from B, sessions from A. Adds `MINIMAL_MODE`, the client mirror, gates over every LLM route, and `quota_daily` with the guest 5 per day quota reset at UTC midnight. |
| D | A, B | Owner id from A, `can()` from B. Adds `status` and `audience` to `stage_meta`, the publish UI, the enforced read gate, and the public gallery. Does not assume minimal mode. |
| E | A, B | Sessions, roles, `can()`, and the mailer interface from A. Adds the `invites` table, the admin settings section, user list, role assign, ban, and invite by email. |
| F | B | `role_permissions` and `can()`. Adds custom role CRUD, catalog toggles, and yaml-default display. Uses E's admin UI patterns once E certifies. |

The strict sequence is G, then A, then B, then C through F in order. D and E
may prepare UI work in parallel after B certifies, but each still certifies in
sequence.

## Out of Scope

The program does not build these, even though adjacent products might.

- Per-user draft share lists (deferred by Q7).
- The organization plugin from better-auth (rejected by Q2).
- SaaS auth providers: Clerk, Stytch, single sign-on.
- CASL or any permission library, unless ownership conditions become a
  hard requirement. The audit found no such requirement today.
- Package-publishable auth storage (rejected by Q11).
- A mobile app and its auth flows.
- Password reset email, OAuth providers, and 2FA. Batch A names them as deferred. They stay out of scope for the program.

## Process Rules

- Every batch receives explicit human spec approval before its ledger is
  built. No ledger exists without that approval.
- Every batch receives a soundness review before approval. A fresh researcher
  who did not write the spec dry-runs every gate against the live CLI, checks
  each contract symbol against the outline sources, and writes
  `docs/research/NNN-spec-soundness-review.md`. Blockers return to the spec
  author. The review never replaces the human gate.
- Every batch builds its own ledger and runs its own full cycle.
- Every batch that touches UI holds a visual-preview checkpoint before code
  lands. The approved decision extends this to all seven batches. Mockups
  render in localhost and are verified in Safari first.
- Every client change is verified in Safari before certification.
- The implementer never verifies their own work. Verification is a separate
  role, per the RIVR cycle.

## Acceptance Criteria

The program is done when all of these hold.

- All seven child batches certify, each with its ledger closed and its
  postconditions met.
- The capability matrix is enforced server-side. Route guards match every
  matrix cell, and UI hiding is only a second layer.
- The guest quota is proven. Quiz-grade is limited to 5 per UTC-midnight day
  for guests, enforced server-side, and the reset is proven by a test at the
  UTC boundary.
- Publish audience is proven. Unpublished and wrong-audience courses return
  404 at the API level, and the public gallery lists only published courses
  the visitor's rank may open.
- The admin suite is usable end to end. An operator invites an email to a
  verified role, and the invited user reaches that role after signup and
  verification.