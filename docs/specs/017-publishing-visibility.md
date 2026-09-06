# Batch 017 spec: publishing-visibility

Spec status: research_update

## Problem Statement

A course creator cannot make a course visible to a defined audience. The
publish routes exist but nothing in the product can call them. The read path
ignores every visibility field, so privacy is URL obscurity. From the operator
view the consequences are concrete.

- The document read gate ignores `is_public`: the read case of
  `decideDocumentAccess` returns `allow` for any live stage
  (`lib/persistence/document-access.ts:70-74`). Any caller holding the
  course id can read the full document through the persistence seam
  (`app/api/persistence/[...path]/route.ts:283-301`).
- Publish refuses anonymous owners with `login_required` 401
  (`app/api/stages/[id]/publish/route.ts:26-31`). Batch A made real sign-in
  exist, so a signed-in creator now passes the owner check and the route works,
  but no UI calls it. The `login_required` path is a dead end from before batch
  A and the same check blocks unpublish (`app/api/stages/[id]/unpublish/route.ts:25-30`).
- The classroom fallback route serves any classroom JSON file by id with no
  ownership or audience check (`app/api/classroom/route.ts:51-85`, file read at
  `lib/server/classroom-storage.ts:48-59`).
- The stage-meta sidecar answers any visitor about any course id
  (`app/api/stage-meta/[stageId]/route.ts:38-68`), which makes drafts
  discoverable as existing even when their bytes are hard to guess.
- `stage_meta` stores the boolean `is_public` and `published_at`
  (`lib/persistence/stage-meta.ts:24-33`). Q7 replaces that boolean with
  `status` and `audience`, and the migration from old public rows is not yet
  specified (`docs/meta-specs/rbac-minimal-mode.md:164`).
- No gallery exists. The acceptance criteria promise a public listing of
  published courses the visitor's rank may open
  (`docs/meta-specs/rbac-minimal-mode.md:315-316`).

## Solution

Batch D adds `status` and `audience` columns to `stage_meta` on the same table
the publish seams already use, with the lazy `ADD COLUMN IF NOT EXISTS`
pattern. Publishing sets an audience tier by role rank. The document read gate
enforces the audience at the API level and answers 404 for unpublished and
wrong-audience courses. A public gallery page lists published courses the
viewer may open. The publish routes lose the dead `login_required` path and
enforce `course.publish` through the batch B guard. Existing `is_public=true`
rows migrate to published and everyone. Anonymous owners never reach publish
because the permission guard denies them first.

The read gate is one decision applied three times. The persistence document
seam, the classroom fallback route, and the stage-meta sidecar all resolve the
viewer rank once per request and compare it against the audience rank stored on
the row. Owners always pass. Everyone else passes only for published courses
whose audience rank is at or below the viewer rank. Anything else answers the
same 404 as a missing course, so the no-existence-oracle posture of the storage
route (`app/api/persistence/[...path]/route.ts:304-305`) extends to audience.

## User Stories

1. As an operator, I want courses to publish to a rank-based audience tier, so
   that a course can target everyone, guests, or learners.
2. As a creator, I want to publish my own course with an audience picker that
   defaults to everyone, so that the flow is one click and behaves the same in
   every mode.
3. As an anonymous visitor, I want a public gallery of courses I may open, so
   that published content is discoverable without knowing course ids.
4. As a guest or learner, I want a shared link to open only when my rank
   matches the audience, so that the gate is enforced by the server.
5. As a course owner, I want drafts readable only by me, so that work in
   progress never leaks through a guessed URL.
6. As an admin, I want to publish any course, so that a course is not hostage
   to its creator's account.
7. As a verifier, I want API probes across every role and course state to
   return only the allowed pairs, so that a cross-audience leak cannot regress
   silently.

## Slices

Each slice lists the ledger bindings, before-state notes, postcondition, and
gate inventory. New symbols pin their intended declaration text at plan time.
After implementation the builder re-pins byte-exact from machine-extracted
outline text, per the PIN-FROM-OUTLINE rule in Testing Decisions.

The env-clear prefix is the 015 canonical list, copied verbatim from the batch
C spec, including the two batch C variables. Batch D introduces no new
variables, so the list stays exactly:

`unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE;`

### S1 Schema, migration, and visibility writer

Delivers: the `status` and `audience` columns, the idempotent backfill of
legacy public rows, the gallery index, and the writer that sets visibility.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/persistence/stage-meta.ts::STAGE_META_SCHEMA` | const | `string` | modified: appends two `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements, the guarded backfill `UPDATE`, and the new partial index |
| `lib/persistence/stage-meta.ts::StageMetaRow` | interface | `{ stageId, ownerId, isPublic, status, audience, publishedAt, generationComplete, deletedAt }` | modified: adds `status: 'draft' | 'published'` and `audience: number`. `isPublic` stays as a derived compatibility field |
| `lib/persistence/stage-meta.ts::readStageMeta` | function | `(queryable: Queryable, stageId: string): Promise<StageMetaRow | null>` | modified: reads `status` and `audience`, derives `isPublic` from status |
| `lib/persistence/stage-meta.ts::setStageVisibility` | function | `(queryable: Queryable, stageId: string, status: 'draft' | 'published', audience: number): Promise<void>` | new: writes `status` and `audience`, mirrors `is_public` and `published_at` for legacy readers, refuses soft-deleted rows |
| `lib/server/stage-access.ts::StageAccess` | interface | `{ stageId, ownerId, name, isPublic, status, audience, publishedAt, generationComplete, source, deletedAt }` | modified: adds `status` and `audience`, keeps `isPublic` derived |
| `lib/server/stage-access.ts::readStageAccessIncludingDeleted` | function | `(stageId: string, queryable?: StageAccessQueryable): Promise<StageAccess | null>` | modified: selects and maps `status` and `audience` |

Before-state capture notes: `STAGE_META_SCHEMA` at `lib/persistence/stage-meta.ts:24-48`
carries the legacy public partial index on `is_public` at `:40-41` and ends
with the owner backfill INSERT at `:43-47`. `setStagePublished`
at `:151-163` writes only `is_public` and `published_at`. `ACCESS_SQL` at
`lib/server/stage-access.ts:42-52` selects only the legacy metadata columns.

