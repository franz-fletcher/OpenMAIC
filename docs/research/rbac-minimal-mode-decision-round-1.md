# RBAC + Minimal Mode: Decision Round 1

Status: waiting for your answers. Annotate each question with your choice or
correction. Nothing is built until you approve the spec.

## What the research found

Codebase audit:

- No user, session, or account concept exists today. Identity is three
  primitives: a site-wide `ACCESS_CODE` cookie lock, an `anonymous_id` owner
  cookie, and a public dev-only token.
- The owner resolver (`lib/server/agent-runtime/owner.ts:46-65`) already has an
  unused `authenticatedOwnerId` parameter. Its comment names the three call
  sites a real auth must thread through. That is our migration seam.
- `stage_meta` already stores `owner_id`, `is_public`, `published_at`, and
  `deleted_at`. Publish and unpublish routes exist. They already answer
  `401 login_required` for anonymous owners, a dead end because no login exists.
- The document read gate ignores `is_public`. Privacy today is URL obscurity.
  The audience feature must close this hole or we ship it knowingly.
- Every LLM route (`generate/*`, `chat`, `quiz-grade`, `pbl/v2`, `tts`, `image`,
  `video`) is fully unauthenticated. Minimal mode needs a server-side guard,
  not just UI hiding.
- No email, no quota, no admin surface exists. The `server-providers.yml`
  js-yaml loader is a proven env/yaml defaults carrier we can copy.

Prior art:

- Auth.js is now owned by Better Auth Inc. Their guidance is to start new
  projects on better-auth. It ships email+password signup, built-in email
  verification, custom roles with access-control statements checked on server
  and client, an admin plugin (setRole, listUsers, ban, impersonate), and
  first-party Next 16 support.
- Lucia is deprecated. Clerk and Stytch are SaaS-only. Ory Kratos is a separate
  service. Auth.js v5 is still beta and leaves all RBAC to us.
- One fit gap: better-auth statements cannot express ownership conditions such
  as "edit courses you authored". That stays app-level SQL glue, which this
  repo already does well.

## The questions

### Q1 - Auth library confirmation

The research strongly favors better-auth 1.7.x. Minor versions can carry
breaking changes, so we pin the minor version and wrap every auth call behind
our own `lib/auth/` module.

Recommendation: adopt better-auth, pinned, fully wrapped. No auth-library
import anywhere else in the app.

Your answer:

### Q2 - Invitations mechanism

The better-auth invite flow lives in the organization plugin. That plugin
drags in an org and membership concept you did not ask for. The admin plugin
covers role assignment but not invites. Alternative: our own small `invites`
table (email, role, token, expiry, accepted-by), one create route, one accept
page, one email template. About 300 lines of glue. Roles stay global instead
of org-scoped.

Recommendation: hand-rolled lightweight invites table. Admin plugin for user
management. Skip the organization plugin.

Your answer:

### Q3 - Capability matrix

Confirm or correct each row. The two assumption cells are learner unlimited
in-class LLM, and guest limited to quiz-grade calls only.

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

Recommendation: rows as written.

Your answer:

### Q4 - MINIMAL_MODE semantics and naming

The flag must be server-enforced because client flags are bypassable.
Server-only `MINIMAL_MODE=true` is the source of truth. A build-inlined
`NEXT_PUBLIC_MINIMAL_MODE` mirror only hides UI affordances. When the flag is
off, the app behaves exactly as today. Signup and login stay available even
when off, so operators can seed users before switching on. New vars go to
`.env.example`. We avoid the words "token" and "plan" in new identifiers
because of the provider-neutrality guard.

Recommendation: agree as stated.

Your answer:

### Q5 - First admin bootstrap

Someone must be admin before any admin UI exists. Options: an env var listing
admin emails (`ADMIN_EMAILS`), auto-granted at verified signup. Or a CLI
bootstrap command.

Recommendation: `ADMIN_EMAILS` env plus optional `server-roles.yml` that maps
emails to roles (admin, creator, learner). Env and yaml seed defaults. The
database then owns truth, and the admin UI can override per user.

Your answer:

### Q6 - Anonymous-to-authenticated course migration

Courses live under `anon:<uuid>` in cookies. On signup in the same browser the
old courses would orphan unless moved. Options: (a) auto-claim all
`anon:`-owned rows on first verified login and thread `authenticatedOwnerId`
through the three documented call sites. (b) leave them stranded.

Recommendation: (a), with a test proving agent sessions and courses follow the
user. This is the seam owner.ts pre-planned.

