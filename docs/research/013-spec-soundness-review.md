# Batch 013 spec soundness review

Reviewer: independent spec-soundness reviewer (fresh eyes). The reviewer did
not write the spec or the meta-spec. The reviewer read the code and ran
read-only probes and gate dry-runs on 2026-09-04, against the working tree at
`d49eb044`.

Reviewed documents:

- `docs/meta-specs/rbac-minimal-mode.md` (draft)
- `docs/specs/013-rbac-auth-foundation.md` (draft)
- `docs/research/rbac-minimal-mode-decision-round-1.md` (record)
- Round-2 deltas as transcribed in the meta-spec decision register: integer
  role RANK audiences, smtp|resend mailer with console fallback, ACCESS_CODE
  independence with boot warning, visual-preview checkpoints for batches A and
  B, guest quota reset at UTC midnight.

Method: symbol-truth audit of every load-bearing claim, gate dry-runs in a
plain shell exactly as written, ledger-ability mapping against the live `rivr`
CLI (`/Users/franky/.local/bin/rivr`, schema v2) and its REFERENCE, a
constraint-collision scan against the repo guards, a capability-matrix /
rank-model consistency check, and a better-auth 1.7.2 API check against the
live official docs via context7 (the package is not installed, which the spec
itself declares). No code changed. No ledger written. Only this file was
created.

## Verdict

**Approve-after-fixes.** Three blockers must return to the spec author before
human approval: two tier-gate shortfalls (S04 and S05, the exact defect that
blocked batch 001), and ledger target bindings on files the rivr symbol router
cannot capture (`package.json`, `.env.example`, `en-US.json`). Six concerns
follow, several of them accuracy drift in file:line cites. No design-level
rejection: the seam, symbol, gate-mechanics, constraint, and API claims all
resolve to what the spec says they do.

## BLOCKERS

### B1. S04 declares tier 4 but ships only 2 of the required 4 gates.

- Spec: `docs/specs/013-rbac-auth-foundation.md` S04, lines 220-227. Risk tier
  4 declared; exactly two gates listed (claim-migration, claim-adversarial).
- Evidence: the rivr tier contract (REFERENCE.md `## Risk tiers and gate
  types`, mirrored by the ledger skill) requires tier 4 to carry **4 gates**
  with **at least one adversarial** tag. `rivr slice verify` enforces the tier
  after every gate passes and exits 3 listing the unmet requirements. Gate
  counts as written: S01 = 3 (tier 3, min 3, integration tagged), S02 = 2
  (tier 2, min 2), S03 = 3 (tier 3, min 3, integration tagged), S04 = 2
  (tier 4, min 4), S05 = 2 (tier 3, min 3).
- This is the defect that previously stalled a batch (per the review brief,
  the batch-001 blocker): the tier claim and the gate list disagree, so every
  S04 verify attempt fails closed at tier enforcement.
- Suggested fix (exact wording for the spec): add two more S04 gates. Minimum
  viable additions, both following the established marker pattern:
  - `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE; pnpm test tests/auth/claim-scheme.test.ts && echo CLAIM_SCHEME_OK` expects `CLAIM_SCHEME_OK` (proves the `user:<id>` scheme, owner-prefix non-overlap, and that non-anon owners are never rewritten)
  - `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE; pnpm test tests/lint-llm-entry-guard.test.ts && echo LLM_GUARD_OK` expects `LLM_GUARD_OK` (probe gate, keeps the auth code honest against the entry guard)

### B2. S05 declares tier 3 but ships only 2 gates, neither tagged integration.

- Spec: S05, lines 254-261. Risk tier 3; two gates listed, and neither line
  carries the `integration:` tag prefix that S01 (line 115) and S03 (line 183)
  use. The prose at line 260 calls the mailer test "the integration gate" but
  the gate list does not tag it.
- Evidence: tier 3 requires **3 gates** with **at least one integration** tag
  (REFERENCE.md tier table). `rivr slice gate add --type` accepts
  `smoke|unit|integration|adversarial`; the tag must be explicit on the gate,
  not in prose.
