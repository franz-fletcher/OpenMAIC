# Batch 016 spec soundness review

Reviewer: independent spec-soundness reviewer (fresh eyes for 016; previously
reviewed batches 013, 014, and 015). The reviewer did not write the spec.
Probes and gate dry-runs ran on 2026-09-05 against the working tree at HEAD
on `main`.

Reviewed documents:

- `docs/specs/016-minimal-mode-gating.md` (draft, batch C).
- Certified predecessors for the program context: `docs/specs/013` Research
  update (batch A, certified), `docs/specs/014` Research update (batch G,
  certified), `docs/specs/015` Research update (batch B, certified), and
  `docs/meta-specs/rbac-minimal-mode.md` (Q-register, capability matrix,
  child-batch C row, per-batch dependency row).
- Live sources probed: all 24 matrix routes, the 9 no-gate routes,
  `lib/config/feature-flags.ts`, `lib/server/config-validation.ts`,
  `instrumentation.ts`, `lib/auth/permissions.ts`,
  `lib/auth/permissions-server.ts`, `lib/auth/schema.ts`,
  `lib/auth/index.ts`, `components/account-zone.tsx`,
  `components/header-capsule.tsx`, `app/page.tsx`,
  `components/scene-renderers/quiz-view.tsx`, `.env.example`,
  `lib/i18n/locales/en-US.json`, `docs/design/rbac-batch-a/home-minimal.html`.

Method: route-to-file existence check over all 24 matrix rows, handler-symbol
comparison against live `export async function POST(...)` declarations,
no-gate claim verification by source read, feature-flag and boot-warning cite
audits, quota design review against the requirePermission idiom and the live
quiz-grade catch structure, gate dry-runs from the repo root with the exact
`unset` prefixes, tier re-count from file text, ledger-ability mapping against
the rivr v2 grammar (`rivr --help` checked live), and pin-drift risk
comparison against current outline truth. No code changed. Only this file was
created.

## Verdict

**Approve-after-fixes.** Two blockers, both with one-line fixes. Both are
program-rule or seam-correctness issues that would burn a verification round
or fail the ledger build if shipped unchanged. No route in the 24-row matrix
is missing or mis-homed; the batch structure, the matrix mapping, the quota
mechanism as described, and the gate inventory are otherwise sound.

## BLOCKERS

### B1. S5 declares risk tier 3 but carries no integration-tagged gate.

S5 gates are `LAYOUT_OK` (unit), `GRAPH_OK` (unit), `I18N_OK` (smoke)
(`016:333-335`). The tier rule requires every tier-3 slice to tag one gate
integration, and every prior certified tier-3 slice did so (015 S2
`ROLE_PERM_PG_OK`, 015 S4 `PERMS_ROUTE_OK`; 014 S2 `BRAND_HDR_OK`).
S5 has none. Fix (one line): tag the `LAYOUT_OK` gate as integration,
mirroring the 014 `header-capsule.test.ts` precedent (a
`renderToStaticMarkup` layout gate already certified as integration), or
lower S5 to risk tier 2.

### B2. The spec claims the route catch returns the quota 429 unchanged; the live outer catch maps every error to 500.