Postcondition: the columns exist app-side on `stage_meta`. Every live row with
`is_public = true` and `status = 'draft'` becomes `published` with `audience 0`.
New rows default to `status 'draft'` and `audience 3`. The gallery index exists.
`setStageVisibility` writes both new columns and keeps `is_public` and
`published_at` in agreement.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/publishing/visibility-columns.test.ts && echo COLUMNS_OK` expects `COLUMNS_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 2.

### S2 Audience-enforced read gate

Delivers: the rank resolver, the audience rule inside `decideDocumentAccess`,
and the adoption of the rule on the three content seams, plus the generation
pipeline row claim so courses created by the AI pipeline carry stage meta.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/persistence/audience.ts::AUDIENCE_RANK` | const | `{ EVERYONE: 0, GUEST: 1, LEARNER: 2 }` | new: frozen rank constants shared by the picker and the gate |
| `lib/persistence/audience.ts::resolveViewerRank` | function | `(queryable: Queryable, ownerId: string): Promise<number>` | new: returns 0 for `anon:` owners and unknown users, the role rank join for `user:` owners |
| `lib/persistence/document-access.ts::decideDocumentAccess` | function | `(action: DocumentAction, ownerId: string | undefined, readMeta: StageMetaReader, documentExists: DocumentExistenceReader, rereadMeta?: StageMetaReader, viewerRank?: number): Promise<DocumentAccess>` | modified: read case allows the owner, then requires `status 'published'` and `viewerRank >= audience`, else `not-found` |
| `app/api/persistence/[...path]/route.ts::handlePersistenceRequest` | function | `(request: Request, deps?: PersistenceRequestDeps): Promise<Response>` | modified: resolves `viewerRank` once and passes it into `decideDocumentAccess` |
| `app/api/stage-meta/[stageId]/route.ts::GET` | function | `(req: NextRequest, { params }: Params)` | modified: returns 404 for non-owner drafts and wrong-audience courses, keeps 200 for owners |
| `app/api/classroom/route.ts::GET` | function | `(request: NextRequest)` | modified: applies the audience rule to every id, and when no `stage_meta` row exists the gate creates nothing and answers 404 under `MINIMAL_MODE`, with flag-off file serving unchanged (parity) |
| `lib/server/classroom-generation.ts::generateClassroom` | function | `(input: GenerateClassroomInput, options: { baseUrl: string; onProgress?: (progress: ClassroomGenerationProgress) => Promise<void> | void; ownerId?: string }): Promise<GenerateClassroomResult>` | modified: claims the `stage_meta` row for the creating owner after the `persistClassroom` call, so the new course carries owner and the column defaults `status 'draft'`, `audience 3` |

Before-state capture notes: `decideDocumentAccess` reads any live stage
(`lib/persistence/document-access.ts:70-74`) and never looks at ownership. The
persistence route passes only the three existing readers at
`app/api/persistence/[...path]/route.ts:291-300`. The stage-meta route emits
`isOwner` with no audience check (`app/api/stage-meta/[stageId]/route.ts:55`).
The classroom GET has no owner or audience check (`app/api/classroom/route.ts:51-85`).
The generation pipeline persists classroom JSON with no stage_meta row
(`lib/server/classroom-generation.ts:711-718`), and `POST /api/classroom`
writes the same JSON files with no session and no row
(`app/api/classroom/route.ts:14-49`).
`ROLE_RANKS` pins anonymous 0, guest 1, learner 2, creator 3, admin 4
(`lib/auth/roles.ts:7-13`). The rank join pattern exists at
`lib/auth/permissions-server.ts:43-47`.

Postcondition: a reader is allowed only when they own the course or the course
is published with an audience at or below their rank. Drafts and wrong-audience
courses answer 404 on all three seams. A classroom id with no `stage_meta` row
answers 404 under the flag, and flag-off keeps today's file serving. The
generation pipeline claims the row at creation with the owner and default
draft status. Anonymous viewers keep rank 0 and only see everything-audience
courses. Owners keep every read, including drafts.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/publishing/read-gate.test.ts && echo GATE_OK` expects `GATE_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/publishing/read-gate.pg.test.ts && echo GATE_PG_OK` expects `GATE_PG_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate drives the real persistence route and the
stage-meta route with a seeded database and never mocks `resolveViewerRank`,
`decideDocumentAccess`, or `getSession`. The suites toggle `MINIMAL_MODE`
in-process, because the gate prefix clears it, so the classroom-seam probes
cover the flag-on deny paths and the flag-off parity 200.

### S3 Publish flow, audience picker, and i18n

Delivers: the rewritten publish and unpublish routes, the publish dialog with
the audience picker, the home library wiring, and the new i18n keys.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `app/api/stages/[id]/publish/route.ts::POST` | function | `(req: NextRequest, { params }: Params)` | modified: calls `requirePermission(headers, 'course.publish')` inside the Response-rethrow catch, reads optional `audience` from the body with default 0, allows an admin to publish any course, writes `setStageVisibility(db, stageId, 'published', audience)`, returns `{ success, publishedAt, name, audience }`. The rethrow returns the typed 403 unchanged past the route catch and the `withRequestOwnerId` callback catch |
| `app/api/stages/[id]/unpublish/route.ts::POST` | function | `(req: NextRequest, { params }: Params)` | modified: calls `requirePermission(headers, 'course.publish')` inside the Response-rethrow catch, allows an admin to unpublish any course, writes `setStageVisibility(db, stageId, 'draft', audience)` with the stored audience kept. The rethrow returns the typed 403 unchanged past the route catch and the `withRequestOwnerId` callback catch |
| `components/publishing/publish-dialog.tsx::PublishDialog` | function | `({ open, stageId, onOpenChange }: PublishDialogProps)` | new: dialog with the audience picker, publish and unpublish actions, status feedback |
| `app/page.tsx::HomePage` | function | `()` | modified: mounts the publish dialog from the course card menu and refreshes the library after a visibility change |
| `app/page.tsx::ClassroomCard` | function | props unchanged plus `onPublish` | modified: gains a publish affordance next to rename and delete |
| `lib/i18n/locales/en-US.json` | file | new `publishing` group | modified: source-of-truth keys for the dialog, the badges, and the gallery |

Before-state capture notes: the publish route rejects `anon:` owners with 401
(`app/api/stages/[id]/publish/route.ts:26-31`) and tests pin that behavior at
`tests/agent-runtime/stage-meta-routes.test.ts:195-203`. The unpublish route
keeps the same 401 (`app/api/stages/[id]/unpublish/route.ts:25-30`). Both call
`setStagePublished` with a boolean. No component imports
`/api/stages/[id]/publish`. The library card has delete and rename only
(`app/page.tsx:1675-1706`). `can()` grants `course.publish` to rank 3 and
above (`lib/auth/permissions.ts:79-85`). The share locale group holds one key
(`lib/i18n/locales/en-US.json:963-965`).

Postcondition: a signed-in creator publishes own courses with a chosen
audience, defaulting to everyone. Anonymous and learner callers receive the
typed 403 with `{ message, code }`. A creator cannot publish a foreign course.
An admin can. Unpublish returns a course to draft and the course answers 404 to
everyone but the owner. The dialog renders in Safari with the picker always
visible in every mode. All new strings pass the 12-locale parity check.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/publishing/publish-routes.test.ts && echo PUBLISH_ROUTES_OK` expects `PUBLISH_ROUTES_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/publishing/publish-live-wire.pg.test.ts && echo PUBLISH_LIVE_OK` expects `PUBLISH_LIVE_OK`
- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`

Risk tier: 3. The live-wire gate seeds a creator, a learner, and an admin,
drives the real publish route through the real permission stack, and asserts
the audience writes land in the database. The gate seam is never mocked; only
the unit gate mocks `getSession` for its fixtures. Required Safari
checkpoint: the publish dialog with the audience picker.

### S4 Public gallery page

Delivers: the rank-filtered listing query, the gallery page, the gallery i18n
keys, and the home entry link so the gallery is reachable without knowing
course ids.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `lib/persistence/gallery.ts::listGalleryCourses` | function | `(queryable: Queryable, viewerRank: number): Promise<GalleryCourse[]>` | new: lists published, non-deleted courses with `audience <= viewerRank`, ordered by `published_at` descending |
| `app/gallery/page.tsx::GalleryPage` | function | `()` | new: server component resolving the viewer rank from the request, rendering the filtered list, linking each card to `/classroom/[id]`, empty state for zero results |
| `app/page.tsx::HomePage` | function | `()` | modified: renders the gallery entry link in the library action bar, visible to every rank |

Before-state capture notes: no gallery route or page exists. The only course
list is the owner-scoped `GET /api/stages` consumed by `listStages`
(`lib/utils/stage-storage.ts:738-744`), which is invisible to other viewers.
The home grid recipe is `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4`
(`app/page.tsx:1167`).

Postcondition: an anonymous viewer sees only everything-audience courses. A
guest additionally sees guest courses, a learner additionally sees learner
courses. Drafts and unpublished courses never appear. The home library action
bar links to the gallery for every rank: the link sits in the action cluster
at `app/page.tsx:950-1098` before the import button at `:1061`, because the
matrix grants gallery browse to every rank
(`docs/meta-specs/rbac-minimal-mode.md:204`). The page renders in Safari. The
listing never returns `owner_id` or other tenancy fields.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/publishing/gallery-list.test.ts && echo GALLERY_LIST_OK` expects `GALLERY_LIST_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/publishing/gallery.pg.test.ts && echo GALLERY_PG_OK` expects `GALLERY_PG_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 3. The integration gate seeds one course per audience tier and
asserts the per-rank listing through the real query. Required Safari
checkpoint: the gallery page.

### S5 No-leak adversarial proof

Delivers: the adversarial suite that proves the read gate leaks no cross
audience content through any seam.

Ledger bindings:

| file::symbol | kind | after-signature or shape (planned) | behavior |
| --- | --- | --- | --- |
| `tests/publishing/no-leak.pg.test.ts` | suite | `describe('publishing no-leak probes')` | new: probes the persistence route, the stage-meta route, and the classroom route across every role class and course state, plus the JSON-only no-row classroom case with the flag toggled in-process |

Before-state capture notes: `tests/agent-runtime/persistence-routes-gate.test.ts`
covers route gating but not audience cross-checks. The batch C adversarial
precedent is `tests/minimal-mode/quiz-quota-concurrency.pg.test.ts`.

Postcondition: the header row is proven per seam. For every course in
`{ draft, published everyone, published guest, published learner, tombstoned }`
and every caller in `{ anonymous, guest, learner, creator, admin, owner }`, the
probe asserts the exact 404 or 200 pair. A JSON-only legacy course with no
`stage_meta` row answers 404 on the classroom seam under the flag for an
anonymous caller and for a rank-2 viewer, and answers 200 with the file when
the flag is off. A wrong-audience caller never reads bytes. A tombstoned
course 404s for everyone, even the owner at the document seam. Owner reads of
drafts stay 200.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; pnpm test tests/publishing/read-gate.test.ts && echo GATE_OK` expects `GATE_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/publishing/read-gate.pg.test.ts && echo GATE_PG_OK` expects `GATE_PG_OK`
- adversarial: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED MINIMAL_MODE NEXT_PUBLIC_MINIMAL_MODE; test -n "$PG_CONTRACT_URL" && pnpm test tests/publishing/no-leak.pg.test.ts && echo NO_LEAK_OK` expects `NO_LEAK_OK`
- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`

