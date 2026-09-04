# Batch 014 spec soundness review

Reviewer: independent spec-soundness reviewer (fresh eyes for 014; previously
reviewed batch 013 through two passes). The reviewer did not write the spec.
The reviewer read the code and ran read-only probes and gate dry-runs on
2026-09-04, against the working tree at `d49eb044`.

Reviewed documents:

- `docs/specs/014-branding-header.md` (draft, batch G)
- `docs/specs/013-rbac-auth-foundation.md` (delta: S03 extension + postcondition prose)
- `docs/meta-specs/rbac-minimal-mode.md` (delta: seven batches, G before A)
- `docs/research/rbac-minimal-mode-decision-round-1.md` (Round 3 section, `:206-228`)
- `docs/design/rbac-batch-a/*` (approved mockup set, referenced by 014)

Method: symbol/citation audit on all four logo sites and the home-page cites,
outline check of `app/page.tsx` for the bound symbols, header-capsule collision
scan, gate dry-runs for every 014 gate as written, ENV_CLEAR byte-compare
against 013's canonical list, ledger-ability mapping against the live rivr CLI,
constraint scans (provider-neutrality, ACCESS_CODE, NEXT_PUBLIC, i18n, test
placement), program-consistency check across the three documents, and a
design-vs-spec drift check against the approved mockups. No code changed. No
ledger written. Only this file was created.

## Verdict

**Approve-after-fixes.** Three blockers, each a one-sentence scope fix in the
spec text. All seven gates behave correctly (three pass today, four fail at
plan time exactly as documented), all bound symbols exist, and the program
structure is coherent.

## BLOCKERS

### B1. The Pro-toggle semantics are undefined in the V2 capsule.

- Spec: `docs/specs/014-branding-header.md` S2 binding, line 130: the capsule
  renders "language, theme, Pro toggle, account slot, gear in that exact
  order", and "The gear, theme, and language behaviors stay unchanged in
  function". The Pro toggle is the one element deliberately omitted from the
  unchanged list, and no other sentence defines what it does (workbench entry
  vs edit-mode switch). The designer flagged this as an open batch G decision
  and the spec leaves it open.
- The batch A postcondition "The Pro toggle seat is unchanged"
  (`013:193`) confirms the seat exists but does not define the semantics
  either.
- Suggested fix (exact wording, one sentence in the S2 binding or
  Implementation Decisions): "The Pro toggle keeps its current function,
  unchanged within the capsule: it is the [workbench entry | edit-mode
  switch] affordance." Resolve which before approval; the S2 capsule cannot
  be built without it.

### B2. The approved full-mode hero shows "headline + composer"; 014 never says where the headline (home.headline) lands.

- Spec: S2 removes the hero logo, tagline, and GreetingBar
  (`014:131-132,148-150`) and says nothing about replacement hero content.
- Evidence: the approved design proposes `home.headline` as NEW hero copy
  ("full-mode hero (new; home.slogan is retired to SITE_TAGLINE)",
  `docs/design/rbac-batch-a/README.md:164`, and "Headline copy is new
  (home.headline). The hero had no headline before", `README.md:261`), with
  "All 12 locales need parity at implementation"
  (`design/rbac-batch-a/index.html:119`). The full-mode mockup renders
  "headline + composer, no logo/tagline/GreetingBar"
  (`README.md:22`). Neither 014 nor the meta-spec register assigns the key to
  a batch.
- Suggested fix (exact wording, one sentence in the S2 postcondition):
  either "The full-mode hero headline ships here as the `home.headline` i18n
  key with parity across all 12 locales (en-US source of truth)" or "The
  hero replacement copy `home.headline` and its 12-locale parity land in
  batch C with the layout rule." State which; the implementer must not invent
  hero copy by reading the mockups.

### B3. The config badge from the approved mockup is absent from scope.

- Spec: the top-left lockup binding is "name and tagline from
  `useSiteBranding`" (`014:131`) and never mentions a config badge.
- Evidence: the approved mockup shows "Site lockup (SITE_NAME + tagline +
  config badge) top-left"
  (`docs/design/rbac-batch-a/index.html:62`). The designer called the badge
  operator-only. The spec neither includes nor excludes it.
