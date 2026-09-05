# Batch 016 spec: minimal-mode-gating

Spec status: implementation

## Problem Statement

Batch B proved the permission seam on quiz-grade alone. Every other model
spending route still runs unguarded. Any caller holding the access code can
spend operator money on chat, TTS, ASR, image, video, document extraction, and
web search, regardless of role. The guest experience also has no cap: a guest
can grade unlimited tests in one day, and the home page advertises a composer
that anonymous, guest, and learner ranks can never use.

From the operator view the consequences are concrete.

- Every LLM route is ungated by identity: `app/api/chat/route.ts` (POST at the
  top of the file), `app/api/generate/scene-content/route.ts:143`,
  `app/api/web-search/route.ts:133`, `app/api/pbl/v2/*`, and the TTS, ASR,
  image, video, and extraction routes all call providers with no session
  check.
- Guests hold `quiz.grade` (`lib/auth/permissions.ts:70`) and can grade
  without limit. The matrix promises 5 per UTC day
  (`docs/meta-specs/rbac-minimal-mode.md:207`).
- The home page renders the composer and generation toolbar for every rank
  (`app/page.tsx:766`), while approved minimal mode hides it for everyone
  below creator
  (`docs/research/rbac-minimal-mode-decision-round-1.md:220-224`).
- `MINIMAL_MODE` exists only as a decision. The kill-switch guarantee from
  Q4 is not implemented (`docs/meta-specs/rbac-minimal-mode.md:161`).

Batch C ships the flag, the per-route matrix enforcement, the guest quota,
and the approved minimal layout behavior.

## Solution

Batch C adds the server-only `MINIMAL_MODE` flag as the source of truth, a
build-inlined `NEXT_PUBLIC_MINIMAL_MODE` mirror for UI affordances, and a
flag-gated guard wrapper that every model spending route adopts per the
capability matrix. Anonymous and guest refusals reuse the typed 403 shape
from batch B. The quiz-grade route stacks an atomic per-day quota for rank-1
guests over its existing `quiz.grade` guard. The home page hides the composer
for ranks without `course.create` under the client mirror, and the signed-out
capsule shows the approved Sign in and Create account entries. Flag off
restores today's behavior exactly on every route batch C touches.

The guard wrapper is the kill switch. When the flag is off it returns without
touching sessions or the database. When the flag is on it delegates to
`requirePermission`, which throws the typed 403 for anonymous and denied
ranks. Every adoption keeps the wrapper as the first statement of the
handler, exactly as quiz-grade does today at `app/api/quiz-grade/route.ts:35`.

## User Stories

1. As an operator, I want a server-only `MINIMAL_MODE` flag with a
   build-inlined client mirror, so that I can lock the deployment down and
   flip it back to today's behavior with one variable.
2. As an anonymous visitor, I want the composer hidden and every model route
   to refuse me, so that I can browse without the site spending money on my
   behalf.
3. As a guest, I want five AI-graded tests per UTC day, so that I can sample
   the product and the operator is protected from unlimited grading spend.
4. As a learner, I want in-class chat, TTS, ASR, and unlimited grading, so
   that the classroom stays fully usable without authoring rights.
5. As a creator or admin, I want the full home layout unchanged, so that
   authoring keeps the composer and the Pro toggle.
6. As a signed-out visitor, I want Sign in and Create account visible in the
   header capsule, so that the first step into the product is one click.
7. As a UI developer, I want the minimal layout to reuse the existing library
   grid recipe, so that the freed space shows the same 2-3-4 responsive
   layout the full home already uses.
8. As a verifier, I want at least one gate that drives the real route stack
   without mocking `requirePermission` or `getSession`, so that the acting
   seam is proven, not assumed.

## Slices

Each slice lists the ledger bindings, before-state notes, postcondition, and
gate inventory. New symbols pin their intended declaration text at plan time.
After implementation the builder re-pins byte-exact from machine-extracted
outline text, per the PIN-FROM-OUTLINE rule in Testing Decisions.