Risk tier: 4. The adversarial gate drives the real route handlers with real
seeded sessions and never mocks the gate seam. It asserts only the allowed
status pairs, so any future loosening fails loudly. The suite toggles
`MINIMAL_MODE` in-process because the gate prefix clears it, so the no-row
probe covers the flag-on deny and the flag-off parity 200.

## Implementation Decisions

- Publish state lives on `stage_meta`, the same table the existing publish
  seams already use. The document row lives in the publishable
  `@openmaic/storage` package (`packages/@openmaic/storage/src/document/pg.ts`),
  and the program forbids package changes
  (`docs/meta-specs/rbac-minimal-mode.md:216-221`). The precedent Q11 pins
  tenant metadata app-side with the lazy ensure pattern, and `stage_meta` is
  that home today.
- The columns are `status TEXT NOT NULL DEFAULT 'draft'` and
  `audience INTEGER NOT NULL DEFAULT 3`, added through the existing
  `ADD COLUMN IF NOT EXISTS` statements in `STAGE_META_SCHEMA`. The column
  default for audience is 3, the creator rank, so any future publish path that
  writes `status` without an audience fails closed. The picker default is 0,
  everyone, per the batch D decision recorded in Further Notes, and the
  publish handler always writes the chosen audience explicitly.
- The backfill is one guarded statement: `UPDATE stage_meta SET status =
  'published', audience = 0 WHERE is_public = true AND status = 'draft'`. The
  `status = 'draft'` guard makes reruns no-ops and prevents the migration from
  clobbering a course published by new code with a deliberate audience.
  `ensureStageMetaSchema` splits the schema text on `;` and executes in order
  (`lib/persistence/stage-meta.ts:50-55`), so the appended `UPDATE` must stay
  after the two new `ALTER` statements or the first boot of an existing
  database fails.