- Suggested fix (exact wording, one sentence): "The config badge from the
  approved mockup is operator-only chrome; G renders name and tagline only
  and omits the badge" (or explicitly includes it with the operator-only
  condition).

## CONCERNS

### C1. Hook failure semantics under ACCESS_CODE (the branding-route finding).

The route is intentionally not whitelisted: "The `ACCESS_CODE` network
curtain still applies to it at the middleware, per Q14. The route is not
added to the middleware whitelist" (`014:177-179`). `middleware.ts:60-86`
whitelists only `/api/access-code/` and `/api/health`, so a locked deployment
401s `/api/site-branding`. The postcondition guarantees defaults only
"before the fetch resolves" (`014:107`); it never states what the hook does
on a 401 or any non-2xx/network error. Fix (one sentence): "On any non-2xx
response or fetch error the hook keeps the defaults and does not throw." The
ACK that the route is behind the curtain is sound; this is the completion of
that decision.

### C2. Three S2 ledger-binding rows carry a bare file path, no `::symbol`.

`014:133-135` list `components/workbench/workspace/WorkspaceHome.tsx`,
`components/edit/SlideNavRail/SlideNavRail.tsx`, and
`components/workbench/workspace/WorkspaceRail.tsx` with kind `component` but
no symbol half. All three exported symbols exist and are now verified
(`WorkspaceHome` at `WorkspaceHome.tsx:47`, `SlideNavRail` at
`SlideNavRail.tsx:51`, `WorkspaceRail` at `WorkspaceRail.tsx:182`), so the
fix is naming them: `...WorkspaceHome.tsx::WorkspaceHome`,
`...SlideNavRail.tsx::SlideNavRail`, `...WorkspaceRail.tsx::WorkspaceRail`.
Without the symbol, `rivr slice target add --symbol <name>` drifts.

### C3. The footer brand text stays hardcoded.

`app/page.tsx:1350` renders "OpenMAIC Open Source Project". `014:141` states
the footer is unaffected by `SHOW_LOGO`, which is true (text, not image).
But the operator-branding goal leaves the footer printing a baked-in product
name after a rename. Fix (one sentence): "The footer credit stays static in
G" or "the footer credit follows `SITE_NAME`".

### C4. Meta-spec still carries three stale "six-batch" statements.