- Suggested fix (exact wording): re-tag the mailer gate and add one gate:
  - `integration: unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE MAIL_TRANSPORT AUTH_SECRET; pnpm test tests/auth/mailer.test.ts && echo MAILER_OK` expects `MAILER_OK`
  - `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE; pnpm test tests/auth/mailer-transports.test.ts && echo TRANSPORTS_OK` expects `TRANSPORTS_OK` (proves `MAIL_TRANSPORT=smtp` and `=resend` select nodemailer and the Resend SDK with the SMTP_*/RESEND_API_KEY env shape, without sending)

### B3. Ledger target bindings on `package.json`, `.env.example`, and `en-US.json` cannot be captured.

- Spec: S01 target list (line 94, `package.json`), S02 target list (line 133,
  `.env.example`), S03 target list (line 167, `lib/i18n/locales/en-US.json`),
  S05 target list (line 241, `.env.example`).
- Evidence: the rivr symbol router resolves captures by extension and supports
  only `.rs`, `.md`, `.markdown`, `.txt`, `.text`, `.ts`, `.tsx`, `.js`,
  `.jsx` (ledger skill SOURCES.md extension table). An unknown extension
  exits 1 and names the extension. `.json` and `.example` are not supported,
  so `rivr capture` cannot produce a before-block for these targets, and the
  research-to-implementation precondition requires every non-abandoned target
  symbol to carry a before block and a postcondition block (REFERENCE.md
  stage machine, `research -> implementation`). As written, the ledger build
  stalls at capture time.
- Suggested fix (exact wording): remove those three files from the target
  symbol lists and pin their states with gates instead, which the spec already
  does for `.env.example` via the S05 presence gate:
  - S01: replace the `package.json` target with a third-style gate:
    `node -e "const p=require('./package.json'); if(!p.dependencies?.['better-auth']) process.exit(1)" && echo PKG_OK` expects `PKG_OK`
  - S03: replace the `en-US.json` target with
    `node -e "const l=require('./lib/i18n/locales/en-US.json'); if(!l.auth) process.exit(1)" && echo I18N_NS_OK` expects `I18N_NS_OK`
  - S02: add `grep -q "ADMIN_EMAILS" .env.example && echo SEED_ENV_OK` expects `SEED_ENV_OK` (this also closes Concern C5).

## CONCERNS

### C1. The three direct call-site line cites are ~10 lines off (symbols are real).

- Spec S04 before-state notes (lines 207-210) and the meta-spec
  (`rbac-minimal-mode.md` lines 83-87) cite the direct `resolveRequestOwnerId`
  calls at `owner-events/route.ts:39`, `sessions/[id]/events/route.ts:62`, and
  `freshness/route.ts:46`. The actual call lines are `:49`, `:77`, and `:50`
  respectively (verified by reading each route; the cited lines are the `GET`
  handler declarations, not the resolver calls). The symbols resolve and the
  seam claim is true; the cites are drift. Fix: update the three cites to
  `:49`/`:77`/`:50`, or drop line numbers from the before-state notes.

### C2. The env-unset prefix is inconsistent across vitest gates.

- S01 gate 2 unsets `OPENMAIC_AGENT_RUNTIME_ENABLED`; S01 gate 3 and S03 gate
  2 do not. `tests/setup-env.ts:17` confirms shell-exported variables pass
  through to vitest unchanged, and route handlers gated by
  `isAgentRuntimeConfigured` return 404 (`feature-flags.ts:23-25`). If a
  parent shell exports the flag, the new session tests could behave
  differently than intended. Fix (or explicitly accept): use one uniform unset
  list on every vitest gate, including `OPENMAIC_AGENT_RUNTIME_ENABLED`, or
  state in Testing Decisions that every auth test mocks `feature-flags` so the
  flag cannot leak.

### C3. Postconditions are prose, not "(params): Return" signatures the ledger can bind.