- A new partial index serves the gallery:
  `stage_meta_published_audience_idx ON stage_meta (audience, published_at
  DESC) WHERE status = 'published' AND deleted_at IS NULL`. The legacy
  `stage_meta_public_live_idx` partial index on `is_public` is kept, because
  dropping it from the lazy ensure string is needless churn and the mirror
  column keeps it truthful.
- `is_public` and `published_at` stay as mirror columns. `setStageVisibility`
  writes `status` and `audience` as the source of truth and keeps the mirrors
  in agreement, so the status route wire contract that names `isPublic` and
  `publishedAt` (`app/api/stages/[id]/status/route.ts:35`) keeps working for
  code batch D does not touch.
- The audience model is integer role rank, never role names, per Q12
  (`docs/meta-specs/rbac-minimal-mode.md:169`). `AUDIENCE_RANK` exposes the
  three pickable tiers. The gate compares `viewerRank >= audience`, so a rank
  rename in the roles table never touches course rows.
- The viewer rank resolves once per request through `resolveViewerRank`.
  Anonymous owners and unknown users map to 0. A `user:` owner maps to the
  rank join that `requirePermission` already uses
  (`lib/auth/permissions-server.ts:43-47`).
- The read gate lives in `decideDocumentAccess` because the persistence seam
  funnels every document read through it (`app/api/persistence/[...path]/route.ts:288-301`).
  The new `viewerRank` parameter defaults to 0, so existing callers that do not
  pass it get the most restrictive behavior. The owner branch keeps drafts
  readable and writable by their owner. The audience rule returns `not-found`,
  never `forbid`, for unpublished and wrong-audience courses, preserving the
  no-existence-oracle posture (Q7 at `docs/meta-specs/rbac-minimal-mode.md:164`).
- The stage-meta sidecar adopts the same rule. A draft answered 404 instead of
  `{ isPublic: false, isOwner: false }`, which removes the draft existence
  oracle. The classroom page already treats an absent sidecar as
  non-owner-signal and keeps its fallback (`app/classroom/[id]/page.tsx:94-104`).
- The classroom GET gate applies to every course. When the id resolves through
  stage meta, the audience rule runs as on the other seams. When no
  `stage_meta` row exists, the gate creates nothing and answers 404 under
  `MINIMAL_MODE`, because a course with no metadata row has no owner and no
  audience and cannot be proven public. Flag-off keeps today's file serving
  exact, which is the parity rule from Q4
  (`docs/meta-specs/rbac-minimal-mode.md:161`). The developer-local-artifact
  carve-out is removed.
- The generation pipeline claims the `stage_meta` row at classroom-creation
  time. `generateClassroom` persists the JSON at
  `lib/server/classroom-generation.ts:711-718`, then claims the row through
  `claimStageMeta` (`lib/persistence/stage-meta.ts:103-124`) with the creating
  owner, so the row carries the owner and the column defaults `status 'draft'`
  and `audience 3`. The create route is gated `course.create`
  (`app/api/generate-classroom/route.ts:17`), so the creator session exists at
  job creation, and the owner id threads through `runClassroomGenerationJob`
  (`lib/server/classroom-job-runner.ts:13-32`) into the pipeline. Raw
  `POST /api/classroom` writes still have no session and no owner and stay
  JSON-only; under the flag they answer 404, and flag-off parity keeps them
  servable as today.
- The publish route swaps the dead 401 for the batch B guard. It calls
  `requirePermission(headers, 'course.publish')` first, which throws the typed
  403 for anonymous, guest, and learner callers. The guard call sits in the
  nested Response-rethrow catch, the quiz-grade pattern
  (`app/api/quiz-grade/route.ts:43-46`): the inner catch returns the thrown
  `Response` unchanged, so the typed 403 survives the route's outer catch and
  the `withRequestOwnerId` callback catch
  (`lib/server/agent-runtime/with-owner.ts:40-45`), neither of which flattens
  to a 500. Then it resolves access, answers 404 for absent or tombstoned
  courses, and answers 403 for a foreign course unless the caller is rank 4.
  The unpublish route mirrors this shape.
  This is how batch A sessions make publish actually work for creators: the
  `anon:` branch at `app/api/stages/[id]/publish/route.ts:26-31` is removed,
  and signed-in owners pass through `withRequestOwnerId`
  (`lib/server/agent-runtime/with-owner.ts:29-34`).
- The publish route reads an optional `audience` from the body, validates it
  against `AUDIENCE_RANK`, and defaults to 0 when absent. Publish stays
  idempotent: a republish returns the current row without rewriting
  `published_at`.
- The audience picker is always available, in every mode. MINIMAL_MODE changes
  spend-route guards and the home layout, not publishing semantics. Publishing
  a durable public artifact is identity-gated through `course.publish` in both
  modes, and batch D does not assume minimal mode at all
  (`docs/meta-specs/rbac-minimal-mode.md:265`). A single UI path with a single
  default avoids a second mode-specific picker surface.
- The gallery is a server component. `listGalleryCourses` runs one parameterized
  query with `audience <= viewerRank`, and the page renders cards with name,
  published date, and a link to `/classroom/[id]`. Cover thumbnails are
  deferred because they would require a document read per course. The response
  never includes `owner_id`, matching the sidecar's no-owner-identity rule
  (`app/api/stage-meta/[stageId]/route.ts:19-23`).
- New i18n keys ship in `en-US.json` as the source of truth under a
  `publishing` group: `publishing.publish`, `publishing.unpublish`,
  `publishing.publishedBadge`, `publishing.draftBadge`, `publishing.audience`,
  `publishing.audienceEveryone`, `publishing.audienceGuests`,
  `publishing.audienceLearners`, `publishing.audienceHint`,
  `publishing.publishFailed`, `publishing.unpublishFailed`,
  `publishing.unpublishConfirm`, `publishing.galleryTitle`,
  `publishing.galleryEmpty`. All keys get 12-locale parity.
