# Batch 018 spec soundness review

Reviewer: independent spec-soundness reviewer (fresh eyes for 018; previously
reviewed batches 013, 014, 015, 016, and 017). The reviewer did not write the
spec. Probes and gate dry-runs ran on 2026-09-06 against the working tree at
HEAD on `main`.

Reviewed documents:

- `docs/specs/018-admin-suite.md` (draft, batch E).
- Predecessor specs for context and anchors: `docs/specs/013` (batch A),
  `docs/specs/015` (batch B), `docs/specs/016` (batch C), `docs/specs/017`
  (batch D).
- `docs/meta-specs/rbac-minimal-mode.md` (Q-register, capability matrix,
  per-batch dependency row, acceptance criteria) and
  `docs/research/rbac-minimal-mode-decision-round-1.md` (decision source).
- Live sources probed: `lib/auth/schema.ts`, `lib/auth/roles.ts`,
  `lib/auth/server.ts`, `lib/auth/index.ts`, `lib/auth/permissions-server.ts`,
  `lib/auth/mailer.ts`, `lib/persistence/audience.ts`,
  `lib/persistence/server-provider.ts`, `lib/persistence/stage-meta.ts`,
  `lib/persistence/document-access.ts`, `lib/persistence/gallery.ts`,
  `lib/server/agent-runtime/with-owner.ts`, `lib/server/classroom-storage.ts`,
  `lib/config/feature-flags.ts`, `lib/types/settings.ts`,
  `components/account-zone.tsx`, `components/header-capsule.tsx`,
  `components/settings/index.tsx`, `app/page.tsx`,
  `app/api/classroom-media/[classroomId]/[...path]/route.ts`,
  `app/api/classroom/route.ts`, `app/api/stages/[id]/route.ts`,
  `app/api/stages/[id]/publish/route.ts`,
  `app/api/stages/[id]/unpublish/route.ts`, `app/signup/page.tsx`,
  `lib/i18n/locales/en-US.json`, `tests/minimal-mode/minimal-layout.test.ts`,
  `tests/agent-runtime/event-notify.pg.test.ts`,
  `tests/providers/provider-neutrality-guard.test.ts`,
  `tests/media/classroom-media-bytes.test.ts`,
  `tests/api/classroom-media-range.test.ts`, and the installed
  `better-auth@1.7.2` declaration files in `node_modules/better-auth`.

Method: file-to-line existence checks against live source, symbol signature
comparisons, env-prefix byte comparison against the 016 and 013 gate texts,
gate dry-runs from the repo root with the exact `unset` prefixes (presented
below), tier re-count from the spec file, and a schema probe of the installed
better-auth for the ban-column question. No code changed. Only this file was
created.

## Verdict

**Approve-after-fixes.** Two blockers. B1 repeats the typed-403 passthrough
gap from the 017 review, now across four new admin route families and the
admin page. B2 is a determinism gap in the cold-boot probe: the named seam
cannot force the auth-side cold start, so the S6 adversarial gate cannot pass
as written. The contract surface, the ban decision, the media gate design,
and the gate inventory are otherwise sound.

## BLOCKERS

### B1. The spec pins the guards but never pins how a typed 403 survives the catch layers.

`requirePermission` throws a `Response` with `{ message, code }` and status
403 (`lib/auth/permissions-server.ts:34-38,51-55`). Two catch layers flatten
that throw into a 500 in the route pattern this app uses. The callback catch
in `withRequestOwnerId` returns a plain 500 for any escape
(`lib/server/agent-runtime/with-owner.ts:40-45`), and the route-level
`try/catch` around handler logic does the same (the batch D publish route is
the live example, `app/api/stages/[id]/publish/route.ts:25-66`).

Batch D learned this exact class. The 017 spec pins the nested
Response-rethrow for publish and unpublish: the inner catch returns the
thrown `Response` unchanged so the typed 403 survives both outer catches
(`docs/specs/017-publishing-visibility.md:371-385`, the quiz-grade pattern at
`app/api/quiz-grade/route.ts:43-46`). The 018 spec cites that passage as the
precedent for unconditional gating (`018:396-397`), but it never adopts the
passthrough sentence for its own new surfaces:

- `app/api/admin/users/route.ts` GET and PATCH (`018:172-173`)
- `app/api/admin/invites/route.ts` POST and GET (`018:220-221`)
- `app/api/admin/invites/[id]/route.ts` DELETE (`018:222`)
- `app/api/admin/courses/[id]/route.ts` DELETE (`018:265`)

The postconditions and the adversarial gates assert exactly what the
passthrough protects. S2 requires "a non-admin never reaches the admin
routes" and "the typed 403 with code `banned` from any guarded call"
(`018:184-189`). The S2 adversarial gate drives the real routes and never
mocks the guard (`018:197-202`). Without a pinned passthrough, the denied
caller receives a 500 and the gate fails, the same failure the 017 review
predicted and batch D then fixed.

The admin page has a second face of the same problem. `AdminSettingsPage` is
a server component (`018:123`). A server component that throws a `Response`
does not deliver a typed 403. Next.js routes the throw to the error boundary
and renders a 500 surface. The S1 postcondition says a denied rank "receives
the typed 403 and sees no page content" (`018:140-145`), but the spec never
pins the page mechanism.

Fix, one sentence in the spec: every new route wraps the guard call as
`try { await requirePermission(...) } catch (err) { if (err instanceof
Response) return err; throw err; }`, the byte-exact shape 017 pinned, and
the admin page catches the guard throw and renders a dedicated not-authorized
state instead of letting it reach the error boundary.

### B2. The cold-boot probe cannot force the auth-side cold start, so the S6 gate cannot pass as written.

The S6 probe resets the provider, signs a real user, fires the first PUT,
and asserts the stage meta owner is `user:<id>` (`018:351`). The only cold
seam the spec names is `resetServerPersistenceProvider`
(`lib/persistence/server-provider.ts:100-112`), described as giving the
probe a cold start (`018:361-362`).

The reset closes the pool and clears the provider cache. It does not touch
the auth bootstrap. `lib/auth/index.ts:29-38` caches one `AuthServer` in the
module-scope `cachedAuth`. `createAuthServer` binds a kysely dialect to the
pool it is given (`lib/auth/server.ts:43`). That pool is the one the reset
ends.

The consequence: after the first reset, every later `getSession` through the
cached auth server hits the ended pool, the catch at
`lib/auth/index.ts:64-66` returns null, and `withRequestOwnerId` falls back
to the anonymous identity (`with-owner.ts:27-38`). The probe as sequenced
cannot sign a user after the reset without rebuilding the auth server, and
the getSession fix the spec pins ("waits for provider and auth readiness",
`018:349`) does not describe how `cachedAuth` is rebuilt or invalidated.
The two caches are independent. Nothing in the spec connects them.

Fix, one sentence in the spec: pin a test-only reset for the auth bootstrap
alongside the provider reset (or key `getAuth` to the provider generation),
and make the probe drive both cold starts. State the expected failure mode
the probe asserts, so a miswired reset cannot pass the gate vacuously.

## CONCERNS

### C1. The hermetic unit suites have no stated session wiring.

Six unit gates run without `PG_CONTRACT_URL` (S1 admin-page, S2 users-admin,
S3 invites, S3 invite-mailer, S4 admin-courses, S5 media-gate, S6
cold-boot-session). Without a database, `getSession` returns null through
the catch path, so every guarded call becomes an anonymous 403 unless the
suite seeds a session. The spec says "only `getSession` is seeded for
fixtures" for the adversarial gates (`018:201`) and that the live-wire gates
never mock it. It says nothing about how the hermetic suites authenticate.
The 017 review flagged this class for publish-routes (`017` C3) and the
018 spec does not close it. State the mock rule per suite family.

### C2. The pinned capsule test family is ignored.

`tests/minimal-mode/minimal-layout.test.ts` renders the real `AccountZone`
(`:161-163`) and the real `HeaderCapsule` (`:207+`, `:245`). The S1 bindings
change both prop shapes (`018:124-125`, adding `onOpenSettings`,
`onOpenAdmin`, and `settingsGated`). If any new prop is required, root
`tsc --noEmit` breaks across every smoke gate in the batch. The spec never
names this suite. Make the new props optional or pin the suite delta in S1.

### C3. S6 declares risk tier 4 with only 3 gates.