Your answer:

### Q7 - Publish audience model

Proposal: replace the boolean `is_public` with `status` (draft/published) plus
`audience` (everyone/guest/learner) on stage_meta. The table is app-owned and
uses `ADD COLUMN IF NOT EXISTS`, so migration is cheap and reversible. The
creator picks the audience at publish time. Drafts stay owner-visible only.
A per-user share list for drafts is a bigger build and is deferred. The read
gate is fixed so unpublished and wrong-audience courses return 404 at the API
level.

Recommendation: audience tiers only for v1. Existing `is_public=true` rows
migrate to published/everyone. Creators hand out direct `/classroom/[id]`
URLs for drafts.

Your answer:

### Q8 - Custom roles and permission granularity

Proposal: a fixed permission catalog defined in code (`course.create`,
`course.publish`, `classroom.chat`, `quiz.grade`, `settings.manage`,
`users.manage`, `roles.manage`). Admins create custom roles and toggle catalog
checkboxes per role. Admins cannot invent new permission strings, because
every permission needs an enforcement site in code anyway. Role-to-permission
assignments live in the database, seeded from env/yaml, overridable in the UI.

Recommendation: fixed catalog, DB-stored assignments, one `can(user,
permission)` helper used by route guards and UI hiding alike.

Your answer:

### Q9 - Program decomposition

This exceeds one batch. Following the repo's meta-spec pattern, six child
batches, each with its own spec, ledger, approval, and cycle:

| # | Batch | Ships |
|---|---|---|
| A | auth-foundation | better-auth wiring, PG tables, signup+verification, login/logout, session helper, owner auto-claim, env/yaml role seeds |
| B | permission-core | role model, permission catalog, `can()` helper, server route guards, client affordance hooks |
| C | minimal-mode-gating | MINIMAL_MODE flag, gate every LLM route per matrix, guest 5/day quota |
| D | publishing-visibility | status+audience columns, publish UI, audience-enforced read gate, public gallery page |
| E | admin-suite | admin settings section: user list, role assign, ban, invite-by-email |
| F | role-permission-editor | custom role CRUD UI, catalog toggles, yaml-default display |

Recommendation: approve the decomposition and order. Batches C through F each
get a visual-preview checkpoint in localhost + Safari before code lands.

Your answer:

### Q10 - Email delivery

nodemailer over SMTP, credentials from env (`SMTP_HOST/PORT/USER/PASS`,
`MAIL_FROM`). When SMTP is unconfigured, verification and invite links log to
the server console instead of sending, so the flow is testable without a mail
server.

Recommendation: agree.

Your answer:

### Q11 - Table placement

Auth tables (better-auth schema), `invites`, `role_permissions`, and
`quota_daily` live app-side under `lib/auth/` with the repo's lazy
`ensureSchema` pattern on the existing `pg.Pool`. They do not go into the
publishable `@openmaic/storage` package. That avoids a version bump, the
byte-pinned schema contract churn, and the package-independence lint rules.

Recommendation: agree, unless you want auth storage packaged for reuse.

Your answer:

---

## After your answers

I resolve follow-up branches if any answer opens one. When the frontier is
empty, I write the meta-spec plus the batch-A spec for your explicit approval.
No code lands before that.

## Round 3 (2026-09-04, user-annotated home screenshot)

The user annotated the live home page. These decisions are binding:

- Q1 resolved: **V2 placement**. The account zone sits in the top header
  capsule, stage/classroom style. The hero GreetingBar retires from the hero.
- The hero OpenMAIC logo and tagline are removed from the home page.
- The header top-left shows a configurable site name and tagline. Sources:
  env (`SITE_NAME`, `SITE_TAGLINE`), yaml, and later the admin settings modal
  (batch E override, same defaults-then-DB doctrine).
- All OpenMAIC logos across the site honor a visibility toggle from env/yaml
  (`SHOW_LOGO`).
- The top-right capsule order: language, theme, Pro toggle, account zone,
  settings gear.
- Minimal-mode layout rule for anonymous, guest, and learner: the entire
  composer and generation-toolbar container is hidden. The course and folder
  library expands into a multi-column grid that fills the freed space. This
  behavior ships in batch C; the layout is defined by the branding/header work.
- Everything else in the batch A design preview is approved as shown.

Program structure change: branding and header chrome become child batch G
(spec `014-branding-header`), implemented BEFORE batch A, so the V2 capsule
chrome exists when the account zone lands. Batch A S03 rides on it.