- New identifiers avoid the substrings "token" and "plan". `audience`,
  `status`, and `publishing` ship clean per the provider neutrality guard.
- The status reader surfaces `audience` to the client. The stage-meta response
  and its client shape (`lib/classroom/stage-meta-client.ts:21`) gain
  `status` and `audience` so the owner sees the current audience in the dialog.
- No rate limiting, no quotas, and no analytics attach to the gallery or the
  read gate.

## Testing Decisions

- New suites live under `tests/publishing/`. Root vitest picks up
  `tests/**/*.test.ts` and `.env.local` is not loaded, per the established
  hermetic setup.
- The env-clear prefix is the 015 canonical list copied verbatim, including
  the two batch C variables. Batch D adds no variables.
- The PIN-FROM-OUTLINE rule is the hard lesson of batches A, B, G, and C. Pin
  signatures after the code exists or from machine-extracted text, never from
  prose. New symbols above pin the intended declaration text. After
  implementation the builder replaces every pinned string with the byte-exact
  outline text. Multi-line signatures move to code-block bindings.
- The live-wire-proof rule drives the real route stack. The publish and read
  gates seed real better-auth users, sessions, and role rows in a scratch
  database. `requirePermission`, `getSession`, `decideDocumentAccess`, and
  `resolveViewerRank` are never mocked.
- The hermetic unit suites mock `getSession`. With no database the real
  `getSession` falls back to the anonymous owner
  (`tests/agent-runtime/stage-meta-routes.test.ts:1-56`), so every guard call
  would become the anonymous 403. The `publish-routes.test.ts` fixture mocks a
  creator session for its success paths, and only the pg gates leave
  `getSession` real.
- The pg contract suites provision their own scratch database per the app-side
  precedent (`tests/agent-runtime/event-notify.pg.test.ts:58-72`) and fail
  closed without `PG_CONTRACT_URL`, which is intended for tier-3 and tier-4
  gates.
- The adversarial suite runs the cross-tab table inside one database. It
  creates courses in every state, seeds one caller per role class, and drives
  each seam with real request objects. Forbidden pairs must answer 404, never
  403, so the response body is part of the assertion.
- Existing tests that pin the retiring contract are updated in this batch.
  The `login_required` publish test
  (`tests/agent-runtime/stage-meta-routes.test.ts:195-203`) becomes the typed
  403 assertion, and the persistence route gate mocks gain `status` and
  `audience` fields (`tests/agent-runtime/persistence-routes-gate.test.ts:427-428`).
- The i18n parity check runs where copy lands. New keys get 12-locale parity.
- Plan-time state: the `tests/publishing/*` suites do not exist yet and fail
  with no marker until they do. These are the documented
  deliverable-dependent failures.
- The legacy `setStagePublished` symbol retires with the route rewrite. The
  batch removes the export only if no remaining caller exists, otherwise keeps
  it as a thin delegator to `setStageVisibility`.

## Out of Scope

- Per-user draft share lists (deferred by Q7 at
  `docs/meta-specs/rbac-minimal-mode.md:277`).
- Media byte gating on `/api/classroom-media`. This is the second deferral of
  the byte seam. Batch C deferred the course-open audience rule for the byte
  server (`docs/specs/016-minimal-mode-gating.md:393`), and this batch closes
  the document content seams only. The byte server keeps serving with zero
  auth and `Cache-Control: public, max-age=86400, immutable` for any classroom
  id, unpublish never removes the files, and draft-stage media stays readable
  by anyone holding the path. That exposure is accepted until batch E. The
  register amendment for the second deferral lands at closure, matching the
  closure-task pattern batch 016 used for its quota-table note
  (`docs/specs/016-minimal-mode-gating.md:512-515`). The meta-spec gallery
  acceptance criterion (`docs/meta-specs/rbac-minimal-mode.md:315-316`) is not
  met for the byte seam while this deferral stands.
- Gallery cover thumbnails, search, pagination, categories, and featured rows.
- Public vanity URLs. The share URL stays `/classroom/[id]`.
- Custom audience tiers such as groups or rooms beyond the three rank tiers.
- Rating, commenting, and analytics on the gallery.
- Dropping the legacy `is_public` column. It stays as a mirror.
- A dedicated classroom not-found page. The classroom keeps its current empty
  and retry behavior when a document does not load.
- Any new quota or rate limit on reads.

## Further Notes

- The program record is `docs/meta-specs/rbac-minimal-mode.md`. Batch D depends
  on A and B and may assume owner ids, the roles table with ranks, `can()`,
  `requirePermission`, and the session helper. It does not assume minimal
  mode.
- The `login_required` 401 contract predates batch A. This batch retires it.
  The decision register already records the new behavior at Q7.
- The classroom seam review blocker is closed. A file-backed classroom with
  no stage meta row answers 404 under the flag and keeps today's parity
  behavior only when the flag is off. New generated courses carry rows at
  creation, so the batch's draft-non-leak promise holds on the classroom seam.
  This reuses the certified `MINIMAL_MODE` flag and adds no new env var; batch
  D still does not assume minimal mode.
- The audience picker default of 0 (everyone) is an approved batch D
  decision. The register's Q7 (`docs/meta-specs/rbac-minimal-mode.md:164`) and
  the round-1 record pin the audience choice at publish time but name no
  default. This spec records the default here and amends the register at
  closure.
- The gallery links to `/classroom/[id]`. A visitor whose rank changes after
  the page loads sees the existing classroom empty state, because the document
  seam answers 404. This is accepted and not a regression.
- The visual-preview checkpoint runs before implementation. The publish dialog
  and the gallery render in localhost and are approved in Safari first, per
  the program process rules.
- Batch D holds no new operator env var. `.env.example` is untouched.
- Commit convention for this batch: `feat(rbac): ...`.## Research Update (2026-09-06)

Batch D shipped in five slice commits: `4c3899c2`, `c8c4d694`, `d708bf62`,
`7326faeb`, and `76502afb`. Round 1 rejected S2 through S5 at `bd0531b8`. The
fix round landed in `dbdf745e`. Round 2 verified S2, S4, and S5 and rejected
S3 at `ef6849ce`. The second fix round landed in `682063aa`. Round 3 verified
all five slices at `6c944bf4`, chain 88. This section records what shipped,
what deviated from the plan, and what the next batches inherit.

