# Batch 015 spec soundness review

Reviewer: independent spec-soundness reviewer (fresh eyes for 015; previously
reviewed batches 013 and 014 through two passes each). The reviewer did not
write the spec. Probes and gate dry-runs ran on 2026-09-05 against the working
tree.

Reviewed documents:

- `docs/specs/015-permission-core.md` (draft, batch B)
- Inherited surfaces in the tree: `lib/auth/*` (batch A implementation
  present), `tests/branding/client-import-graph.test.ts` and the amended
  `docs/specs/014-branding-header.md` (batch G), and
  `docs/meta-specs/rbac-minimal-mode.md` (Q8 register, dependency table).
- `app/api/quiz-grade/route.ts`, `components/account-zone.tsx`,
  `app/api/auth/[...path]/route.ts`, `tests/providers/provider-neutrality-guard.test.ts`,
  `tests/setup-env.ts`, `vitest.config.ts`.

Method: symbol/citation audit against the actual batch A and batch G code
(present in this tree, so cites were checked against implementation, not
prose), gate dry-runs for the full inventory, tier re-count from file text,
ledger-ability mapping against the rivr v2 rules, constraint scans, catalog
vs matrix consistency, and risk-honesty review. No code changed. Only this
file was created.

## Verdict

**Approve.** No blockers. Four concerns, each a one-sentence explicitness or
completeness fix that does not stall the build or false-fail a gate. The
spec's inherited-surface cites all resolve exactly against the implemented
batch A and G artifacts, and every gate behaves as documented.

## BLOCKERS

None. All tier minimums are met, all 13 gates dry-run correctly, all cited
symbols resolve against the tree, and the catalog/matrix mapping is
internally consistent with its documented deltas.

## CONCERNS

### C1. The `requirePermission` re-export through the public surface is delivered but not bound.

S3 delivers `lib/auth/permissions-server.ts::requirePermission`
"re-exported through the public surface" (`015:136-138,144`), which modifies
`lib/auth/index.ts` (a batch A deliverable) by adding a
`requirePermission` export. That modification is not a ledger binding row and
is not named gate-bound. Risk is low because the quiz-grade route will import
through the public surface, so `QUIZ_GATE_OK` fails to compile if the
re-export is missing. Suggested fix: add a binding row
`lib/auth/index.ts::requirePermission` (function, exists) or state in the S3
deliverables that the re-export is gate-bound by `QUIZ_GATE_OK` through the
route import.

### C2. The catalog count and the Q8 register disagree (11 vs 7).

`015:202-205` defines 11 permissions. The meta-spec Q8 register still lists
the original seven (`meta-spec:165`); 015 documents its four deltas
explicitly (`015:206-210`), so the batch itself is not ambiguous, but the
program record and the batch disagree on the catalog. Suggested fix: amend
the Q8 register row with the 11-key catalog or a pointer to 015. Related
nit: 013's roles-table prose says only "a system flag" without naming the
column; 015 correctly cites `"isSystem"` because the implemented schema has
it at `lib/auth/schema.ts:74` — add the column name to 013's prose so future
readers of B do not need the code to see the contract.

### C3. The Settings entry's "soon" badge is unaddressed.

`components/account-zone.tsx:108` renders the Settings entry with an
`auth.common.soon` badge alongside `auth.account.settings` (badge text
"Soon"). 015 gates the entry by `settings.manage` but never says what happens
to the badge for a holder of that permission. Suggested fix: one sentence in
S4 — "the 'soon' badge is removed for users who hold `settings.manage`, or
kept until batch E ships the settings surface."

### C4. The quiz-grade allow-path fixture needs `resolveModelFromRequest` mocked too.

The seam test must mock `@/lib/ai/llm` (feasible: `callLLM` is imported at
the route head, `app/api/quiz-grade/route.ts:9`, and called at `:71`), and
the 403 path is provable without the LLM. But the allow path calls
`resolveModelFromRequest` before `callLLM` (`quiz-grade:47-51`), so the
fixture must mock `@/lib/server/resolve-model` as well, or the allow-path
assertion cannot resolve a model. Suggested fix: one sentence in the S3
integration-gate description — "the fixture mocks `@/lib/ai/llm` and
`@/lib/server/resolve-model` so the allow path resolves a stub model."

## VERIFIED-OK

- Inherited-surface cites, checked against the implemented batch A code in
  this tree (all exact): `lib/auth/schema.ts` has the roles table with
  `"isSystem" BOOLEAN NOT NULL DEFAULT false` at `:74` (015 cites `:74`), and
  the ensure chain ends at `:86` with the `user_roles_role_id_idx` index
  (015 cites `:86`); no `role_permissions` table exists anywhere, so S2's
  table is genuinely new. `lib/auth/roles.ts` has `ROLE_RANKS` at `:7`
  (exact), `SYSTEM_ROLES` at `:31-36` (exact), and reads `is_system` at
  `:108,112,120` (exact). `lib/auth/index.ts` exports `getSession` (`:41`),
  `requireSession` (`:70`), and `listRoles` (`:84`); no `requirePermission`
  exists yet. `lib/auth/permissions.ts` and `lib/auth/permissions-server.ts`
  do not exist — both new files.