- Every slice gives a postcondition "in words" (S01 lines 103-108, S02
  lines 140-144, and so on). The ledger's `rivr slice postcondition` takes
  `--after-kind` and `--after-signature` per target symbol, and the oracle
  signature binds the verdict to that exact slice state (REFERENCE.md oracle
  signature paragraph). The builder must invent signatures from prose, which
  is exactly where drift starts. Fix (small): add a one-line signature per new
  target symbol in the spec, e.g. `ensureAuthSchema(queryable: Queryable):
  Promise<void>`, `createAuthServer(): AuthServer`,
  `getSession(headers: Headers): Promise<Session | null>`,
  `requireSession(headers: Headers): Promise<Session>`,
  `claimAnonOwnership(anonId: string, userId: string): Promise<number>`.

### C4. Meta-spec cites for the version-bump gate's "ignored inputs" point at the wrong region, and the six-vs-five package note is stale repo prose.

- Meta-spec Global Constraints cite `scripts/check-package-version-bumps.mjs:20-30`
  for "ignored inputs". The actual ignored inputs are the
  `commonIgnoredInputs` block at `:8-11` (files `.gitignore`, `vitest.config.ts`;
  directories `docs/`, `test/`). Lines 20-30 hold the "KNOWN LIMITATION"
  comment, which itself says "five owned packages" while the gate iterates
  **six**. The authoritative package list is `OPENMAIC_PACKAGES` in
  `scripts/openmaic-packages.mjs:34` (`dsl, generation, storage, renderer,
  editor, importer`), which `assertPackageListIsComplete` cross-checks against
  disk and the publish workflow; the "five" wording at
  `check-package-version-bumps.mjs:13-14` is stale prose and does not affect
  the gate. The spec's substantive claim — the version-bump gate cannot fire
  for an app-side-only diff because it diffs only `packages/@openmaic/<name>`
  directories (`check-package-version-bumps.mjs:181-203`) — is correct. Fix:
  (a) in the meta-spec, cite `:8-11` for ignored inputs; (b) separately amend
  the script comment from "five" to "six" (repo cleanup, not part of batch A).

### C5. No gate pins the S02 `.env.example` deliverables.

- S02 ships `ADMIN_EMAILS` and the `server-roles.yml` default filename in
  `.env.example`, and the global constraint requires same-change documentation,
  but the only env-presence gate is S05's `MAIL_TRANSPORT` grep. Fix:
  add the `grep -q "ADMIN_EMAILS"` gate named in Blocker B3, and consider
  grepping all nine new variable names once in S05.

### C6. The claim-migration "same device" mechanism is implied, not specified.

- S04 postcondition (lines 214-218) requires that only rows owned by the
  signing-in device's `anon:<uuid>` are claimed and that "a sign-in on a
  different device claims nothing", but the spec never states where the
  device's anonymous id comes from. The only workable source is the
  `anonymous_id` cookie on the claim request (`owner.ts:3`,
  `ANONYMOUS_COOKIE`). Fix (one sentence in S04): "The claim reads the
  `anonymous_id` cookie from the first verified-sign-in request; that value is
  the only `anon:` id the migration rewrites for the user."

## Verified-OK list

Gate dry-runs (commands run exactly as written, in a plain shell; evidence is
stdout + exit code):

- `npx tsc --noEmit && echo TSC_OK` (S01 gate 1, S03 gate 3): **passed**,
  `TSC_OK` echoed, exit 0.
- `pnpm test tests/providers/provider-neutrality-guard.test.ts && echo NEUTRAL_OK`
  (S02 gate 2): **passed**, `NEUTRAL_OK` echoed, 3/3 tests, exit 0.
- `pnpm check:i18n-keys && echo I18N_OK` (S03 gate 1): **passed**, `I18N_OK`
  echoed, reports 12 locale files, exit 0.
- `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE; pnpm test
  tests/auth/role-seed.test.ts && echo ROLE_SEED_OK` (S02 gate 1 mechanics):
  **fails as expected at plan time** — vitest exits 1 with "No test files
  found" and the marker does not echo, proving the `&& echo MARK` oracle
  really gates on exit 0. The gate is sound once the slice's test file
  exists; it is a deliverable-dependent failure, not a false-fail.