### What shipped

- The `status` and `audience` columns land in `STAGE_META_SCHEMA` at
  `lib/persistence/stage-meta.ts:44-48`. The guarded backfill sits at `:50`.
  The gallery partial index sits at `:57-58`. `StageMetaRow` carries the new
  fields at `:8-11`. `setStageVisibility` at `:171-184` writes status and
  audience and keeps `is_public` and `published_at` in agreement.
  `readStageMeta` at `:74-108` derives `isPublic` from status.
- `AUDIENCE_RANK` freezes the three pickable tiers at
  `lib/persistence/audience.ts:14-18`. `resolveViewerRank` at `:31-46` returns
  0 for `anon:` and unknown owners and runs the role rank join for `user:`
  owners. It strips the prefix before the join at `:36-38`.
- `decideDocumentAccess` extends the read case at
  `lib/persistence/document-access.ts:71-82`. Tombstoned rows answer 404.
  Owners always pass. Everyone else needs `status published` and
  `viewerRank >= audience`, else `not-found`.
- The persistence route resolves the viewer rank once at
  `app/api/persistence/[...path]/route.ts:292` and passes it into the gate at
  `:302`.
- The stage-meta sidecar denies drafts and wrong-audience courses at
  `app/api/stage-meta/[stageId]/route.ts:58-74`. Owners keep the 200.
- The classroom GET answers 404 for ids with no row under `MINIMAL_MODE` at
  `app/api/classroom/route.ts:87-92`. Flag-off keeps today's file serving at
  `:93-99`. The audience rule runs only under the flag at `:101-114`.
- The generation pipeline claims the row for the creating owner right after
  persist at `lib/server/classroom-generation.ts:725-737`, so generated
  courses carry owner, draft status, and audience 3.
- The publish route enforces the typed 403 inside the Response-rethrow catch
  at `app/api/stages/[id]/publish/route.ts:35-40`. It normalizes both id
  sides at `:48-52`, lets rank 4 publish any course at `:53-63`, parses the
  body audience with default 0 at `:65-75`, and republishes idempotently at
  `:77-83`. The unpublish route mirrors the shape at
  `app/api/stages/[id]/unpublish/route.ts:34-39` and keeps the stored
  audience at `:64-67`.
- `PublishDialog` at `components/publishing/publish-dialog.tsx:36` ships the
  audience picker at `:83-102`. HomePage mounts it at `app/page.tsx:1275-1282`
  and wires the card affordance at `:1741-1753`.
- `listGalleryCourses` at `lib/persistence/gallery.ts:21-50` lists published
  non-deleted rows with `audience <= viewerRank`, ordered by `published_at`
  descending, with no tenancy fields. `app/gallery/page.tsx:18-52` renders
  the cards. The home entry link sits at `app/page.tsx:1073-1081`, before the
  import button, visible to every rank.
- The no-leak suite at `tests/publishing/no-leak.pg.test.ts` drives the three
  real route handlers across five course states and six role classes, 29
  tests. The 12-locale `publishing` group lands at
  `lib/i18n/locales/en-US.json:2134-2150`.

### Deviations and surprises

(a) Round 1's live wire caught the id mismatch. `resolveViewerRank` joins
`user_roles.user_id`, which stores raw ids, while the routes passed the
prefixed owner. Every real session resolved to rank 0. The fixtures masked
the defect, so the gate stayed green. The docstring at
`lib/persistence/audience.ts:20-29` records the mismatch.

(b) The fix round inverted the id space. It compared raw ids and seeded raw
`stage_meta.owner_id` fixture rows, so a production owner could not publish.
Round 2 caught the regression. The final rule normalizes both sides at
`app/api/stages/[id]/publish/route.ts:48-52`, and the pg suites seed
production bytes, `user:<raw>`, at
`tests/publishing/publish-live-wire.pg.test.ts:292-309`.

(c) The classroom audience rule started ungated by the flag and broke
flag-off parity. The shipped code applies it only under `MINIMAL_MODE` at
`app/api/classroom/route.ts:101-114`.

(d) Two S3 gate suites were tautological. They asserted route behavior
without driving the routes. Both were rewritten to call the real POST
handlers with a module-level auth mock at
`tests/publishing/publish-routes.test.ts:12-74` and
`tests/publishing/publish-live-wire.pg.test.ts:30-37`. The mock reimplements
the rank check against the scratch database. Round 3 judged the seam honesty
HONEST.

(e) Story 6, the admin publish-any override, was silently unimplemented until
rejection round 1. The shipped admin branch sits at
`app/api/stages/[id]/publish/route.ts:53-63`.

(f) The `generateClassroom` row claim was added mid-S2 to close spec B2. It
ships at `lib/server/classroom-generation.ts:725-737`.

(g) The rivr diff still shows four cosmetic deviations. Prettier wraps two
rows. Capture artifacts cover one JSON symbol and one test-file symbol. No
semantic drift.

(h) Eight of the fifteen publishing keys ship without a consumer:
`publishedBadge`, `draftBadge`, `audienceEveryone`, `audienceGuests`,
`audienceLearners`, `unpublishFailed`, `unpublishConfirm`, and
`galleryEmpty`. The picker labels are hardcoded English at
`components/publishing/publish-dialog.tsx:18-22`. The gallery page hardcodes
its heading and empty state at `app/gallery/page.tsx:28` and `:32`. The
dialog takes no refresh callback, so the library list changes only after a
reload.

### Test results

All 15 gates passed green at round 3. The final table is 15 of 15: S1 2, S2
3, S3 3, S4 3, S5 4. The full suite ran 7766 tests with 1 tolerated failure. Resolution: batch 020 S1 closed this failure (hermetic web-search mock in runner-skills-registration.test.ts).
The production build exits 0. Safari shots 21-24 are console-clean. The wire
matrix: learner 200 on all three seams, owner 200, foreign creator 403, admin
200, and flag-off parity in both sub-cases.

### Follow-on notes

- The media-bytes seam now stands with a second deferral, formally owed to
  batch E. The Out of Scope text names the exposure at
  `docs/specs/017-publishing-visibility.md:465-476`. The register amendment
  for the second deferral lands at closure.