The Problem Statement still says "six-batch RBAC and minimal-mode build"
(`meta-spec:52`), the Architecture Record heading says "Target state after
all six batches" (`meta-spec:72`), and the Q9 register row says "Six child
batches, each with its own spec, ledger, approval, and cycle, in the order A
through F" (`meta-spec:166`). The batch table, per-batch dependency table,
process rules ("all seven batches"), and acceptance criteria ("All seven
child batches certify") correctly say seven with G first. Fix: update the
three stale mentions to seven / G-first so the document is self-consistent.

### C5. The 013 delta contains undeclared prose additions beyond the declared scope.

Beyond the S03 clause extension and postcondition prose, 013 now adds the
guest-default-role doctrine: `createAuthServer` behavior ("verified signups
assigned the guest default role", `013:100`), the S01 postcondition line
("A verified signup without a configured grant defaults to guest (rank 1)",
`013:117`), and `seedRoleGrants` behavior ("overriding the guest default for
emails with a configured role", `013:141`). The additions are consistent
with Q5 and no gate changed, but they are unpinned by any gate. Accept them
explicitly or add an assertion in `role-seed.test.ts` that a grantless
signup resolves to guest.

## VERIFIED-OK

- The four logo sites all resolve. `app/page.tsx:836` is the hero
  `motion.img src="/logo-horizontal.png"` line inside the lockup block;
  `WorkspaceHome.tsx:141-144` is the hero `<img src={brand.logoSrc} ...>`
  (`data-testid="pro-workspace-hero-logo"`); `SlideNavRail.tsx:411` is the
  rail `<img src={brand.logoSrc} className="h-6 w-auto" />`;
  `WorkspaceRail.tsx:849` is the rail `<img src={brand.logoSrc} aria-hidden="true" />`.
  Each draws `brand.logoSrc` unconditionally, matching the problem statement.
- Bound `app/page.tsx` symbols are real outline symbols: `HomePage` at
  `:129-1353` (module-local; the tree-sitter outline lists it, so
  `target add --symbol HomePage` resolves) and `GreetingBar` at
  `:1362-1638`, rendered at `:881` (both cited correctly). The exported
  entry is `Page` at `:1894-1896`. Grid recipe cite `app/page.tsx:1263`
  verified (`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4`); it appears in
  the design docs (`home-minimal.html:326`, `styles.css:566`), accurate.
  Footer cite `:1347-1350` verified.
- Capsule coexistence: `components/header-capsule.tsx` does not exist and no
  `HeaderCapsule` symbol exists anywhere in `components/`, `app/`, or `lib/`,
  so the new component collides with nothing. The language selector and
  theme toggle are inline in `HomePage` (`:729`, `:733-777`), matching the
  before-state notes. Existing `components/header.tsx::Header` is a separate
  component (batch A's menu target), not a collision.
- Precedents: `renderToStaticMarkup` + `createElement` at
  `tests/ui/interactive-mode-button.test.ts:1-18` verified verbatim; the
  route-test style (`tests/agent-runtime/stage-meta-routes.test.ts:1-33`)
  verified in the 013 review; `readBoolean` at
  `lib/config/feature-flags.ts:10-12` (truthy `'true'` or `'1'`);
  `loadYamlFile` at `lib/server/provider-config.ts:208`; `DEFAULT_FILENAME`
  at `:354`.
- Brand constant cite is off by two lines: `DEFAULT_BRAND` is at
  `lib/brand/brand-config.ts:27-34` with `productName: 'OpenMAIC'` at `:28`;
  the spec cites `:29-38`. Substance exact, range drift, cosmetic.
- Gate dry-runs (commands exactly as written):

| Gate | Result | Marker |
| --- | --- | --- |
| S1 unit `tests/branding/site-branding.test.ts && echo BRAND_CFG_OK` | exit 1 | none (plan-time, suite missing) |
| S1 smoke `tests/branding/site-branding-route.test.ts && echo BRAND_RT_OK` | exit 1 | none (plan-time) |
| S1 smoke `grep -q "SITE_NAME" .env.example && echo BRAND_ENV_OK` | exit 1 | none (presence gate, documented) |
| S2 smoke `npx tsc --noEmit && echo TSC_OK` | exit 0 | TSC_OK |
| S2 integration `tests/branding/header-capsule.test.ts && echo BRAND_HDR_OK` | exit 1 | none (plan-time) |
| S2 smoke `tests/providers/provider-neutrality-guard.test.ts && echo NEUTRAL_OK` | exit 0 | NEUTRAL_OK |
| S2 smoke `pnpm check:i18n-keys && echo I18N_OK` | exit 0 | I18N_OK |

  The four plan-time failures are the documented deliverable-dependent state
  (`014:222-225`). No false-fail oracle. The ENV_CLEAR prefix is
  byte-identical to the 013 canonical list (verified by string compare).
- Ledger-ability: every target file is `.ts`/`.tsx` (capturable); the S1
  entry `app/api/site-branding/route.ts::GET` style matches the 013 route
  bindings; postconditions use the rivr v2 `(params): Return` / exists-shape
  forms; S1 tier 2 lists 3 gates (minimum 2), S2 tier 3 lists 4 gates with
  the `integration:` tag on BRAND_HDR_OK (minimum 3); `Spec status: draft`
  present; slice titles are one line ("Branding config and public surface",
  "Header chrome"). The one binding gap is Concern C2.
- Constraint collisions: `SITE_NAME`, `SITE_TAGLINE`, `SHOW_LOGO` contain no
  "token"/"plan" segments; the new files are not on `PROVIDER_NEUTRAL_FILES`
  and 014 touches no neutral file; no `NEXT_PUBLIC_*` appears anywhere in
  014 (branding is runtime server config, so inlining is correctly
  irrelevant); `tests/branding/*` matches the root include
  `tests/**/*.test.ts`; the i18n parity gate rides in S2 and brand strings
  are documented as operator data, not locale keys.
- Program consistency: the A<-G dependency is stated in the meta-spec (batch
  table row A "G", per-batch dependency table, strict sequence "G, then A,
  then B..."), in 013 (S03 binding "filling the batch G capsule account
  slot", `013:178`, plus postcondition prose `013:191-193`), and in 014
  (user story 4, Further Notes "Batch A S03 rides the V2 capsule chrome G
  delivers", `014:240-241`). The C layout note appears in the meta-spec
  (batch C row and R3-Q5) and in 014's Out of Scope and Further Notes. The
  R3 register rows (R3-Q1..Q5) are present and match the Round 3 source
  (`decision-round-1.md:206-228`). Acceptance criteria say "all seven child
  batches". No circular dependency: G depends on nothing and A depends on
  G's chrome only.
- 013 gate byte-identity: all 19 gates (S01 4, S02 3, S03 4, S04 5, S05 3)
  are byte-identical to the 013 second-pass verification, including the
  `test -n "$PG_CONTRACT_URL"` fail-closed wrap and the `node -e` gates. The
  013 B3 residual from the second pass is closed: both the S03
  `en-US.json` row and the S05 `.env.example` row are removed from the
  binding tables and converted to gate-bound deliverables (`013:181-183`,
  `013:297-300`).

## Second pass (2026-09-04, after the author's fixes + round-4 decisions D1-D4)

Re-reviewed the current file text of `docs/specs/014-branding-header.md`, the
013 delta, and the meta-spec R3 register; re-dry-ran the changed gate and two
vitest gates; re-verified the C2 symbol bindings against the actual exports.
Only this file was modified.

### Per-finding status

- **B1 (Pro toggle semantics) — CLOSED.** 014:197-200: "It is a workbench
  entry affordance, the same intent as today's hero ProBadge routing to the
  Pro workbench, not the stage edit-mode switch. Its visibility stays ungated
  in G. Batch C restricts it to creator and admin." Mirrored in the S2
  binding (014:133) and postcondition (014:158-159). D1 requirement met:
  G ships ungated, C gates to creator/admin.
- **B2 (home.headline + SHOW_HEADLINE) — CLOSED.** D2 is placed everywhere
  required: defaults shape adds `showHeadline: true` (014:92); the loader
  parses `SHOW_HEADLINE` with `readBoolean` semantics (014:93); the route
  shape returns `showHeadline` (014:94); before-state and deliverables
  mention `SHOW_HEADLINE` (014:98, 126); the env vars list includes it
  (014:214-215); BRAND_ENV_OK now greps both `SHOW_HEADLINE` and `SITE_NAME`
  (014:116); the HomePage binding row states "The hero renders the
  `home.headline` i18n key gated by `showHeadline`, with 12-locale parity"
  (014:134); Implementation Decisions own the key with the approved copy and
  parity (014:201-205); the postcondition states the hero shows it when
  `showHeadline` is true (014:153-154).
- **B3 (config badge) — CLOSED.** 014:156-157: "The config badge from the
  approved mockup is mockup-only and does not ship in user UI." Repeated at
  014:206-207. D3 honored.
- **C1 (hook failure under ACCESS_CODE) — CLOSED.** 014:108-110: "On any
  non-2xx response or fetch error, `useSiteBranding` keeps the defaults and
  does not throw." The ACCESS_CODE-locked deployment now degrades to
  defaults by contract, completing the decision that the route is not
  whitelisted.
- **C2 (symbol bindings) — CLOSED.** 014:136-138 now read
  `WorkspaceHome.tsx::WorkspaceHome`, `SlideNavRail.tsx::SlideNavRail`,
  `WorkspaceRail.tsx::WorkspaceRail`; verified against the real exports
  (`WorkspaceHome` at `WorkspaceHome.tsx:47`, `SlideNavRail` at
  `SlideNavRail.tsx:51`, `WorkspaceRail` at `WorkspaceRail.tsx:182`).
- **C3 (footer) — CLOSED.** 014:145 "The credit stays static in G", 014:155,
  and 014:208 "'OpenMAIC Open Source Project' stays static in G. `SHOW_LOGO`
  does not touch it." D4 honored.
- **C4 (meta-spec stale six-batch) — CLOSED.** The meta-spec now reads
  "seven-batch RBAC" (`meta-spec:52`), "Target state after all seven
  batches" (`meta-spec:72`), and the Q9 register row carries the amendment
  "Seven batches with G first" (`meta-spec:166`). R3-Q6..Q9 rows are present
  and match D1-D4 verbatim (`meta-spec:187-190`).
- **C5 (013 guest-default unpinned) — CLOSED.** 013:433-434 (Testing
  Decisions): "The guest-default assertion lives inside the
  `role-seed.test.ts` and `session-roundtrip.test.ts` suites, and no gate
  command text changes." This is the declared Testing-Decisions sentence;
  it pins the doctrine to suites that already exist as gates, added as
  assertions, with no gate text drift.

### Observed-but-consistent drift (accept)

- 013 adds user story 7 (013:70-71): "As a new visitor, I want to create an
  account and land as a verified guest, so that I know what my account can do
  before I am elevated." This is beyond the declared delta (the
  Testing-Decisions sentence and the S03 clause), and the 013 delta brief
  said "only" those two lines changed. The story is consistent with the
  guest-default doctrine already accepted in C5 and changes no gate or
  binding. Accept it; no action required.

### Gate and tier re-verification

| Gate | Result | Marker |
| --- | --- | --- |
| S1-G3 changed BRAND_ENV_OK (`grep SHOW_HEADLINE && grep SITE_NAME && echo BRAND_ENV_OK`) | exit 1 | none; plan-time (both vars absent from `.env.example`), documented at 014:246-249 |
| S1-G1 vitest (`tests/branding/site-branding.test.ts`) | exit 1 | none; plan-time, documented |
| S2-G2 integration vitest (`tests/branding/header-capsule.test.ts`) | exit 1 | none; plan-time, documented |

ENV_CLEAR prefix re-compared byte-for-byte against the 013 canonical list:
**identical**. Tier compliance unchanged from file text: S1 = 3 gates
(tier 2, min 2), S2 = 4 gates (tier 3, min 3) with the `integration:` tag on
BRAND_HDR_OK. All 19 gates of 013 re-verified byte-identical in this pass
(S01 4, S02 3, S03 4, S04 5, S05 3; the gate lists at 013:121-124, 156-161,
199-202, 260-264, 315-317 match the 013 second-pass record exactly, including
marks and the PG_CONTRACT_URL wrap).

### Program structure

Dependency order is consistent across all three files: meta-spec batch table
(A depends on G, `meta-spec:136`; G depends on none, `:142`), per-batch
dependency table (`:261-267`), and strict sequence "G, then A, then B, then C
through F in order" (`:269`); 013's S03 clause and postcondition reference
G's V2 capsule (013:178, 192-193); 014 user story 4 and Further Notes
reference A filling the slot. No circular dependency. R3-Q6..Q9 rows present
and complete.

### Second-pass verdict

**Approve.** All three blockers and all five concerns are closed in file
text. The one observed extra (013 user story 7) is consistent and gated
text-neutral; accept it. No NOT-closed items.

## Could not verify

- Behavior of the not-yet-written `tests/branding/*` suites and the not-yet
  written `tests/auth/*` 013 suites; their gates were verified for
  mechanics, not content.
- The Pro-toggle rendering path today (the toggle's exact current home
  component) was not traced end to end; its semantics are the open question
  of Blocker B1 regardless of where the control currently lives.
- End-to-end rivr ledger operations on a 014 or 013 ledger (none exist;
  creating one would be a ledger write, outside this review's mandate).