- `grep -q "MAIL_TRANSPORT" .env.example && echo ENV_DOC_OK` (S05 gate 2):
  **fails as expected now** (variable absent), exit 1, no marker. Same
  deliverable-dependent classification; the oracle mechanism is correct.
- S01 gate 3, S03 gate 2, S04 gates, S05 gate 1 reference `tests/auth/*.test.ts`
  files that do not exist yet; mechanics verified via the S02 probe above.
- Marker hygiene: every one of the 12 gates ends in `&& echo <literal>`; no
  gate relies on exit code alone. All expect strings are literal substrings
  (no `/regex/`). `--expect` semantics confirmed against REFERENCE.md gate
  contract (pass rule: exit 0 and output matching expect).

Symbol-truth audit (each resolves to what the spec says it does):

- `owner.ts` seam: `resolveRequestOwnerId` at `owner.ts:52-65`,
  `authenticatedOwnerId` returned verbatim at `:57`, `annon:` prefix at `:60`,
  cookie `anonymous_id` at `:3`, future-auth comment at `:46-50`. All exact.
- Three direct call sites exist and call the resolver without an
  authenticated owner (`owner-events:49`, `sessions/[id]/events:77`,
  `freshness:50`); line cites drift (Concern C1). Wrapper
  `withRequestOwnerId` at `with-owner.ts:12`, consumes the resolver at `:17`.
- `stage-meta` schema/columns: `owner_id` at `stage-meta.ts:27`, `is_public`
  at `:28-29`, `deleted_at` at `:29-30`, `published_at` via `ADD COLUMN IF NOT
  EXISTS` at `:32-33`, schema constant at `:24-48`. The ensure chain has
  exactly five ensures at `server-provider.ts:43-47` (`ensureSchema`,
  `ensureDocumentSchema`, `ensureStageMetaSchema`, `ensureOwnerMaterialSchema`,
  `ensureAssetSchema`).
- Read gate: `decideDocumentAccess` case `read` at `document-access.ts:70-74`
  allows any live stage regardless of `is_public`. Confirmed: privacy is URL
  obscurity today.
- `middleware.ts`: `ACCESS_CODE` HMAC block at `:60-86`, `verifyToken` at
  `:18-44`, Edge/Node split at `:53`. Middleware imports only `next/server`
  and `@/lib/config/feature-flags`; `feature-flags.ts` imports nothing, so no
  better-auth can enter the edge bundle transitively. Batch A never modifies
  middleware; the spec's Node-runtime session verification placement respects
  the edge constraint.
- `provider-config.ts`: `loadYamlFile` at `:208` (module-private; the spec
  correctly models on it rather than importing it), `DEFAULT_FILENAME` at
  `:354`. `quota.ts:3-13` stub and `build-agent.ts:66`
  (`remaining: () => Number.MAX_SAFE_INTEGER`) exact.
- Publish refusal: `app/api/stages/[id]/publish/route.ts:26` checks
  `ownerId.startsWith('anon:')`, `:28-29` return `login_required` + 401,
  close to the cited `:26-31`. `lib/persistence/server-auth.ts:2-13` carries
  the replacement note at `:10-12`; documents have no ownership partition
  (`:45-52`). Settings section union at `lib/types/settings.ts:3-14` with no
  admin member; `SettingsDialog` props at `components/settings/index.tsx:204`.
- `Header` exported at `components/header.tsx:34`, no account affordance. No
  `app/{signup,login,verify,register}` pages exist.
- meta-spec "six unauthenticated LLM route groups" claim verified on
  `app/api/quiz-grade/route.ts` (no auth gate; calls `callLLM` with stage
  `quiz-grade`). Owner-id syntax: no code anywhere parses or deconstructs
  `anon:` / owner ids (grep over `lib/**` and `app/**`: all `split(':')`
  sites are KV record ids, aspect ratios, IPv6, and voice ids). `user:<id>`
  is collision-safe against existing `anon:` handling; the `startsWith
  ('anon:')` guards in publish/unpublish simply do not fire for it, which is
  the intended behavior for authenticated owners.