- The cold-auth-bootstrap transient needs a follow-up probe. The first PUT
  after boot wrote `anon:` as the owner on a real session. Batch E touches
  session boot and should carry the probe.
- The gallery entry link is visible to every rank. That is the approved
  decision, and it ships at `app/page.tsx:1073-1081`.
## Certification Report

Certified: 2026-09-06T08:29:44.545Z
Signature: 8c4bfd96aff12be214a070754f824d8347493d2cba0371982ad102cb066b58ca

### Summary

Slices: 5
Symbols: 23
Gates: 15

### Implemented Symbols

- **S1** (Schema, migration, and visibility writer):
  - lib/persistence/stage-meta.ts::STAGE_META_SCHEMA
  - lib/persistence/stage-meta.ts::StageMetaRow
  - lib/persistence/stage-meta.ts::readStageMeta
  - lib/persistence/stage-meta.ts::setStageVisibility
  - lib/server/stage-access.ts::StageAccess
  - lib/server/stage-access.ts::readStageAccessIncludingDeleted
- **S2** (Audience-enforced read gate):
  - lib/persistence/audience.ts::AUDIENCE_RANK
  - lib/persistence/audience.ts::resolveViewerRank
  - lib/persistence/document-access.ts::decideDocumentAccess
  - app/api/persistence/[...path]/route.ts::handlePersistenceRequest
  - app/api/stage-meta/[stageId]/route.ts::GET
  - app/api/classroom/route.ts::GET
  - lib/server/classroom-generation.ts::generateClassroom
- **S3** (Publish flow, audience picker, and i18n):
  - app/api/stages/[id]/publish/route.ts::POST
  - app/api/stages/[id]/unpublish/route.ts::POST
  - components/publishing/publish-dialog.tsx::PublishDialog
  - app/page.tsx::HomePage
  - app/page.tsx::ClassroomCard
  - lib/i18n/locales/en-US.json::en-US.json
- **S4** (Public gallery page):
  - lib/persistence/gallery.ts::listGalleryCourses
  - app/gallery/page.tsx::GalleryPage
  - app/page.tsx::HomePage
- **S5** (No-leak adversarial proof):
  - tests/publishing/no-leak.pg.test.ts::no-leak.pg.test.ts

### Gates Passed

