# Batch 017 spec soundness review

Reviewer: independent spec-soundness reviewer (fresh eyes for 017; previously
reviewed batches 013, 014, 015, and 016). The reviewer did not write the spec.
Probes and gate dry-runs ran on 2026-09-05 against the working tree at HEAD
on `main`.

Reviewed documents:

- `docs/specs/017-publishing-visibility.md` (draft, batch D).
- Certified predecessors for program context: `docs/specs/015` Research
  update (batch B, certified), `docs/specs/016` (batch C, draft with pending
  fixes), `docs/research/rbac-minimal-mode-decision-round-1.md` (Q-register
  source), and `docs/meta-specs/rbac-minimal-mode.md` (Q-register, capability
  matrix, per-batch dependency row, acceptance criteria).
- Live sources probed: `lib/persistence/document-access.ts`,
  `lib/persistence/stage-meta.ts`, `lib/server/stage-access.ts`,
  `lib/server/classroom-storage.ts`, `lib/server/agent-runtime/with-owner.ts`,
  `lib/classroom/load-classroom.ts`, `lib/classroom/stage-meta-client.ts`,
  `lib/auth/index.ts`, `lib/auth/roles.ts`, `lib/auth/permissions.ts`,
  `lib/auth/permissions-server.ts`, `lib/utils/stage-storage.ts`,
  `app/api/persistence/[...path]/route.ts`, `app/api/classroom/route.ts`,
  `app/api/classroom-media/[classroomId]/[...path]/route.ts`,
  `app/api/stage-meta/[stageId]/route.ts`,
  `app/api/stages/[id]/publish/route.ts`,
  `app/api/stages/[id]/unpublish/route.ts`,
  `app/api/stages/[id]/status/route.ts`, `app/classroom/[id]/page.tsx`,
  `app/page.tsx`, `lib/i18n/locales/en-US.json`,
  `tests/agent-runtime/stage-meta-routes.test.ts`,
  `tests/agent-runtime/persistence-routes-gate.test.ts`,
  `tests/providers/provider-neutrality-guard.test.ts`,
  `lib/server/classroom-generation.ts`.

Method: file-to-line existence checks against live source, symbol signature
comparisons, `is_public` writer audit by grep, classroom and media seam path
traces, gate dry-runs from the repo root with the exact `unset` prefixes
(presented below), env-prefix comparison against the batch C spec text, tier
re-count from the spec file, and drift comparison against the current outline
truth. No code changed. Only this file was created.

## Verdict

**Approve-after-fixes.** Two blockers. Both would fail a verification round
if shipped unchanged. B1 is the same typed-403 passthrough gap the 016 review
flagged for the quiz-grade quota, and batch D repeats it in the publish and
unpublish routes. B2 is an internal contradiction in the classroom seam gate
that leaves a real draft-reading path outside the batch's own postcondition.
The schema, the mirror-column design, the backfill, the gallery, and the gate
inventory are otherwise sound.

## BLOCKERS

### B1. `requirePermission` throws a Response, and two catch layers turn it into a 500. The spec never pins the passthrough.