Constraint-collision scan:

- Provider-neutrality guard: `PROVIDER_NEUTRAL_FILES` at
  `tests/providers/provider-neutrality-guard.test.ts:58-90`; `lib/auth` is not
  on it, and the scanner matches substrings of identifiers/strings against
  vendor vocabulary. The nine new env names contain neither `token` nor
  `plan` (verified by inspection), and the `qwen-token-plan-tts` derivation of
  those two words is confirmed at `:212-217` plus the derivation logic at
  `:414-420`. Env var names are not provider ids; no collision path exists.
- ESLint boundaries: `eslint.config.mjs` bans `ai` imports (static,
  namespace, dynamic) and enforces package independence for the three
  @openmaic packages; batch A touches neither. The LLM entry guard matrix
  (`tests/lint-llm-entry-guard.test.ts:44-58`) pins guarded paths including
  `lib/server` and `app/api/*`; auth code makes no model calls per the spec,
  and no planned file imports `ai`.
- i18n: `pnpm check:i18n-keys` rank-checked 12 locale files, en-US source of
  truth, arrays rejected (`scripts/check-i18n-keys.mjs:16-20`), empty objects
  rejected (`:25-29`) — the `auth.*` namespace must be non-empty in all 12
  files, consistent with S03's parity claim.
- Test placement: root vitest includes `tests/**/*.test.ts`
  (`vitest.config.ts:11`); `tests/auth/` tests will be picked up. Hermeticity:
  `tests/setup-env.ts` default (no `.env.local`), with the shell-pass-through
  caveat that motivates the spec's unset prefixes.
- Version bump: an app-side-only diff cannot trip
  `check-package-version-bumps.mjs` (it diffs only package directories,
  `:181-203`); root `package.json` dependency additions are not package-dir
  inputs. `.env.example` same-PR rule is stated and gated for
  `MAIL_TRANSPORT` (concern C5 covers the rest).
- better-auth facts: `npm view better-auth dist-tags.latest` returns `1.7.2`
  today; `better-auth` is absent from `package.json` and `node_modules`,
  matching S01's declared before-state.

Ledger-ability against the live CLI (verbs and flags needed, in order, so the
builder cannot drift — `rivr --help` confirmed each):

1. `rivr ledger init-batch docs/specs/013-rbac-auth-foundation.md --actor orchestrator --slices '<json>'` with `riskTier` per slice in the JSON (or `rivr init <spec-file> --actor researcher` for a single-slice flow),
2. `rivr slice target add <ledger> --actor researcher --slice S01 --file <path> --symbol <name> --kind <kind>` per target,
3. `rivr capture <ledger> --slice S01 --actor researcher` for before-states,
4. `rivr slice postcondition <ledger> --actor researcher --slice S01 --file <path> --symbol <name> --after-exists true --after-kind <kind> --after-signature "<(params): Return>" --quality <quality>`,
5. `rivr slice expect <ledger> --actor researcher --slice S01 --file <path> --symbol <name> --text "<expectation>"`,
6. `rivr slice gate add <ledger> --actor researcher --slice S01 --gate G1 --check '<cmd>' --expect <oracle> --type unit|integration|adversarial`.

The `--risk-tier` value is set at slice creation. Before-state capture notes
and per-gate evidence strings (the literal markers) are present for all five
slices; the three non-capturable targets are Blocker B3, and the
prose-only postconditions are Concern C3.

Capability matrix vs role model:

- The batch-A roles table (id, name, rank integer unique, system flag,
  timestamps) plus `user_roles` (user_id PK/FK, role_id FK, granted_by,
  granted_at) supports every matrix row without extra columns: the matrix
  cells decompose into rank-based audience checks (batch D), the fixed
  permission catalog (batch B: `course.create`, `course.publish`,
  `classroom.chat`, `quiz.grade`, `settings.manage`, `users.manage`,
  `roles.manage`), ownership conditions via `stage_meta.owner_id` (app-level
  SQL, no extra column), and the rank-keyed `quota_daily` (batch C). Ranks
  seed 1-4, anonymous 0 virtual, all in register Q12.