- **S1**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/visibility-columns.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/publishing/visibility-columns.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 2\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 17:54:12\n\u001b[2m   Duration \u001b[22m 309ms\u001b[2m (transform 149ms, setup 12ms, import 174ms, tests 2ms, environment 0ms)\u001b[22m\n\nCOLUMNS_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S2**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/read-gate.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/publishing/read-gate.test.ts \u001b[2m(\u001b[22m\u001b[2m13 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 4\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m13 passed\u001b[39m\u001b[22m\u001b[90m (13)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:24:59\n\u001b[2m   Duration \u001b[22m 103ms\u001b[2m (transform 22ms, setup 14ms, import 17ms, tests 4ms, environment 0ms)\u001b[22m\n\nGATE_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/read-gate.pg.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/publishing/read-gate.pg.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 157\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:25:00\n\u001b[2m   Duration \u001b[22m 390ms\u001b[2m (transform 130ms, setup 15ms, import 156ms, tests 157ms, environment 0ms)\u001b[22m\n\nGATE_PG_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S3**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/publish-routes.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-routes.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-routes\u001b[2m > \u001b[22m\u001b[2mPOST /api/stages/[id]/publish\u001b[2m > \u001b[22m\u001b[2mcreator publishes own course with default audience 0\n\u001b[22m\u001b[39mStage published { stageId: \u001b[32m'stage-1'\u001b[39m, ownerId: \u001b[32m'user:creator-user'\u001b[39m, audience: \u001b[33m0\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-routes.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-routes\u001b[2m > \u001b[22m\u001b[2mPOST /api/stages/[id]/publish\u001b[2m > \u001b[22m\u001b[2mcreator publishes own course with explicit audience\n\u001b[22m\u001b[39mStage published { stageId: \u001b[32m'stage-1'\u001b[39m, ownerId: \u001b[32m'user:creator-user'\u001b[39m, audience: \u001b[33m2\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-routes.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-routes\u001b[2m > \u001b[22m\u001b[2mPOST /api/stages/[id]/publish\u001b[2m > \u001b[22m\u001b[2madmin publishes foreign course\n\u001b[22m\u001b[39mStage published { stageId: \u001b[32m'stage-foreign'\u001b[39m, ownerId: \u001b[32m'user:admin-user'\u001b[39m, audience: \u001b[33m0\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-routes.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-routes\u001b[2m > \u001b[22m\u001b[2mPOST /api/stages/[id]/publish\u001b[2m > \u001b[22m\u001b[2maudience outside 0-2 defaults to 0\n\u001b[22m\u001b[39mStage published { stageId: \u001b[32m'stage-1'\u001b[39m, ownerId: \u001b[32m'user:creator-user'\u001b[39m, audience: \u001b[33m0\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-routes.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-routes\u001b[2m > \u001b[22m\u001b[2mPOST /api/stages/[id]/unpublish\u001b[2m > \u001b[22m\u001b[2munpublishes own course and keeps stored audience\n\u001b[22m\u001b[39mStage unpublished { stageId: \u001b[32m'stage-1'\u001b[39m, ownerId: \u001b[32m'user:creator-user'\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-routes.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-routes\u001b[2m > \u001b[22m\u001b[2mPOST /api/stages/[id]/unpublish\u001b[2m > \u001b[22m\u001b[2madmin unpublishes foreign course\n\u001b[22m\u001b[39mStage unpublished { stageId: \u001b[32m'stage-foreign'\u001b[39m, ownerId: \u001b[32m'user:admin-user'\u001b[39m }\n\n \u001b[32m✓\u001b[39m tests/publishing/publish-routes.test.ts \u001b[2m(\u001b[22m\u001b[2m14 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 10\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m14 passed\u001b[39m\u001b[22m\u001b[90m (14)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:51:01\n\u001b[2m   Duration \u001b[22m 153ms\u001b[2m (transform 39ms, setup 14ms, import 62ms, tests 10ms, environment 0ms)\u001b[22m\n\nPUBLISH_ROUTES_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/publish-live-wire.pg.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-live-wire.pg.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-live-wire\u001b[2m > \u001b[22m\u001b[2mpublish route\u001b[2m > \u001b[22m\u001b[2mcreator publishes own course with audience 0\n\u001b[22m\u001b[39mStage published { stageId: \u001b[32m'pw-creator-own'\u001b[39m, ownerId: \u001b[32m'user:creator-raw'\u001b[39m, audience: \u001b[33m0\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-live-wire.pg.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-live-wire\u001b[2m > \u001b[22m\u001b[2mpublish route\u001b[2m > \u001b[22m\u001b[2mcreator publishes own course with learner audience\n\u001b[22m\u001b[39mStage published {\n  stageId: \u001b[32m'pw-creator-learner'\u001b[39m,\n  ownerId: \u001b[32m'user:creator-raw'\u001b[39m,\n  audience: \u001b[33m2\u001b[39m\n}\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-live-wire.pg.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-live-wire\u001b[2m > \u001b[22m\u001b[2mpublish route\u001b[2m > \u001b[22m\u001b[2madmin publishes foreign course\n\u001b[22m\u001b[39mStage published { stageId: \u001b[32m'pw-admin-foreign'\u001b[39m, ownerId: \u001b[32m'user:admin-raw'\u001b[39m, audience: \u001b[33m0\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-live-wire.pg.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-live-wire\u001b[2m > \u001b[22m\u001b[2mpublish route\u001b[2m > \u001b[22m\u001b[2mdefaults audience to 0 when not provided\n\u001b[22m\u001b[39mStage published {\n  stageId: \u001b[32m'pw-default-audience'\u001b[39m,\n  ownerId: \u001b[32m'user:creator-raw'\u001b[39m,\n  audience: \u001b[33m0\u001b[39m\n}\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-live-wire.pg.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-live-wire\u001b[2m > \u001b[22m\u001b[2munpublish route\u001b[2m > \u001b[22m\u001b[2munpublishes own course\n\u001b[22m\u001b[39mStage unpublished { stageId: \u001b[32m'pw-unpub-own'\u001b[39m, ownerId: \u001b[32m'user:creator-raw'\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-live-wire.pg.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-live-wire\u001b[2m > \u001b[22m\u001b[2munpublish route\u001b[2m > \u001b[22m\u001b[2madmin unpublishes foreign course\n\u001b[22m\u001b[39mStage unpublished { stageId: \u001b[32m'pw-unpub-admin'\u001b[39m, ownerId: \u001b[32m'user:admin-raw'\u001b[39m }\n\n\u001b[90mstdout\u001b[2m | tests/publishing/publish-live-wire.pg.test.ts\u001b[2m > \u001b[22m\u001b[2mpublish-live-wire\u001b[2m > \u001b[22m\u001b[2munpublish route\u001b[2m > \u001b[22m\u001b[2munpublished course is draft after unpublish\n\u001b[22m\u001b[39mStage unpublished { stageId: \u001b[32m'pw-unpub-draft'\u001b[39m, ownerId: \u001b[32m'user:creator-raw'\u001b[39m }\n\n \u001b[32m✓\u001b[39m tests/publishing/publish-live-wire.pg.test.ts \u001b[2m(\u001b[22m\u001b[2m11 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 340\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m11 passed\u001b[39m\u001b[22m\u001b[90m (11)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:51:06\n\u001b[2m   Duration \u001b[22m 695ms\u001b[2m (transform 209ms, setup 15ms, import 275ms, tests 340ms, environment 0ms)\u001b[22m\n\nPUBLISH_LIVE_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 check:i18n-keys /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> node scripts/check-i18n-keys.mjs\n\ni18n key alignment check passed (12 locale files, source: en-US.json).\nI18N_OK\n","passed":true}
- **S4**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/gallery-list.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/publishing/gallery-list.test.ts \u001b[2m(\u001b[22m\u001b[2m5 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 3\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m5 passed\u001b[39m\u001b[22m\u001b[90m (5)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:25:11\n\u001b[2m   Duration \u001b[22m 89ms\u001b[2m (transform 19ms, setup 15ms, import 10ms, tests 3ms, environment 0ms)\u001b[22m\n\nGALLERY_LIST_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/gallery.pg.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/publishing/gallery.pg.test.ts \u001b[2m(\u001b[22m\u001b[2m4 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 159\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m\u001b[90m (4)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:25:12\n\u001b[2m   Duration \u001b[22m 262ms\u001b[2m (transform 26ms, setup 15ms, import 25ms, tests 159ms, environment 0ms)\u001b[22m\n\nGALLERY_PG_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}
- **S5**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/read-gate.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/publishing/read-gate.test.ts \u001b[2m(\u001b[22m\u001b[2m13 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 3\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m13 passed\u001b[39m\u001b[22m\u001b[90m (13)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:25:23\n\u001b[2m   Duration \u001b[22m 96ms\u001b[2m (transform 23ms, setup 15ms, import 17ms, tests 3ms, environment 0ms)\u001b[22m\n\nGATE_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/read-gate.pg.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/publishing/read-gate.pg.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 148\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:25:24\n\u001b[2m   Duration \u001b[22m 378ms\u001b[2m (transform 127ms, setup 14ms, import 154ms, tests 148ms, environment 0ms)\u001b[22m\n\nGATE_PG_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/publishing/no-leak.pg.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/publishing/no-leak.pg.test.ts \u001b[2m(\u001b[22m\u001b[2m29 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 667\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m29 passed\u001b[39m\u001b[22m\u001b[90m (29)\u001b[39m\n\u001b[2m   Start at \u001b[22m 19:25:24\n\u001b[2m   Duration \u001b[22m 805ms\u001b[2m (transform 246ms, setup 13ms, import 64ms, tests 667ms, environment 0ms)\u001b[22m\n\nNO_LEAK_OK\n","passed":true}
  - g4: {"id":"g4","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"2591ae5613b4b6fe445f087b2624f3ad79e1c467799d8eeb6d559fa5b293011a","pathCount":30,"output":"TSC_OK\n","passed":true}

Certification hash: 8c4bfd96aff12be214a070754f824d8347493d2cba0371982ad102cb066b58ca
Certified: 2026-09-06T08:29:44.545Z | Signature: 8c4bfd96aff12be214a070754f824d8347493d2cba0371982ad102cb066b58ca | Certifier: verifier