The tier table requires 4 gates minimum for tier 4, one tagged adversarial.
S6 lists unit, adversarial, and smoke (`018:371-373`). S2 and S5 meet the
count. S6 is one gate short. Add a fourth gate, for example a second unit
covering the anon-cookie path, or drop S6 to tier 3 with the integration tag.
Ledger accept fails on the mismatch as written.

### C4. The S5 adversarial gate prose contradicts its own command.

The risk note says the suite "toggles `MINIMAL_MODE` in-process because the
gate prefix clears it" (`018:333-338`). The gate sets `MINIMAL_MODE=true`
inline in the command (`018:330`), and the flag reads env at call time
(`lib/config/feature-flags.ts:147-151`, `permissions-server.ts:71-73`), so
no in-process toggle is needed. The command is correct. The sentence is
wrong and should go.

### C5. The i18n gate sits only in S1, but the invite keys land in S3.

The I18N gate (`018:150`) covers the `admin.*` keys. The `invite.*` group
ships in S3 with no i18n gate. The Testing Decisions claim the parity check
"runs wherever copy lands" (`018:506-507`). CI runs `check:i18n-keys` on
every change, so the invariant holds anyway. Add the gate to S3 or drop the
claim.

### C6. The neutrality-guard claim is vacuous.

Testing Decisions says the neutrality guard "runs on the slices that touch
guarded files" (`018:509`). No slice touches a file on
`PROVIDER_NEUTRAL_FILES` (the list at
`tests/providers/provider-neutrality-guard.test.ts:58-90` covers model
routes and `server-provider.ts`, not the auth or admin files this batch
edits), and no neutrality gate appears in any inventory. The new identifiers
(`admin`, `invite`, `code`, `banned`, `media-access`) are clean, so the rule
is satisfied. Either pin a gate or delete the sentence.

### C7. Four before-state anchors are loose.

- The unpublish admin branch is cited at `:64-67` (`018:274`). The branch
  sits a few lines earlier and `:64-67` lands on the audience-keep code.
- The account-zone menu cite `:44-68` (`018:132`) spans the whole menu; the
  Settings gate sits at `:50` and the Admin gate at `:61`.
- The HomePage dialog cite `:741-743` (`018:135`) lands on the capsule; the
  dialog element sits at `:744-748`.
- The `requirePermission` rank query is cited at `:42-45` (`018:182`); the
  query text spans `:43-46`.

None are ledger-binding. All four cost a capture round if read literally.

## Open questions answered

### 1. Does better-auth already own a ban field on the user table?

No. The installed `better-auth@1.7.2` base user schema has no ban column.
The admin plugin schema owns `banned`, `banReason`, and `banExpires` on the
user, plus a `role` column and `session.impersonatedBy`
(`node_modules/better-auth/dist/plugins/admin/schema.d.mts`). The app wires
no plugin (`lib/auth/server.ts:57-98` has no plugins array) and its
`AUTH_SCHEMA_SQL` has no ban columns (`lib/auth/schema.ts:13-21`). The
app-owned `ADD COLUMN IF NOT EXISTS` approach in `ensureAuthSchema`
(`018:166`, `018:407-416`) cannot collide with better-auth runtime SQL,
which statements list their own columns. The "app-owned status, not the
admin plugin" decision is correct as written.

### 2. Is the settings gating split consistent with the matrix?