The publish route spec says it "calls `requirePermission(headers,
'course.publish')` first, which throws the typed 403" (`017:328-332`).
`requirePermission` throws a `new Response(...)` with
`{ message: 'permission denied', code: 'permission_denied' }` and status 403
(`lib/auth/permissions-server.ts:34-38`). Two catch layers swallow that throw.

The route body runs inside the `withRequestOwnerId` callback
(`lib/server/agent-runtime/with-owner.ts:19-46`). The callback catch at
`:40-45` returns a plain 500 "Internal Server Error" for any throw that
escapes the handler. Inside the handler, the live publish route wraps all
logic in `try { ... } catch (error) { ... return apiError(500) }`
(`app/api/stages/[id]/publish/route.ts:25-66`). If the guard call sits in
that try, the throw becomes `internal_error` 500. If it sits before the try,
the callback catch returns 500. Either placement without a passthrough loses
the typed 403.

The program already learned this class once. The 016 review blocker B2
required the quiz-grade quota 429 to ride the same nested
Response-rethrow pattern as the guard (`app/api/quiz-grade/route.ts:34-39`).
Batch D repeats the gap for publish and unpublish, and the S3 postcondition
("Anonymous and learner callers receive the typed 403 with `{ message, code
}`", `017:190-191`) fails at the `PUBLISH_ROUTES_OK` and `PUBLISH_LIVE_OK`
gates.

Fix, one sentence in the spec: both routes wrap the guard call as
`try { await requirePermission(...) } catch (err) { if (err instanceof
Response) return err; throw err; }`, so the typed 403 survives the route
catch and the callback catch.

### B2. The classroom GET gate is conditional on a stage_meta row, so JSON-file-only courses stay fully servable. The S2 postcondition contradicts its own binding.

S2 pins the classroom GET as "applies the audience rule when the id resolves
through stage meta, keeps serving local-only classroom JSON files with no
stage meta row" (`017:136`). S2's postcondition says "Drafts and
wrong-audience courses answer 404 on all three seams" (`017:148-150`). Those
two statements disagree for exactly the no-row case, and the no-row case is
not a developer-local artifact.

The evidence:

- `POST /api/classroom` persists any body to `data/classrooms/<id>.json`
  with no session, no owner, and no stage_meta write
  (`app/api/classroom/route.ts:14-49`, `lib/server/classroom-storage.ts:61-84`).
- The AI generation pipeline writes classroom JSON files through the same
  `persistClassroom` call (`lib/server/classroom-generation.ts:711-718`), and
  the classroom page reads its server fallback through `GET /api/classroom`
  (`lib/classroom/load-classroom.ts:256-261`, `fetchClassroomFromApi`).
- stage_meta rows come only from `claimStageMeta` on document create
  (`lib/persistence/owner-bound-document-store.ts:216`) or the boot-time
  backfill from `document_stages` (`lib/persistence/stage-meta.ts:43-47`).
  A course that exists only as a JSON file never gets a row.
- The legacy product model was exactly these JSON files. The decision record
  describes them as live storage (`docs/research/rbac-minimal-mode-decision-round-1.md:16-17`).

Consequence: on any deployment with legacy or generated JSON-only courses,
the batch's headline promise (`017:67-68`, "drafts readable only by me, so
that work in progress never leaks through a guessed URL") is not delivered on
the classroom seam. Anyone holding the id reads the full stage and scenes.
The S5 no-leak suite cannot catch it, because that suite creates its courses
with stage_meta rows, and the no-row case never appears in the matrix.

Fix options, pick one and pin it in the spec: gate classroom GET
unconditionally so a missing row answers 404 for everyone without a matching
owner session, or make `POST /api/classroom` and the generation pipeline
claim stage meta on write, or explicitly scope the batch's
no-existence-oracle promise to document-backed courses and record the
JSON-only seam on the register as a known residual. The "developer-local
artifact" label (`017:327`) is inaccurate as written and must go.

## CONCERNS

### C1. The gallery has no entry point. Nothing in the product links to it.

The batch creates `app/gallery/page.tsx` and `listGalleryCourses` (`017:216-217`),
but no nav item, header link, footer link, or home card points at `/gallery`.
User story 3 ("a public gallery of courses I may open, so that published
content is discoverable without knowing course ids", `017:63-64`) is not met
end to end without a reachable entry. One sentence in S4 or the home wiring
slice fixes it.

### C2. The classroom-media deferral drifts from the batch C record.

Batch C's no-gate table records that "the course-open audience rule belongs
to batch D" (`docs/specs/016-minimal-mode-gating.md`, corridor above the
persistence row). Batch D's Out of Scope defers the media byte seam to "a
later hardening pass" (`017:410-413`). The deferral is disclosed, but the
spec never records the amendment on the register. The concrete fact the
reviewer confirmed: `/api/classroom-media` serves bytes with zero auth and
`Cache-Control: public, max-age=86400, immutable` for any classroom id
(`app/api/classroom-media/[classroomId]/[...path]/route.ts:24,40-131`), so
draft-stage media stays readable by anyone holding the path, and unpublish
never removes the files. The meta-spec acceptance criterion ("Unpublished and
wrong-audience courses return 404 at the API level", `rbac-minimal-mode.md:315-316`)
is not met for media. The register should carry the second deferral as a
named residual, matching the closure-task pattern 016 used for its deltas.

### C3. S3's unit suite session wiring is unstated.

The unit gate `publish-routes.test.ts` runs hermetic with no
`PG_CONTRACT_URL`, but the new routes call `requirePermission` and
`getSession`. The current suite passes by accident, because a missing
database makes `getSession` fall back to the mocked anonymous owner
(`tests/agent-runtime/stage-meta-routes.test.ts:1-56`). Under the new routes
every hermetic call becomes the anonymous 403 unless the suite mocks a
session. The spec names only the retiring 401 pin (`:195-203`) as the
rewrite target (`017:393-394`) and says nothing about how the success
fixtures (`:173-193`) authenticate. The spec should state that the unit
suite mocks `getSession` and that only the live-wire gate leaves it real.

### C4. "The picker default is 0, everyone, per the approved decision" is not in the decision record.

The register and the round-1 record say the creator picks the audience at
publish time, nothing more (`rbac-minimal-mode.md:164`,
`rbac-minimal-mode-decision-round-1.md:126-137`). The default of 0 is a
reasonable batch D decision, but "per the approved decision" (`017:287`) is
unsupported. Register it as a batch D decision or change the attribution.

### C5. Two before-state cites are loose.

`017:104-105` says `STAGE_META_SCHEMA` "ends with the legacy public partial
index on `is_public`". The index sits at `stage-meta.ts:40-41`; the string
ends with the owner backfill INSERT at `:43-47`. A capture keyed to "ends
with the index" wastes a round. `017:179-180` attributes the publish 401 to
`:26-31`, which is exact, but the same paragraph's stage-meta sidecar cite is
the doc comment at `route.ts:14-17`; the unauthenticated response shape it
describes lives at `:38-68`. Neither is ledger-binding, but both are the
016-C4 class of incorrect line anchor.

### C6. The audience model is consistent and fails closed. No change needed.

Verified for the record: `ROLE_RANKS` pins anonymous 0 through admin 4
(`roles.ts:7-13`); `resolveViewerRank` mapping unknown users to 0 matches the
`requirePermission` rank fallback (`permissions-server.ts:47`); the column
default `audience 3` behind `status 'draft'` fails closed for any future
publish path that omits the audience; and the backfill guard
`WHERE is_public = true AND status = 'draft'` is idempotent across reruns.
One caution: `ensureStageMetaSchema` splits on `;` and executes in order
(`stage-meta.ts:50-55`), so the appended `UPDATE` must stay after the two new
`ALTER` statements or the first boot of an existing database fails.

## VERIFIED-OK

- Contract cites, sampled:
  - `decideDocumentAccess` read case at `document-access.ts:70-74`: any live
    stage answers `allow`, ownership never checked. Exact. The persistence
    seam call site at `route.ts:283-301` and the 404 mapping at `:304-305`
    are exact. Anonymous requests reach this read case through
    `withRequestOwnerId` with a non-empty `anon:` owner
    (`with-owner.ts:28-34`), so line 65's `if (!ownerId)` does not protect
    them. The spec's problem statement is accurate.
  - `setStagePublished` at `stage-meta.ts:151-163` writes only `is_public`
    and `published_at`. Exact. Grep confirms only the publish and unpublish
    routes call it (`route.ts:50`, `route.ts:41`). No other code writes
    `is_public` directly, so the mirror-consistency hunt is clean.
  - Publish 401 at `publish/route.ts:26-31` and unpublish 401 at
    `unpublish/route.ts:25-30`. Exact.
  - The pinned 401 test at `stage-meta-routes.test.ts:195-203` expects
    exactly `{ error: 'login_required' }`, status 401. Exact. The persistence
    gate mock row at `persistence-routes-gate.test.ts:427-428` carries
    `meta_is_public: false` inside the `LEFT JOIN stage_meta` branch. Exact.
  - `classroom-storage.ts:6` is the `CLASSROOMS_DIR` constant, `:48-59` is
    `readClassroom` with the file read at `:51`. Exact.
  - `ROLE_RANKS` (`roles.ts:7-13`), the rank join (`permissions-server.ts:43-47`),
    `course.publish` in the rank-3 default set (`permissions.ts:74-83`, cite
    says 79-85), `withRequestOwnerId` (`with-owner.ts:29-34`), the
    `isPublic`/`publishedAt` wire contract (`status/route.ts:35-37`), the
    client shape (`stage-meta-client.ts:21`), the absent-sidecar branch
    (`app/classroom/[id]/page.tsx:94-104`), the owner listing
    (`stage-storage.ts:738-744`), the library card hover menu
    (`app/page.tsx:1675-1706`), the grid recipe (`app/page.tsx:1167`), and
    the one-key share locale group (`en-US.json:963-965`). All exact.
  - Signatures: `handlePersistenceRequest(request: Request, deps?:
    PersistenceRequestDeps)` matches the live declaration
    (`route.ts:267-270`). The stage-meta GET, classroom GET, publish POST,
    unpublish POST, `HomePage`, and `ClassroomCard` pins match live
    declarations. `StageAccess` and `ACCESS_SQL` match their live shapes
    (`stage-access.ts:22-31,42-52`).
- Meta-spec anchors: Q7 at `:164`, Q12 at `:169`, package-forbidden rule at
  `:216-221`, batch D row at `:265`, draft-share deferral at `:277`, and the
  gallery acceptance criterion at `:315-316`. All exact.
- Gate dry-runs (exact commands, repo root, on 2026-09-05):
  - S1 unit `visibility-columns.test.ts`: exit 1, no marker. Suite absent,
    plan-time RED as documented.
  - S2 unit `read-gate.test.ts`: exit 1, no marker. Suite absent.
  - S2 integration `test -n "$PG_CONTRACT_URL" && ...`: exit 1 at the guard,
    fail-closed RED. No marker.
  - S3 unit `publish-routes.test.ts`: exit 1, no marker. Suite absent.
  - S3 integration publish-live-wire: exit 1 at the PG guard.
  - S4 unit `gallery-list.test.ts`: exit 1, no marker. Suite absent.
  - S5 adversarial `no-leak.pg.test.ts`: exit 1 at the PG guard plus absent
    suite.
  - S3 i18n `pnpm check:i18n-keys && echo I18N_OK`: exit 0, `I18N_OK`
    echoed. 12 locale files, parity passed.
  - S1/S2/S4/S5 smoke `npx tsc --noEmit && echo TSC_OK`: exit 0, `TSC_OK`
    echoed.
  No gate produced a false marker. Every marker is a short literal under the
  expectation cap.
- ENV_CLEAR: the spec's 8-variable prefix is byte-identical to the batch C
  unit-gate prefix (`016-minimal-mode-gating.md:117`). The claim "including
  the two batch C variables" is accurate. Smokes carry no prefix, matching
  the 016 pattern.
- Tier compliance: S1 tier 2 with 2 gates. S2 tier 3 with 3 gates and the
  integration tag on `GATE_PG_OK`. S3 tier 3 with 3 gates and the
  integration tag on `PUBLISH_LIVE_OK`. S4 tier 3 with 3 gates and the
  integration tag on `GALLERY_PG_OK`. S5 tier 4 with 4 gates and the
  adversarial tag on `NO_LEAK_OK`. Every tier rule is met.
- The adversarial shape: the NO_LEAK_OK probe set covers anonymous reading a
  learner-tier published course, guest reading a learner-tier course, a
  learner reading another creator's draft, and a caller guessing a draft or
  tombstoned id. Coursestates x caller classes answer an exact 404 or 200
  pair per seam, and the response body is part of the assertion so forbidden
  pairs cannot regress to 403. The suite drives real route handlers with
  seeded sessions and never mocks the gate seam. The matrix includes the
  owner-reads-draft 200 pair and the owner-reads-tombstone 404 pair.
- Publish flow attribution: no component imports any publish route today
  (grep over `components/` and `lib/classroom/` returns nothing), matching
  the before-state claim. Anonymous callers never reach publish under the new
  flow, because `requirePermission` denies a missing session before any owner
  check, matching the solution statement subject to B1.
- Legacy-401 hygiene: `login_required` exists only in the two routes and the
  one test file. The retirement surface is exactly what the spec names.
- Constraint hygiene: new identifiers (`audience`, `status`, `publishing`,
  `resolveViewerRank`, `setStageVisibility`, `listGalleryCourses`) contain no
  "token" or "plan" substrings. The neutral-file scanner
  (`provider-neutrality-guard.test.ts:58-90`) does not cover the edited
  routes, but the rule is satisfied either way. No new env var, no package
  change, no `ai` import bypass.

## Could not verify

- The fixtures of the unwritten `tests/publishing/*` suites. The C3 concern
  about the S3 session mock is asserted from the live unit suite's structure,
  not from a written fixture.
- The exact `resolveViewerRank` SQL and the gallery query text. The spec
  describes both in prose and the plan-time pins carry intended declaration
  text only. Both must re-pin byte-exact from outline text after
  implementation, per the PIN-FROM-OUTLINE rule.
- Whether the S5 `no-leak.pg.test.ts` suite probes the classroom GET
  no-row case. As written it cannot, which is the substance of B2.