- `components/account-zone.tsx` exists and renders the Settings entry at
  `:108` via `auth.account.settings` with no permission and no Admin entry
  anywhere (015's claims exact). The tree's `en-US.json` has
  `auth.account.settings` (`:2049`) and `auth.common.soon` (`:2054`), so the
  existing labels are already in the i18n namespace.
- ENV_CLEAR is byte-identical to the 013 canonical list (string compare),
  and the pg gate's fail-closed `test -n "$PG_CONTRACT_URL"` wrap matches
  the approved 013 pattern (`015:129`, behavior documented at `015:121-124`).
- The client-graph guard precedent is real: `tests/branding/client-import-graph.test.ts`
  exists and statically walks the hook import graph asserting no `node:`
  or server-package imports; the amended 014 names it as a gate-bound
  deliverable (`014:274,344,384,418`). 015's mirror path
  (`tests/permissions/client-import-graph.test.ts`) is structurally valid.
- Quiz-grade route shape supports the seam (`app/api/quiz-grade/route.ts`):
  `callLLM` imported at the head (`:9`), POST at `:28`, no session check
  today, `resolveModelFromRequest` at `:47-51`. The guard placed before the
  LLM call is implementable and the 403 path requires no model resolution.
- Gate dry-runs (exact commands; ENV_CLEAR prefix):

| Gate | Result | Marker |
| --- | --- | --- |
| S1-G1 `tests/permissions/permissions-core.test.ts` | exit 1 | none; plan-time (suite missing), documented (`015:281-283`) |
| S2-G2 pg (`test -n "$PG_CONTRACT_URL" && ... role-permissions.pg.test.ts`) | exit 1 | none; fail-closed (URL unset), documented (`015:123-124`) |
| S3-G2 `tests/permissions/quiz-grade-gate.test.ts` | exit 1 | none; plan-time, documented |
| S4-G3 `tests/permissions/client-import-graph.test.ts` | exit 1 | none; plan-time, documented |
| `npx tsc --noEmit && echo TSC_OK` | exit 0 | TSC_OK |
| `pnpm test tests/providers/provider-neutrality-guard.test.ts && echo NEUTRAL_OK` | exit 0 | NEUTRAL_OK |
| `pnpm check:i18n-keys && echo I18N_OK` | exit 0 | I18N_OK |

  The remaining six gates (`PERM_CORE_OK` duplicates, `ROLE_PERM_OK`,
  `REQPERM_OK`, `QUIZ_GATE_OK`, `PERMS_CLI_OK`, `PERMS_ROUTE_OK`) share the
  identical missing-suite mechanics verified above and are all in the
  documented plan-time class. No false-fail oracle. The three `TSC_OK` and
  `I18N_OK`/`NEUTRAL_OK` duplicates pass.
- Tier compliance from file text: S1 tier 2 with 3 gates (min 2); S2 tier 3
  with 3 gates and the `integration:` tag on `ROLE_PERM_PG_OK`; S3 tier 3
  with 3 gates and `integration:` on `QUIZ_GATE_OK`; S4 tier 3 with 4 gates
  and `integration:` on `PERMS_ROUTE_OK`. All meet or exceed the tier
  minimums with the required tags.
- Ledger-ability: all 11 target bindings carry `file::symbol` pairs
  (no bare-path rows), all capturable `.ts`/`.tsx`, planned signatures in
  the rivr v2 `(params): Return` / shape form, the PIN-FROM-OUTLINE rule is
  stated in Testing Decisions (`015:263-268`) with multi-line signatures
  moving to code-block bindings (`015:268`), markers are short literals,
  `Spec status: draft` present, slice titles one-line.
- Constraint collisions: the 11 catalog keys contain no "token"/"plan"
  segments and `lib/auth/permissions.ts` is not on `PROVIDER_NEUTRAL_FILES`;
  `NEUTRAL_OK` runs in S1. `/api/auth/permissions/route.ts` (static segment)
  correctly wins over the existing catch-all `app/api/auth/[...path]/route.ts`
  (the only file in `app/api/auth/`), per Next.js static-over-catch-all
  precedence; the route is "Not whitelisted" at the middleware (`015:242-243`),
  consistent with Q14 and the batch G lesson that locked deployments degrade
  to defaults (here, empty permissions). The hook is client-pure with a
  defaults-deny fetch; the new Admin entry copy rides `auth.*` with 12-locale
  parity stated (`015:245-246`). The quiz-grade change adds no `ai` import
  and keeps `callLLM`, so the LLM-entry guard is untouched; middleware.ts is
  not referenced by any slice.
- Catalog/matrix consistency: anonymous deny-all; guest `quiz.grade` only
  (batch C caps at 5/day); learner `classroom.chat`, `quiz.grade`, `tts.use`,
  `asr.use`; creator adds `course.create`, `course.edit`, `course.delete`,
  `course.publish`; admin all 11 — matching the matrix rows, with the four
  Q8 deltas documented (`015:206-210`). `course.publish` covers the publish
  route with ownership staying app-level (`015:293`). Batch B wires ONLY
  quiz-grade as the reference adoption; route-by-route gating is explicitly
  batch C (`015:287-288`); D/E/F boundaries are clean in Out of Scope
  (`015:289-291`).
- Risk honesty: the per-request cache tradeoff is stated ("an admin override
  applies on the next request"), the multi-instance staleness window is
  stated, and the global-cache rejection rationale is given (`015:225-229`).
  The resolver merge order is explicit: rank defaults, then `role_name`
  rows, granted true adds and granted false removes (`015:222-225`).

## Could not verify

- The exact fixture content of the unwritten `tests/permissions/*` suites;
  the QUIZ_GATE_OK allow-path model-resolution gap is concern C4.
- End-to-end rivr ledger operations on a 015 ledger (none exists; creating
  one would be a ledger write, outside this review's mandate).
- The batch A and G files in this tree are implementations written after
  their approvals and are not yet certified; 015's dependency assumptions
  were checked against their current text, which may still change before B's
  ledger build — the spec states those assumptions (`015:297-299`).