Yes. The matrix row says Settings modal is admin-only
(`rbac-minimal-mode.md:211`). The provider surface gates with the batch C
wrapper `requirePermissionIfMinimalMode`, which exists
(`permissions-server.ts:65-75`). Under the flag the surface is
admin-only, matching the row. Flag-off keeps today's ungated dialog, which
is the Q4 parity rule and the 016 deferral language ("Batch E owns hiding
provider sections from non-admin ranks", `016:504-505`). The deferred routes
018 names (`/api/server-providers`, `/api/azure-voices`,
`/api/provider/probe-models`, `/api/usage`, `018:390-391`) match the 016
no-gate table byte for byte (`016:397-398`). The matrix is enforced where
the flag is on, the same carve every other row already accepts.

### 3. Is invite single-use atomic under concurrency?

The consume is planned as one statement, `UPDATE ... WHERE used_at IS NULL
RETURNING` (`018:431-432`). A single conditional update cannot double-consume
by construction. The grant and the role insert must share one client
transaction, because a committed consume followed by a failed insert burns
the invite with no role. The spec claims "the same transaction" (`018:433`)
without pinning the transaction shape. No adversarial double-accept gate
exists in the inventory, and batch C set the race-gate precedent
(`016:289`, QUOTA_RACE_OK). Add a concurrency gate or state in the spec why
the single statement removes the need.

### 4. Grant-in-user-create-hook versus verification ordering.

The hook fires at user creation, before email verification. The spec prose
says the grant lands "on the first verified signup" (`018:237`). Those two
do not match. With `requireEmailVerification: true` and
`autoSignInAfterVerification: true` (`lib/auth/server.ts:63-70`), no session
exists until verification, so a pre-verification grant cannot be exercised.
The residual flaw is operational, not a leak: an invited email that signs up
and never verifies still consumes the invite. Judgment: the mechanism is
acceptable, but the spec must say the grant and the consume both fire at
user creation, before verification, and that the session gate is what keeps
the role inert. If strict verification ordering is wanted, pin the
verified-callback grant point instead.

### 5. Can a test force a cold provider, and is the probe deterministic?

`resetServerPersistenceProvider` exists and gives a cold persistence
provider. It does not give a cold auth server, and it kills the cached auth
server's pool in the process. The probe cannot force the auth-side cold
start with the named seam alone. This is the substance of B2. A test can be
deterministic, but only after the spec pins the auth reset seam.

### 6. Does flag-off media parity respect the 017 deferral language?

Yes. 017 committed the byte seam exposure "until batch E"
(`017:465-476`), and 018 S5 closes it under the flag with flag-off parity,
which is the Q4 rule (`018:392-393`). The parity claim is testable through
the real route: the media flag reads env at call time, and the existing
media suites already mock `classroom-storage` or `fs`
(`tests/media/classroom-media-bytes.test.ts`,
`tests/api/classroom-media-range.test.ts`), so the temp-classroom-dir claim
needs the same module-mock mechanism or a `process.chdir`. The spec should
pin which one.

## VERIFIED-OK

- Contract cites, sampled:
  - `lib/auth/schema.ts:13-21` user table ends at `updatedAt` with no ban
    state. Exact. `:79-84` `user_roles` primary key is `user_id`, so a user
    holds exactly one role and assignment is an upsert. Exact. `:99-104`
    schema ends at `quiz_grade_quota`. Exact.
  - `lib/auth/roles.ts:64-95` env and yaml seed loop, `:88-92` the seed
    upsert shape. Exact. `lib/auth/server.ts:71-94` guest default hook,
    `:105-108` fire-and-forget role seed. Exact. `:57-98` no admin plugin.
    Exact.
  - `lib/auth/permissions-server.ts:40-57` requires only the rank,
    `:65-75` the flag wrapper exists. Exact. `lib/auth/index.ts:29-38`
    lazy auth cache, `:64-66` error swallow. Exact.
    `lib/persistence/audience.ts:31-46` rank resolver with no ban check.
    Exact.
  - `lib/auth/mailer.ts:19-22` interface exposes only
    `sendVerificationLink`, `:29-35` the DI seam. Exact.
  - `components/account-zone.tsx:50-68` Settings gated by
    `settings.manage`, Admin by `users.manage`, both dead buttons, the
    `soon` badge present. Exact. `components/header-capsule.tsx:26-33`
    `onSettingsOpen` prop, `:124-132` ungated gear. Exact.
    `lib/types/settings.ts:3-14` the section union. Exact.
    `app/page.tsx:741-748` capsule and dialog host. Close.
    `lib/i18n/locales/en-US.json:2047-2062` the three cited keys plus the
    twelve locale files present. Exact.
  - `app/api/stages/[id]/route.ts:161-162` PUT existence gate, `:180-189`
    owner-scoped delete. Exact. `lib/persistence/stage-meta.ts:31-32`
    `stage_id` FK cascades on document delete. Exact.
    `lib/persistence/gallery.ts:21-50` the join model. Exact.
    `app/api/classroom/route.ts:101-114` the audience rule under the flag.
    Exact, and it shows the classroom id resolves through `stage_meta`, so
    `decideMediaAccess(classroomId, ...)` has a defined key.
  - `app/api/classroom-media/[classroomId]/[...path]/route.ts:24` the
    public-immutable constant, `:27-38` the stream bridge, `:40-131` a
    GET with no identity check, `:85-95` the 416 with `no-store`. All
    exact.
  - `lib/persistence/server-provider.ts:72-93` the cached bootstrap,
    `:100-112` the reset that ends the pool. Exact.
    `lib/server/agent-runtime/with-owner.ts:27-38` anon fallback, `:40-45`
    the 500 catch. Exact.
  - `tests/agent-runtime/event-notify.pg.test.ts:58-72` the scratch
    database pattern. Exact.
  - `app/signup/page.tsx::Page` exists (`:10`). Exact.
- Spec anchors: `013:412` the invite-agnostic sentence. Exact. The 013 S05
  mailer env list `MAIL_TRANSPORT AUTH_SECRET RESEND_API_KEY SMTP_HOST
  SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM` matches the 018 S3 gate byte for
  byte (`018:245`). `015:260-268` the eleven-permission catalog. Exact.
  `016:117` the canonical eight-variable env prefix matches the 018 prefix
  byte for byte (`018:107`), including the two batch C variables.
  `016:504-505` the dialog deferral. Exact. `016:397-398` the no-gate rows.
  Exact in substance. `017:465-476` the media byte deferral, `017:629-631`
  the cold-boot transient note. Both exact. `017:371-385` the passthrough
  precedent, cited for gating but not adopted (B1). Meta-spec anchors:
  matrix `:211-212`, dependency row `:266`, register `:159,168`,
  `:229-238`. All exact.
- Gate dry-runs (exact commands, repo root, on 2026-09-06):
  - S1 unit `admin-page-gate.test.ts`: exit 1, no marker. Suite absent,
    plan-time RED as documented.
  - S2 unit `users-admin.test.ts`: exit 1, no marker. Suite absent.
  - S2 pg: exit 1 at the PG guard, no marker. Fail-closed RED with
    `PG_CONTRACT_URL` unset.
  - S3 unit `invites.test.ts`: exit 1, no marker. Suite absent.
  - S3 mailer gate with the 013 variable list: exit 1, no marker. Suite
    absent.
  - S5 adversarial with `MINIMAL_MODE=true` inline: exit 1 at the PG guard,
    no marker.
  - S6 adversarial: exit 1 at the PG guard, no marker.
  - `pnpm check:i18n-keys && echo I18N_OK`: exit 0, `I18N_OK` echoed.
    Twelve locale files, parity passed.
  - `npx tsc --noEmit && echo TSC_OK`: exit 0, `TSC_OK` echoed.
  No gate produced a false marker. Every marker is a short literal under the
  expectation cap.
- Tier compliance: S1 tier 2 with 3 gates. S2 tier 4 with 4 gates and the
  adversarial tag on `BAN_ADV_OK`. S3 tier 3 with 4 gates and the
  integration tag on `INVITES_PG_OK`. S4 tier 3 with 3 gates and the
  integration tag on `ADMIN_COURSES_PG_OK`. S5 tier 4 with 4 gates and the
  adversarial tag on `MEDIA_NO_LEAK_OK`. S6 tier 4 with 3 gates, one short
  (C3). Every tag rule is met.
- Adversarial shape: S2 bans a live user, asserts session death, the
  `banned` code on a guarded call, rank 0 on the read gate, and the
  non-admin denial. S5 toggles the flag through env, drives the real byte
  route with seeded sessions, and asserts an exact status and header matrix
  for every audience tier, drafts, tombstoned rows, missing rows, and banned
  users. The ban surface and the media leak surface are both exercised with
  real sessions and real routes, subject to B1 and B2.
- Constraint hygiene: new files are app-side under `lib/`, `components/`,
  `app/`, and `tests/`. No package change. No new env var. The invite code
  name honors the neutrality rule. The catalog stays at 11 permissions
  (`course.delete` covers delete-any with the explicit rank-4 check).

## Could not verify

- The fixtures of the unwritten `tests/admin/*` suites. The C1 session
  wiring is asserted from the live suite structure, not from a fixture.
- The exact `consumeInvite` SQL and the invite grant transaction shape. The
  spec pins plan-time prose only. Re-pin byte-exact after implementation.
- The accept page prefill mechanics. Plan-time prose only.
- Whether the S6 fixture can sign a real user through the cached auth server
  after the provider reset. As written it cannot, which is the substance of
  B2.