- Q12 rank editing does not conflict with batch A: rank edits and custom-role
  CRUD are batch F; batch A only defines the table and the seed. The unique
  rank constraint is an inheritance note for F (a custom role cannot share a
  built-in's rank), not a batch-A defect.
- owner scheme: `user:<auth-user-id>` vs `anon:` — no code parses either
  prefix, so the schemes cannot collide (verified above).

Signup flow against better-auth 1.7.2 (official docs via context7; the
package is not yet installed, which the spec declares):

- `emailVerification.sendOnSignUp` — exists (docs: "Enable automatic
  verification email on sign-up", `emailVerification: { sendOnSignUp: true }`).
- `emailAndPassword.requireEmailVerification` — exists, nested under the
  `emailAndPassword` plugin config (docs: email-password auth with required
  verification); no invented option.
- `autoSignInAfterVerification` — exists ("Auto Sign In After Verification").
- `emailAndPassword` plugin config and `database: new Pool(...)` — exist; the
  pg Pool is a documented top-level `database` value.
- `rateLimit: { storage: "database", modelName }` — exists (recommended for
  multi-instance setups); `baseURL` top-level option used for the static URL,
  with `BETTER_AUTH_URL` as the env equivalent.
- Admin plugin surface — exists (`adminRoles`, `adminUserIds`, `defaultRole`,
  `impersonationSessionDuration`, `bannedUserMessage`); the round-1 record's
  setRole/listUsers/ban/impersonate surface is real plugin surface.
- No renamed or invented option found. Caveat: docs track the latest
  (1.7.2 today); the `~1.7.2` pin allows intra-minor drift, so the ledger
  should add a quick post-install option probe among the added gates.

Round-2 deltas: all five transcribed in the meta-spec register and consistent
with the batch-A spec (Q12 rank model + Global Constraints line; Q13/Q10
mailer + S05; Q14 ACCESS_CODE independence; Q9 extension to batches A+B via
Process Rules and the S05/S03 Further Notes; Q3 UTC-midnight quota + batch-A
"UTC-midnight quota day belongs to batch C"). The deltas themselves are not in
a standalone round-2 file; the meta-spec register is their authoritative
record, and the batch-A spec correctly points there.

## Second pass (2026-09-04, after the author's fixes)

Re-reviewed the current file text of `docs/specs/013-rbac-auth-foundation.md`
and `docs/meta-specs/rbac-minimal-mode.md`, re-dry-ran the S04 and S05 gate
inventories exactly as written, re-counted tier compliance from the file text
(not the summary table), and re-verified the claim-mechanism text and the
8-column owner enumeration against the code. Only this file was modified.

### Per-finding status

- **B1 — CLOSED.** S04 now lists 5 gates (lines 252-256): unit
  `claim-migration`, unit `claim-scheme`, unit `owner-threading`,
  integration `claim.pg` (URL-gated), adversarial `claim-adversarial`.
  Tier-4 minimum (4 gates, one adversarial) met from file text.
- **B2 — CLOSED.** S05 now lists 3 gates (lines 303-305):
  `integration:` mailer, unit `mailer-transports`, smoke `ENV_DOC_OK`.
  Tier-3 minimum (3 gates, one integration) met from file text;
  the mailer gate now carries the `integration:` tag.
- **B3 — CLOSED WITH DEVIATION (one residual edit).** The three
  non-capturable targets are gone from S01/S02 and are bound through gates:
  `PKG_OK` (S01, line 121), `SEED_ENV_OK` (S02, line 158),
  `I18N_NS_OK` (S03, line 194). Testing Decisions now state the rule
  verbatim: "`package.json`, `.env.example`, and locale `.json` files are
  not capturable, so they never appear as target symbols" (lines 415-422).
  Residual: the S03 and S05 ledger-binding tables still print config rows
  for `lib/i18n/locales/en-US.json` (line 177) and `root .env.example`
  (line 288), contradicting the rule the same file states. The rule and
  gates operationally close the blocker; the two table rows must be
  deleted or annotated "gate-bound, not a target" so the file is
  self-consistent for the ledger builder.
- **C1 — CLOSED.** Before-state notes now cite the three direct resolver
  calls at `owner-events/route.ts:49`, `sessions/[id]/events/route.ts:77`,
  and `freshness/route.ts:50` (lines 237-242). All three match the verified
  call lines.
- **C2 — CLOSED.** Testing Decisions define one canonical env-clear prefix
  (lines 394-398) applied verbatim to every vitest gate in S01-S05, extended
  for the mailer gates, with the S04 `PG_CONTRACT_URL` exception stated
  (line 402).
- **C3 — CLOSED.** Every slice now carries a Ledger-bindings table with
  `file::symbol | kind | after-signature or shape | behavior`, using the
  rivr v2 `(params): Return` written form (Slices intro, lines 73-78).
- **C4 — CLOSED.** Batch-A spec cites `check-package-version-bumps.mjs:8-11`
  for ignored inputs and `:181-203` for the package-directory diff
  (lines 380-381). The meta-spec Global Constraints now name
  `scripts/openmaic-packages.mjs:34` as the authoritative six-package list
  and mark the "five owned packages" wording at
  `check-package-version-bumps.mjs:13-14` as stale prose (`meta-spec`
  lines 198-204). The script comment itself stays untouched, matching my
  round-1 note that it is repo cleanup, not a batch-A edit.
- **C5 — CLOSED.** S02 adds `grep -q "ADMIN_EMAILS" .env.example && echo
  SEED_ENV_OK` (line 158).
- **C6 — CLOSED.** S04 now specifies the mechanism (lines 206-211): the
  claim reads the `anonymous_id` cookie from the first verified-sign-in
  request, with seams cited at `owner.ts:3` (name), `owner.ts:7-20` (read),
  and `owner.ts:60` (prefix). All three cites verified against the code.
  The 8-column owner enumeration (lines 215-222) is real and complete: all
  `owner_id` columns in `packages/@openmaic/storage/src` and
  `lib/persistence` are covered (`stage_meta.ts:27`, `document/pg.ts:84`
  and `:60/:66-67`, `agent-session/pg.ts:90/:157/:163/:171`,
  `skill/pg.ts:53`, `owner-materials.ts:105`; verified by full grep, no
  straggler columns). Byte-store keys are session-scoped or row-stored
  (`sessionMaterialKey(sessionId, id, ...)` and `record.ossKey`, read at
  `session-materials.ts:234`), so the claim needs no S3/local byte-key
  rewrite. One note: the runtime learner-key layer
  (`lib/runtime/learner-key.ts`) is a separate `anon:` scheme whose own
  comment names `RuntimeStore.mergeLearner(anonKey, accountKey)` as its
  migration path; it is intentionally outside the 8-column claim and worth
  an explicit out-of-scope mention in a later batch, not a blocker here.

### Deviations judged

1. **LLM-guard probe dropped from S04.** The author kept `claim-scheme` and
   added `owner-threading` plus the PG contract gate instead, for 5 gates
   with one adversarial. Judgment: **acceptable.** Tier-4 compliance is met
   from file text, and the probe's purpose survives as a Testing-Decisions
   directive (line 435, "Run `tests/lint-llm-entry-guard.test.ts` as a
   probe").
2. **`test -n "$PG_CONTRACT_URL"` fail-closed wrap on the S04 integration
   gate.** Judgment: **correct and necessary.** The cited precedent suite
   skips without the URL (`event-notify.pg.test.ts:32,57` uses
   `describe.skipIf(!contractUrl)`), so without the wrapper `pnpm test`
   would exit 0, the marker would echo, and the tier-4 integration gate
   would pass vacuously with zero coverage. With the wrapper, a missing or
   empty URL fails the gate (exit 1, no marker) as a tier-4 gate should;
   a set URL proceeds into the deliverable. The prose at S04 lines 262-268
   documents this exactly.

### Dry-run results (S04 and S05 inventories, commands exactly as written)

| Gate | Command shape | Marker observed | Result |
| --- | --- | --- | --- |
| S04-G1 | ENV_CLEAR; `pnpm test tests/auth/claim-migration.test.ts && echo CLAIM_OK` | none | exit 1, plan-time fail (suite does not exist yet) |
| S04-G2 | ENV_CLEAR; `pnpm test tests/auth/claim-scheme.test.ts && echo CLAIM_SCHEME_OK` | none | exit 1, plan-time fail |
| S04-G3 | ENV_CLEAR; `pnpm test tests/auth/owner-threading.test.ts && echo THREADING_OK` | none | exit 1, plan-time fail |
| S04-G4 | ENV_CLEAR; `test -n "$PG_CONTRACT_URL" && pnpm test tests/auth/claim.pg.test.ts && echo CLAIM_PG_OK` | none | exit 1, no marker, fail-closed (URL unset in shell) — documented intent |
| S04-G4b | same with `PG_CONTRACT_URL` set | none | exit 1, no marker, short-circuit correct then plan-time fail (suite missing) |
| S04-G5 | ENV_CLEAR; `pnpm test tests/auth/claim-adversarial.test.ts && echo CLAIM_ADV_OK` | none | exit 1, plan-time fail |
| S05-G1 | ENV_CLEAR+mail; `pnpm test tests/auth/mailer.test.ts && echo MAILER_OK` | none | exit 1, plan-time fail |
| S05-G2 | ENV_CLEAR+mail; `pnpm test tests/auth/mailer-transports.test.ts && echo TRANSPORTS_OK` | none | exit 1, plan-time fail |
| S05-G3 | `grep -q "MAIL_TRANSPORT" .env.example && echo ENV_DOC_OK` | none | exit 1, plan-time fail (presence gate; var not yet in .env.example) |

All plan-time failures are the documented deliverable-dependent state
(spec lines 426-431, which cites this review's round-1 probe). No false-fail
oracle found. The three new node/grep gates (`PKG_OK`, `SEED_ENV_OK`,
`I18N_NS_OK`) were shell-checked: the exact file text parses cleanly under
`sh -c`, node exits 1 via the intended `process.exit(1)` path, and the
marker does not fire while the deliverable is absent.

### Corrected tier compliance (from file text)

| Slice | Tier | Gates in file | Minimum | Integration tag | Adversarial tag | Compliant |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | 3 | 4 | 3 | yes (session-roundtrip) | n/a | yes |
| S02 | 2 | 3 | 2 | n/a | n/a | yes |
| S03 | 3 | 4 | 3 | yes (session-routes) | n/a | yes |
| S04 | 4 | 5 | 4 | yes (claim.pg) | yes (claim-adversarial) | yes |
| S05 | 3 | 3 | 3 | yes (mailer) | n/a | yes |

### Second-pass verdict

**Approve-after-fixes.** All three blockers are closed and all six concerns
are closed. One paper-thin residual remains for full B3 closure: delete or
annotate the two config rows still printed in the S03 and S05
ledger-binding tables (`en-US.json`, `.env.example`) so the file text agrees
with its own non-capturable-target rule (lines 415-422). No other findings.

## Could not verify

- The `tests/auth/*.test.ts` test files do not exist yet; their internal
  behavior (mocked pool shape, env save/restore, console sink capture) is
  specified by convention but not executable. Their gates were verified for
  mechanics, not content.
- better-auth 1.7.2 behavior was checked against the official docs, not the
  installed package source (the spec pins the dependency; it is not installed
  and I could not install it in a review that changes nothing).
- End-to-end `rivr` ledger operations (capture, diff, verify) were not run on
  a 013 ledger; none exists and creating one would be a ledger write, outside
  this review's mandate. The CLI surface, tier contract, and symbol-router
  extension table were read from the live binary help and the skill REFERENCE.