The env-clear prefix is the 015 canonical list, copied verbatim, extended
with the two new batch C variables. The canonical list names
`DATABASE_URL`, `PERSISTENCE_DEV_TOKEN`, `ACCESS_CODE`,
`OPENMAIC_AGENT_RUNTIME_ENABLED`, `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED`, and
`NEXT_PUBLIC_MAIC_EDITOR_ENABLED`. Batch C appends `MINIMAL_MODE` and
`NEXT_PUBLIC_MINIMAL_MODE` so a developer's local flag can never poison a
hermetic gate. Tests that explicitly exercise flag-on behavior set
`MINIMAL_MODE=true` or `NEXT_PUBLIC_MINIMAL_MODE=true` in the gate prefix.

### S1 Flag pair, mirror, boot warning, and env docs

Delivers: the server-only source of truth, the build-inlined client mirror,
the ACCESS_CODE coexistence warning at boot, and the `.env.example` entries.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/config/feature-flags.ts::isMinimalModeEnabled` | function | `(): boolean` | server-only runtime read of `MINIMAL_MODE` through `readBoolean` |
| `lib/config/feature-flags.ts::isMinimalModeClientEnabled` | function | `(): boolean` | build-inlined read of `NEXT_PUBLIC_MINIMAL_MODE` through `readBoolean` |
| `lib/server/config-validation.ts::validateMinimalMode` | function | `(): void` | warn-first: logs the Q14 coexistence note when both `MINIMAL_MODE` and `ACCESS_CODE` are set |
| `lib/server/config-validation.ts::validateServerConfig` | function | `(): void` | modified: calls `validateMinimalMode` beside the existing four validators |

Before-state capture notes: `lib/config/feature-flags.ts` has no minimal-mode
symbols. `validateServerConfig` at `lib/server/config-validation.ts:175`
runs four validators from `instrumentation.ts:29`. `.env.example` has no
minimal-mode section.

Postcondition: `isMinimalModeEnabled` returns true only for `true` or `1`.
The client mirror reads only the `NEXT_PUBLIC_` variable. The boot log shows
one `[config]` warning when both vars are set, and no warning otherwise. The
.env.example documents both vars and the kill-switch contract.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/minimal-mode/feature-flags.test.ts && echo MINIMAL_FLAG_OK` expects `MINIMAL_FLAG_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 2.

### S2 Guard wrapper and per-route adoption

Delivers: the flag-gated wrapper, the public re-export, and the adoption of
the wrapper on every model spending route listed in the route table in
Implementation Decisions.

Ledger bindings:

The wrapper carries a single-line signature, pinned at plan time:

- `lib/auth/permissions-server.ts::requirePermissionIfMinimalMode` (kind
  function, after-signature):

  ```
  (
    headers: Headers,
    permission: Permission,
  ): Promise<void>
  ```

  Behavior: returns immediately when `MINIMAL_MODE` is off, delegates to `requirePermission` otherwise, throwing the typed 403

- `lib/auth/index.ts::requirePermissionIfMinimalMode` (kind function,
  after-signature):

  ```
  (
    headers: Headers,
    permission: Permission,
  ): Promise<void>
  ```

  Behavior: modified: re-exports the wrapper through the public surface

The adoption rows follow one shape. Each handler becomes:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/api/chat/route.ts::POST` | function | `(req: NextRequest): Promise<Response>` | modified: adopts the wrapper with `classroom.chat` as the first statement |
| `app/api/chat/pi/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `classroom.chat` as the first statement |
| `app/api/generate/scene-content/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/generate/scene-actions/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/generate/scene-outlines-stream/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/generate/agent-profiles/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/generate-classroom/route.ts::POST` | function | `(req: NextRequest): Promise<Response>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/generate/tts/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `tts.use` as the first statement |
| `app/api/generate/image/route.ts::POST` | function | `(request: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/generate/video/route.ts::POST` | function | `(request: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/generate/voice/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `tts.use` as the first statement |
| `app/api/transcription/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `asr.use` as the first statement |
| `app/api/web-search/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/extract-document/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/parse-pdf/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `course.create` as the first statement |
| `app/api/pbl/v2/instructor/route.ts::POST` | function | `(req: NextRequest): Promise<Response>` | modified: adopts the wrapper with `classroom.chat` as the first statement |
| `app/api/pbl/v2/open-task/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `classroom.chat` as the first statement |
| `app/api/pbl/v2/evaluate/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `classroom.chat` as the first statement |
| `app/api/pbl/v2/simulator/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `classroom.chat` as the first statement |
| `app/api/verify-model/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `settings.manage` as the first statement |
| `app/api/verify-image-provider/route.ts::POST` | function | `(request: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `settings.manage` as the first statement |
| `app/api/verify-video-provider/route.ts::POST` | function | `(request: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `settings.manage` as the first statement |
| `app/api/verify-pdf-provider/route.ts::POST` | function | `(req: NextRequest): Promise<NextResponse>` | modified: adopts the wrapper with `settings.manage` as the first statement |

Before-state capture notes: none of the listed handlers imports
`requirePermission` or the wrapper. `app/api/chat/route.ts:44` starts its
POST body with heartbeat wiring and `req.json()` at `:50`. The pbl/v2 routes resolve
models through `resolveModelFromRequest` before any model call
(`app/api/pbl/v2/instructor/route.ts:61`). The verify probes call providers
(`app/api/verify-model/route.ts:39`).

Postcondition: every row adopts the wrapper as the first statement. With the
flag off, each route behaves byte-for-byte as today. With the flag on, a
denied rank receives the typed 403 with shape `{ message, code }` before any
model resolution, and the model call never runs.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/minimal-mode/flag-off-parity.test.ts && echo PARITY_OK` expects `PARITY_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; MINIMAL_MODE=true pnpm test tests/minimal-mode/live-wire.pg.test.ts && echo LIVE_OK` expects `LIVE_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate drives one real guarded route with a real
seeded session and `MINIMAL_MODE=true`, mocking nothing in the guard seam.
The guest 403 path needs no provider mock, because the guard throws before
any model code runs.

### S3 Route-guard matrix suite

Delivers: the hermetic suite that enumerates the route to permission
expectations, the flag-off parity suite, and the client import graph guard
for the wrapper surface.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/auth/permissions-server.ts::requirePermissionIfMinimalMode` | function | see S2 pin | tested: flag-off no-op, flag-on delegation, typed 403 shape |

Before-state capture notes: no test enumerates route to permission
expectations today. `tests/permissions/require-permission.test.ts` covers
the guard alone. `tests/branding/client-import-graph.test.ts` is the import
graph precedent.

Postcondition: one suite documents every spend route in the matrix table and
asserts its permission key. The parity suite proves the wrapper returns
without session or database access when the flag is unset. The import graph
guard proves the wrapper surface never leaks into client bundles.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/minimal-mode/route-guard-matrix.test.ts && echo MATRIX_OK` expects `MATRIX_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/minimal-mode/client-import-graph.test.ts && echo GRAPH_OK` expects `GRAPH_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/providers/provider-neutrality-guard.test.ts && echo NEUTRAL_OK` expects `NEUTRAL_OK`

Risk tier: 2.

### S4 Guest quiz quota

Delivers: the `quiz_grade_quota` table in the lazy ensure chain, the flag
gated quota consumer, and the quiz-grade route stacking quota over the
existing permission guard.

Ledger bindings:

- `lib/auth/schema.ts::ensureAuthSchema` (kind function, after-signature
  `(queryable: Queryable): Promise<void>`)

  Behavior: modified: composes `quiz_grade_quota` into the ensure chain

- `lib/auth/quiz-quota.ts::consumeQuizGradeQuota` (kind function,
  after-signature):

  ```
  (
    queryable: Queryable,
    userId: string,
  ): Promise<void>
  ```

  Behavior: flag-gated. Resolves the user rank. Rank 1 performs one atomic upsert keyed by UTC day and throws the 429 Response when the count would exceed 5. Learner and above and flag-off return without writing

- `app/api/quiz-grade/route.ts::POST` (kind function, after-signature
  `(req: NextRequest): Promise<Response>`)

  Behavior: modified: stacks the quota consumer after the `quiz.grade` guard
  and before `resolveModelFromRequest`, inside the same nested
  Response-rethrow catch as the guard (`app/api/quiz-grade/route.ts:34-39`),
  so the 429 rides the `err instanceof Response` passthrough and never the
  outer catch at `:115-121` that flattens to 500. The route captures the
  `Session` returned by `requirePermission` and passes `session.userId` to
  `consumeQuizGradeQuota`

Before-state capture notes: `lib/auth/schema.ts` ends its schema text at the
`role_permissions` table (`:90-95`). The quota table does not exist. The
quiz-grade route at `app/api/quiz-grade/route.ts:29` guards first, then parses
the body. The response shape follows the `apiError` pattern.

Postcondition: the table exists app-side with `user_id`, `day`, and `count`.
The fifth grade in a UTC day succeeds. The sixth returns 429 with body
`{ message: "quiz grading quota exhausted", code: "quota_exhausted" }`.
Concurrent grade requests near the cap allow exactly five total. The day
flips at UTC midnight. Learners and above never write the table.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/minimal-mode/quiz-quota.test.ts && echo QUOTA_OK` expects `QUOTA_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; test -n "$PG_CONTRACT_URL" && pnpm test tests/minimal-mode/quiz-quota.pg.test.ts && echo QUOTA_PG_OK` expects `QUOTA_PG_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; MINIMAL_MODE=true pnpm test tests/minimal-mode/live-wire.pg.test.ts && echo LIVE_OK` expects `LIVE_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; test -n "$PG_CONTRACT_URL" && pnpm test tests/minimal-mode/quiz-quota-concurrency.pg.test.ts && echo QUOTA_RACE_OK` expects `QUOTA_RACE_OK`

Risk tier: 4. The live-wire gate drives the real quiz-grade route with a real
guest session and `MINIMAL_MODE=true`. It seeds a guest and a learner, calls
the route five times with `callLLM` mocked, and asserts the sixth returns
429. The seam under test, which is `requirePermission`, `getSession`, and
`consumeQuizGradeQuota`, is never mocked. The adversarial gate fires
concurrent increments from parallel clients and asserts the total never
exceeds five.

### S5 Minimal layout and signed-out capsule

Delivers: the home page composer gating, the library-up layout with the
existing grid recipe, the capsule Pro toggle gating, the signed-out capsule
entries, and the new i18n keys.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/page.tsx::HomePage` | function | `()` | modified: hides the hero block when the client mirror is on and the user lacks `course.create`, and forces the library section expanded |
| `components/account-zone.tsx::AccountZone` | function | `({ onSignOut }: AccountZoneProps)` | modified: signed-out branch renders Sign in and Create account when the client mirror is on, else today's single Sign in pill |

Before-state capture notes: `app/page.tsx::HomePage` at `:126` renders the
hero block with the composer at `:766` and the generation toolbar at `:790`.
The library grid recipe is `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4`
at `:1152`, which is the 2-3-4 recipe the approved mockup cites as
`app/page.tsx:1263` before the batch G and A rework. `components/account-zone.tsx:106`
renders a single Sign in pill for the signed-out state. The capsule Pro
toggle ships ungated from batch G, per R3-Q6.

Postcondition: with the client mirror off, the home page renders today's
layout exactly. With it on, ranks without `course.create` see no composer,
the library moves to the top and renders expanded with the existing grid
recipe, and the capsule hides the Pro toggle. Creators and admins see the
full layout unchanged. Signed-out visitors see Sign in and Create account in
the capsule. The new strings pass the 12-locale parity check.

Gates:

- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/minimal-mode/minimal-layout.test.ts && echo LAYOUT_OK` expects `LAYOUT_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/minimal-mode/client-import-graph.test.ts && echo GRAPH_OK` expects `GRAPH_OK`
- smoke: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`

Risk tier: 3. The LAYOUT_OK gate renders the real home layout via
`renderToStaticMarkup` through the flag and permission stack, which is
integration per the 014 header-capsule precedent, so it now carries the
integration tag and tier 3 holds. The import graph gate mirrors
`tests/permissions/client-import-graph.test.ts` and guards the whole client
affordance surface.

## Implementation Decisions

- The flag lives in `lib/config/feature-flags.ts`. `isMinimalModeEnabled`
  reads the server-only `MINIMAL_MODE` at runtime and
  `isMinimalModeClientEnabled` reads the build-inlined
  `NEXT_PUBLIC_MINIMAL_MODE`, both through the existing `readBoolean`
  helper. The file is the established home for both patterns
  (`isAgentRuntimeEnabled` and `isProWorkbenchEnabled` sit side by side
  there today). A new `lib/config/minimal-mode.ts` would duplicate the
  helper and fragment the flag surface, so it is rejected.
- The boot warning hooks `validateMinimalMode` into the existing warn-first
  `validateServerConfig` path, which `instrumentation.ts:29` already calls.
  No new boot site is introduced.
- The guard wrapper is `requirePermissionIfMinimalMode`. It returns without
  session or database access when `MINIMAL_MODE` is unset, then delegates to
  `requirePermission` when set. The typed 403 refusal keeps the batch B
  shape `{ message, code }` with `code: 'permission_denied'`. This is the
  kill-switch guarantee in code.
- The route to permission table is the batch contract. Every spend route
  gets one permission key from the matrix.

  | Route (handler) | Spends | Permission |
  | --- | --- | --- |
  | `app/api/chat/route.ts::POST` | LLM | classroom.chat |
  | `app/api/chat/pi/route.ts::POST` | LLM | classroom.chat |
  | `app/api/generate/scene-content/route.ts::POST` | LLM | course.create |
  | `app/api/generate/scene-actions/route.ts::POST` | LLM | course.create |
  | `app/api/generate/scene-outlines-stream/route.ts::POST` | LLM | course.create |
  | `app/api/generate/agent-profiles/route.ts::POST` | LLM | course.create |
  | `app/api/generate-classroom/route.ts::POST` | LLM | course.create |
  | `app/api/generate/tts/route.ts::POST` | TTS | tts.use |
  | `app/api/generate/image/route.ts::POST` | image | course.create |
  | `app/api/generate/video/route.ts::POST` | video | course.create |
  | `app/api/generate/voice/route.ts::POST` | voice registration | tts.use |
  | `app/api/transcription/route.ts::POST` | ASR | asr.use |
  | `app/api/web-search/route.ts::POST` | LLM and search | course.create |
  | `app/api/extract-document/route.ts::POST` | extraction | course.create |
  | `app/api/parse-pdf/route.ts::POST` | PDF | course.create |
  | `app/api/pbl/v2/instructor/route.ts::POST` | LLM | classroom.chat |
  | `app/api/pbl/v2/open-task/route.ts::POST` | LLM | classroom.chat |
  | `app/api/pbl/v2/evaluate/route.ts::POST` | LLM | classroom.chat |
  | `app/api/pbl/v2/simulator/route.ts::POST` | LLM | classroom.chat |
  | `app/api/quiz-grade/route.ts::POST` | LLM | quiz.grade, kept from batch B, quota stacked |
  | `app/api/verify-model/route.ts::POST` | LLM probe | settings.manage |
  | `app/api/verify-image-provider/route.ts::POST` | image probe | settings.manage |
  | `app/api/verify-video-provider/route.ts::POST` | video probe | settings.manage |
  | `app/api/verify-pdf-provider/route.ts::POST` | PDF probe | settings.manage |

  Several routes spend no model money and carry no gate. They are listed
  here so the enumeration is complete and the decision is on the record.

  | Route (handler) | Why no gate |
  | --- | --- |
  | `app/api/classroom-media/[classroomId]/[...path]/route.ts::GET` | byte server with public immutable caching. A session lookup per byte harms streaming and playback, and the course-open audience rule belongs to batch D |
  | `app/api/generate-classroom/[jobId]/route.ts::GET` | job status read, no spend |
  | `app/api/pbl/v2/task/update/route.ts::POST` | pure state mutation, no LLM involvement, documented in the route header |
  | `app/api/chat/pi/whiteboard-visibility/route.ts` | flag read for the Pi chat affordance |
  | `app/api/server-providers/route.ts`, `app/api/azure-voices/route.ts`, `app/api/provider/probe-models/route.ts`, `app/api/usage/route.ts` | settings surfaces owned by batch E. `probe-models` makes a live provider network call (`fetchModels` at `:38`) but spends no LLM tokens, so the deferral rests on settings ownership, not on read-only status. The settings spend point is the `verify-*` probe family, which is gated |
  | `app/api/export-video/**` | video composition under the existing feature flag, no model spend |
  | remaining persistence, material, folder, skill, agent, stage, and proxy routes | storage and byte serving, no model spend |

  Two matrix ambiguities resolved here. Image and video generation have no
  matrix row of their own, so they map to `course.create` as authoring
  media, matching the Create and edit courses row. The web search and
  document extraction routes serve the authoring flow, so they map to
  `course.create` as well.
- The quiz-grade route keeps the batch B guard exactly as shipped. Batch C
  stacks the quota consumer between the guard and `resolveModelFromRequest`.
  The quota activates only when `MINIMAL_MODE` is on, so flag-off behavior
  stays byte-identical to the certified post-B state.
- The quota table is `quiz_grade_quota` with columns `user_id TEXT NOT NULL`,
  `day DATE NOT NULL`, `count INTEGER NOT NULL DEFAULT 0`, and primary key
  `(user_id, day)`. It is app-owned and composed into the lazy ensure chain
  in `lib/auth/schema.ts`. The table lives with the six auth tables because
  Q11 pins every auth adjacent table to `lib/auth/` with the ensure pattern,
  and a separate `lib/quota/schema.ts` would add a second bootstrap entry
  point for one table.
- The quota day is the UTC calendar day, computed in SQL as
  `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`. The consumer runs one
  atomic upsert for rank-1 users that increments only while the count is
  below five and returns the new count. A missing return row means the cap
  is reached. Postgres row locks serialize concurrent upserts, so exactly
  five increments win under race.
- The quota refusal is a thrown `Response` with status 429 and body
  `{ message: "quiz grading quota exhausted", code: "quota_exhausted" }`,
  mirroring the `requirePermission` typed-refusal idiom. The quota call must
  ride the same nested Response-rethrow catch as the guard
  (`app/api/quiz-grade/route.ts:34-39`), never the outer catch at `:115-121`
  which flattens every error to a 500.
- The quota consumer, `consumeQuizGradeQuota`, resolves the user rank with a
  join on `user_roles` and `roles`. Learner and above return without
  writing. Anonymous never reaches it because the permission guard denies
  quiz.grade first. The route captures the `Session` returned by
  `requirePermission` and passes `session.userId` as the `userId`.
- The minimal layout gates on the client mirror and `course.create`. Ranks
  without `course.create`, meaning anonymous, guest, and learner, hide the
  hero block that contains the headline, composer, and generation toolbar.
  The library section renders expanded at the top and reuses the existing
  grid recipe `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4`. The approved
  mockup is `docs/design/rbac-batch-a/home-minimal.html`. The capsule Pro
  toggle hides for the same ranks, per R3-Q6, while the batch G rendering
  stays unchanged when the mirror is off.
- The signed-out capsule shows Sign in and Create account under the client
  mirror, replacing today's single Sign in pill. The keys `auth.nav.signIn`
  and `auth.nav.createAccount` already exist in all 12 locales and are
  reused.
- New i18n keys ship in `en-US.json` as the source of truth: `quiz.quotaExhausted`
  with the copy "You reached the daily limit for AI grading. Try again
  tomorrow or sign in with a member account.", plus the approved minimal
  empty state keys `classroom.emptyTitle` and `classroom.emptyGuestBody`
  from the design record. All keys get 12-locale parity.
- The quiz client maps a 429 with `code: "quota_exhausted"` to
  `quiz.quotaExhausted` and does not award half credit, unlike the current
  generic failure fallback in `components/scene-renderers/quiz-view.tsx:131`.
- New identifiers avoid the substrings "token" and "plan". The flag names,
  the table name, and the module names ship clean per the provider
  neutrality guard.
- No new permission enters the catalog. The quota is a stacked check over
  `quiz.grade`, not a permission.

## Testing Decisions

- New suites live under `tests/minimal-mode/`. Root vitest picks up
  `tests/**/*.test.ts` and `.env.local` is not loaded, per the established
  hermetic setup.
- The env-clear prefix is the 015 canonical list copied verbatim, extended
  with `MINIMAL_MODE` and `NEXT_PUBLIC_MINIMAL_MODE`. Gates that test
  flag-on behavior set the relevant variable inline instead.
- The PIN-FROM-OUTLINE rule is the hard lesson of batches A, B, and G. Pin
  signatures after the code exists or from machine-extracted text, never
  from prose. New symbols above pin the intended declaration text. After
  implementation the builder replaces every pinned string with the
  byte-exact outline text. Multi-line signatures move to code-block
  bindings.
- The live-wire-proof rule is the hard lesson of batch B round 1. The
  guest 403 and quota 429 paths drive the real route stack. The suite seeds
  real better-auth users, sessions, and role rows in a scratch database and
  mocks only `callLLM` at the model boundary. `requirePermission`,
  `getSession`, and `consumeQuizGradeQuota` are never mocked.
- The pg contract suites provision their own scratch database per the
  app-side precedent (`tests/agent-runtime/event-notify.pg.test.ts:58-72`)
  and fail closed without `PG_CONTRACT_URL`, which is intended for tier-3
  and tier-4 gates.
- The adversarial concurrency suite fires parallel quota increments and
  asserts the runner count never exceeds five, then verifies the next UTC
  day resets by injecting the day value directly.
- The client import graph guard mirrors
  `tests/permissions/client-import-graph.test.ts` and extends the server
  package list exactly as batch B did.
- The provider neutrality guard runs in S3. Every new identifier carries no
  token or plan segment, verified by the existing suite.
- The i18n parity check runs in S5. New keys get 12-locale parity.
- Plan-time state: the `tests/minimal-mode/*` suites do not exist yet and
  fail with no marker until they do. These are the documented
  deliverable-dependent failures.

## Out of Scope

- Publishing, audience, and the public gallery (batch D).
- The admin settings UI, user list, role assignment, and invites (batch E).
- The custom role editor (batch F).
- Rate limiting beyond the guest quiz quota. No other role carries a quota.
- Per-user quotas for creators, learners, or admins.
- The batch D featured row preview from the minimal mockups.
- The settings dialog surface itself. Batch E owns hiding provider sections
  from non-admin ranks. Batch C gates only the probe spend points.

## Further Notes

- The program record is `docs/meta-specs/rbac-minimal-mode.md`. Batch C
  depends on A and B and may assume `requirePermission`, the permission
  catalog, sessions, and the role ranks.
- The register names the quota table `quota_daily` at Q11 while the batch C
  brief names it `quiz_grade_quota`. This spec pins `quiz_grade_quota`
  because the brief is the operative batch contract. The register name is
  superseded and should be corrected there on closure.
- The mockups render a Pro toggle in the learner capsule while R3-Q6 pins
  creator and admin visibility. This spec follows the register decision and
  reports the mockup delta.
- The library grid recipe moved from line 1263 in the approved mockup
  citation to line 1152 after the batch G and A rework. The recipe itself is
  unchanged.
- The visual-preview checkpoint runs before implementation. The minimal home
  renders in localhost and is approved in Safari first, per the program
  process rules.
- Batch C holds no new operator env var outside `MINIMAL_MODE` and
  `NEXT_PUBLIC_MINIMAL_MODE`. `.env.example` gains them in this batch.
- The quiz-grade 429 handling changes the client fallback behavior in
  `components/scene-renderers/quiz-view.tsx`.
- Commit convention for this batch: `feat(rbac): ...`.

## Amendment log

None yet.