`016:425-428` says the 429 matches "the requirePermission typed-refusal idiom
so the route catch returns it unchanged". The live quiz-grade outer catch is
`catch (error) { ... return apiError('INTERNAL_ERROR', 500, ...) }`
(`app/api/quiz-grade/route.ts:115-121`). It converts every error to a 500.
Only the guard's nested `try { await requirePermission(...) } catch (err) {
if (err instanceof Response) return err; }` (`:34-39`) passes typed refusals
through. A quota consumer stacked inside the outer try would throw its
429 Response into the outer catch and come back as 500. Fix (one line): state
that the quota call rides the same nested Response-rethrow pattern as the
guard, or that the outer catch gains a Response passthrough. Without this,
the S4 live-wire gate ("sixth returns 429") fails at verification.

## CONCERNS

### C1. Plan-time pin drift against current outline truth in S4 and S5 bindings.

`HomePage` is pinned `(): ReactElement` (`016:313`) but the live declaration
is `function HomePage() {` with no return annotation; the current outline
truth is `()`. The quiz-grade POST pin is a multi-line code block
(`016:269-273`) while the live signature is single-line
`POST(req: NextRequest): Promise<Response>` (45 chars, never prettier-wrapped),
and `ensureAuthSchema` gets the same multi-line treatment for a single-line
42-char signature (`016:247-251`). This is the batch A round-1 class
(`(): JSX.Element` invention, multi-line-vs-one-line mismatch). The
re-pin-at-build rule (`016:78-80,467-472`) prevents a false fail only if the
rows are re-anchored BEFORE first verification, per the 015 amendment
precedent. Suggested fix: pin the single-line verbatim forms now.

### C2. Four adoption rows pin `req` where the live handler names the parameter `request`.

`app/api/generate/image/route.ts`, `app/api/generate/video/route.ts`,
`app/api/verify-image-provider/route.ts`, and
`app/api/verify-video-provider/route.ts` all declare
`export async function POST(request: NextRequest)`. The S2 table pins
`(req: NextRequest): Promise<NextResponse>` for every row
(`016:169,170,180,181`). Param-name drift is the same outline-diff class as
C1. Fix at re-anchor, or state the planned signature as `(request: ...)`.

### C3. The quota consumer's `userId` source is unstated.

`consumeQuizGradeQuota(queryable, userId)` needs a user id, but the live
quiz-grade route discards the guard's return (`await requirePermission(...)`,
`route.ts:35`) and `requirePermission` is the only session source in the
handler (`permissions-server.ts:28-31` returns the Session). The spec never
says the route changes to capture the Session and pass `session.userId`.
Inferable, but one sentence would remove the ambiguity, mirroring 015 review
concern C4.

### C4. Two before-state line cites are wrong.

`016:186` says "app/api/chat/route.ts:28 starts its POST body with req.json()
and heartbeat wiring" — line 28 is the doc comment; the POST handler starts at
`:44` and `req.json()` is at `:50`. `016:107` and `:353` attribute the
`validateServerConfig` call to `instrumentation.ts:28`, which is the dynamic
import line; the invocation is at `:29`. Neither is ledger-binding, but a
before-state capture keyed to the wrong line wastes a capture round.

### C5. "Read-only settings surfaces" overstates `probe-models`.

`app/api/provider/probe-models/route.ts` makes a live provider network call
(`fetchModels` at `:38`, with an SSRF guard) to list chat models. It is not an
LLM token spend, so the deferral to batch E's surface hiding is defensible and
documented (`016:399,503-504`), but the label "read-only" is imprecise and the
matrix's settings row is admin-only.

## VERIFIED-OK

- Route truth: all 24 matrix rows exist as files with a `POST` export whose
  declaration matches the pinned symbol. Suspect routes called out for
  verification all exist and spend as classified: `chat/pi/route.ts` (POST
  `:42`), `generate-classroom/route.ts` (POST `:14`, LLM spend confirmed
  beneath the handler via `classroom-job-runner` to `classroom-generation.ts`
  which calls `callLLM` at `:219,315,341,365,385,606`), the four
  `pbl/v2/{instructor,open-task,evaluate,simulator}` routes, the four
  `verify-*` routes, `transcription`, `web-search`, `extract-document`,
  `parse-pdf`, and `generate/voice`. The no-gate table routes also exist:
  `classroom-media/[classroomId]/[...path]`, `generate-classroom/[jobId]`,
  `pbl/v2/task/update`, `chat/pi/whiteboard-visibility`,
  `server-providers`, `azure-voices`, `provider/probe-models`, `usage`, and
  the `export-video/**` family. Routes verified 24/24; none moved, none
  fabricated.
- Matrix spend classification: `scene-content` `callLLM` at `:143` (exact), 
  `web-search` `callLLM` at `:133` (exact), `verify-model` `callLLM` at `:39`
  (exact), `instructor` model resolution at `:55-61` (spec cite `:61` is the
  resolve destructure, acceptably close). Each route's permission key resolves
  against the 11-key catalog (`lib/auth/permissions.ts:43-55`) and the matrix.
- No-gate claims: `classroom-media` is a pure fs byte server with
  `Cache-Control: public, max-age=86400, immutable` at `:24`, no session, no
  model imports; its course-open audience gate is correctly deferred to batch
  D. `pbl/v2/task/update` header states "Pure state-mutation endpoint ... No
  LLM involvement. Stateless." at `:1-18` and imports only kernel
  operations. `server-providers`, `azure-voices`, and `usage` contain zero
  `callLLM`/`streamLLM` references; the verify-* family is the gated spend
  point. `generate-classroom/[jobId]` GET is a job-status read.
- Flag semantics: `feature-flags.ts` holds `readBoolean` at `:10`,
  `isAgentRuntimeEnabled` at `:18`, `isProWorkbenchEnabled` at `:32` — the
  claimed coexistence pattern is real and the module doc states NEXT_PUBLIC
  inlining at build time (`:1-8`), so "build-inlined client mirror" and the
  restart consequence are correctly stated. `validateServerConfig` is at
  `config-validation.ts:175` and runs exactly the four validators claimed
  (`:177-180`). `instrumentation.ts:28-29` is the import-and-call site.
- Quota design: the SQL-day expression `(CURRENT_TIMESTAMP AT TIME ZONE
  'UTC')::date` is a correct UTC-midnight calendar key, matching the round-2
  delta. The described single-statement atomic upsert with a below-five guard,
  returning count, "missing row = cap" semantics, and Postgres row locks is
  the race-proof pattern; the adversarial suite then proves it. The 429 body
  shape and `code: quota_exhausted` mirror the requirePermission idiom except
  for the catch-path gap in B2. Anonymous quiz-grade is handled correctly:
  the guard at `route.ts:35` runs before the body parse and any quota code,
  so anon never reaches the quota (no user_id exists), and the spec states
  this ordering (`016:431-432`).
- Gate dry-runs (exact commands, repo root):
  - S1 unit `tests/minimal-mode/feature-flags.test.ts` — exit 1, no marker
    (plan-time, suite absent, documented `016:491-493`).
  - S1/S2 smoke `npx tsc --noEmit` — exit 0, `TSC_OK`.
  - S3 unit `tests/providers/provider-neutrality-guard.test.ts` (full
    9-var `unset`) — exit 0, `NEUTRAL_OK`.
  - S5 smoke `pnpm check:i18n-keys` (full 9-var `unset`) — exit 0, `I18N_OK`,
    "12 locale files" confirmed.
  - S4 adversarial `test -n "$PG_CONTRACT_URL" && ...` with URL unset — exit
    1, no marker (fail-closed, documented).
  The remaining seven gates (`PARITY_OK`, `LIVE_OK` x2, `MATRIX_OK`,
  `GRAPH_OK` x2, `QUOTA_OK`, `QUOTA_PG_OK`, `LAYOUT_OK`) are missing-suite
  plan-time failures with identical mechanics; no false-fail oracle exists.
  Markers are all short literals (max 15 chars), far under the 300-char
  expectation cap.
- ENV_CLEAR: the canonical 015 list is verbatim (`DATABASE_URL
  PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED
  NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED`), the
  two batch C variables are appended on the flag-off gates, and the flag-on
  gates use the canonical prefix with an inline `MINIMAL_MODE=true` — exactly
  the rule stated at `016:82-89`. No gate omits the prefix.
- Tier compliance except B1: S1 tier 2 with 2 gates (min 2); S2 tier 3 with 3
  gates and the integration tag on `LIVE_OK`; S3 tier 2 with 3 gates; S4 tier
  4 with 4 gates and the adversarial tag on `QUOTA_RACE_OK` plus integration
  on `QUOTA_PG_OK`. Live-wire proof is preserved: S2 and S4 `LIVE_OK` both
  drive the real route stack with real seeded sessions and `MINIMAL_MODE=true`,
  mocking only `callLLM`, never `requirePermission` or `getSession`
  (user story 8 satisfied).
- Ledger-ability: every binding row is a `file::symbol` pair; all targets are
  capturable `.ts`/`.tsx`; gate-bound deliverables (`.env.example`, locale
  files) appear in gates and prose but never as symbol targets. New symbols
  (`isMinimalModeEnabled`, `isMinimalModeClientEnabled`, `validateMinimalMode`,
  `requirePermissionIfMinimalMode`, `consumeQuizGradeQuota`) carry intended
  declaration text and exist:false states; modified rows exist and are
  capturable. `lib/auth/index.ts::requirePermission` exists at `:96` for the
  wrapper's public-surface re-export.
- Layout slice cites: `HomePage` at `app/page.tsx:126`, composer at `:766`,
  generation toolbar at `:790`, library grid recipe
  `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4` at `:1152` — all exact.
  `account-zone.tsx:106` is the `if (!session)` signed-out branch rendering
  the single Sign in pill (`:108-113`). The capsule Pro toggle at
  `header-capsule.tsx:112` is gated only by the workbench flag, not by role —
  matching the spec's "ships ungated from batch G, per R3-Q6". The register
  (creator/admin only) wins over the mockup's learner-capsule Pro toggle, the
  delta is disclosed, and the spec's postcondition (hide for ranks without
  `course.create`) is internally consistent with hiding on the same ranks as
  the composer. The 2-3-4 recipe at `:1152` matches the register's
  multi-column library expansion.
- i18n claims: `auth.nav.signIn` and `auth.nav.createAccount` exist in
  `en-US.json`; `quiz.quotaExhausted`, `classroom.emptyTitle`, and
  `classroom.emptyGuestBody` do not yet exist (genuinely new); 12 locale files
  present. The quiz client fallback cite `quiz-view.tsx:131` is the catch that
  awards half credit (`:133-143`), and the 429 mapping must indeed bypass it.
- Program consistency: the meta-spec child-batch C row (flag, per-matrix
  gating, guest quota, layout rule specced here) and the per-batch dependency
  row are honored. D/E/F boundaries are clean in Out of Scope
  (`016:497-504`); audience gating for classroom-media is explicitly deferred
  to D (`016:395`). Both register corrections are flagged as closure tasks,
  not silent drift: the quota table name (`quota_daily` in register Q11 vs
  `quiz_grade_quota` pinned here, `016:511-514`) and the Pro toggle mockup
  delta (`016:515-517`).
- Constraint hygiene: new identifiers (`MINIMAL_MODE`,
  `NEXT_PUBLIC_MINIMAL_MODE`, `quiz_grade_quota`, `consumeQuizGradeQuota`,
  `requirePermissionIfMinimalMode`, `tests/minimal-mode/*`) contain no
  "token"/"plan" segments, so the provider-neutrality guard stays green.
  No new runtime, no publishable-package change, no `ai` import bypass (the
  LLM-entry guard is untouched).

## Could not verify

- The exact fixture content of the unwritten `tests/minimal-mode/*` suites;
  the S4 live-wire fixture's mock of `@/lib/ai/llm` (and the `resolve-model`
  mock if the allow path requires it, per 015 review concern C4) is asserted
  in prose only.
- The historical line-1263 citation for the grid recipe before the batch G and
  A rework; the live cite at `:1152` is exact, and the recipe is unchanged.
- End-to-end rivr ledger operations on a 016 ledger (none exists; creating one
  would be a ledger write, outside this review's mandate).