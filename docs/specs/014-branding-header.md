# Batch 014 spec: branding-header

Spec status: closed

## Problem Statement

The home page hardcodes the brand. The hero renders the horizontal logo and a
tagline (`app/page.tsx:833-836`), the greeting bar renders an avatar with
"Hi, Name" (`app/page.tsx:881`, `GreetingBar` defined at `:1362`), and the
header capsule pieces sit inline inside `HomePage` (`app/page.tsx:129`):
language at `:729`, theme at `:733-777`. From the operator view the
consequences are concrete.

- The product name and tagline cannot be changed without editing code. The
  brand constant is static (`lib/brand/brand-config.ts:27-34`,
  `DEFAULT_BRAND.productName` is `'OpenMAIC'`).
- The product logo cannot be hidden. Every logo render site draws
  `brand.logoSrc` unconditionally: the home hero (`app/page.tsx:836`), the
  pro workspace hero (`components/workbench/workspace/WorkspaceHome.tsx:141-144`),
  the edit rail (`components/edit/SlideNavRail/SlideNavRail.tsx:411`), and
  the workbench rail (`components/workbench/workspace/WorkspaceRail.tsx:849`).
- The top-right capsule order is implicit, not contractual. Round 3 fixes it
  to language, theme, Pro toggle, account zone, settings gear
  (`docs/research/rbac-minimal-mode-decision-round-1.md:218-219`).
- Batch A needs a stable account slot in the capsule. The account zone lands
  in the V2 capsule chrome, and that chrome must exist first
  (`docs/research/rbac-minimal-mode-decision-round-1.md:210-211,226-228`).
- The hero greeting must retire. The home hero no longer renders
  `GreetingBar`.

Batch G builds the branding config surface and rebuilds the header chrome. It
touches no auth, no gating, and no library layout.

## Solution

Batch G ships a branding config loader that reads env (`SITE_NAME`,
`SITE_TAGLINE`, `SHOW_LOGO`) and the optional `server-branding.yml`, a public
route that serves the resolved branding, and a client hook with safe
defaults. It rebuilds the home header chrome: the top-left shows the
configured site name and tagline, and the right capsule becomes a single
standardized component with the order language, theme, Pro toggle, account
slot, gear. The account slot stays empty in G. Batch A fills it. The home
hero loses its logo, tagline, and GreetingBar. Every product logo render site
honors `SHOW_LOGO`.

The minimal-mode layout rule is not implemented here. Round 3 assigns that
behavior to batch C and asks the branding and header work to define the
layout (`docs/research/rbac-minimal-mode-decision-round-1.md:220-223`). G
previews it in approved mockups only.

All decisions reference the Round 3 section of
`docs/research/rbac-minimal-mode-decision-round-1.md:206-228` and the program
record `docs/meta-specs/rbac-minimal-mode.md`.

## User Stories

1. As an operator, I want to set the site name and tagline from env or yaml,
   so that I run the product under my own identity without code edits.
2. As an operator, I want to hide the product logo across the site, so that
   co-branded deployments look native.
3. As a visitor, I want a consistent header capsule, so that language, theme,
   and settings controls sit in a predictable order.
4. As batch A, I want an empty account slot in the header capsule, so that
   the account menu lands without re-chroming the header.
5. As a minimal-mode user, I want to preview the future composer-hiding
   layout in mockups, so that batch C lands on an approved visual.

## Slices

Each slice lists the ledger bindings for its target symbols, the before-state
capture notes, the postcondition, and the gate inventory. Postcondition
bindings use the rivr v2 form: `--after-kind` with `--after-signature`
written as `(params): Return` for functions, or an exists and shape clause
for constants and components. Gate types are `smoke`, `unit`, `integration`,
`adversarial`. Tier 3 needs at least three gates with one integration tag.
Every gate echoes a literal success marker. The env-clear prefix `ENV_CLEAR`
is the batch A canonical list, copied verbatim, and applies to every vitest
gate here.

### S1 Branding config and public surface

Delivers: the server loader at `lib/config/site-branding.ts` (env plus
optional `server-branding.yml`), the public route `app/api/site-branding/
route.ts` (GET, no PII, no auth), and the client hook
`lib/hooks/use-site-branding.ts` with defaults that hold until the route
answers.

Ledger bindings:

| file::symbol | kind | after-signature or shape | behavior |
| --- | --- | --- | --- |
| `lib/config/site-branding.ts::SiteBranding` | type | shape `{ name: string, tagline: string, showLogo: boolean, showHeadline: boolean }` | the client-safe model carried by both modules |
| `lib/config/site-branding.ts::SITE_BRANDING_DEFAULTS` | constant | shape `{ name: 'OpenMAIC', tagline: '', showLogo: true, showHeadline: true }` | the fallbacks when env and yaml say nothing, kept in the client-safe module |
| `lib/config/site-branding.ts::readBoolean` | function | `(envValue: string | undefined): boolean` | truthy is `'true'` or `'1'`. Client-safe, no node imports |
| `lib/config/site-branding.server.ts::loadSiteBranding` | function | `(): SiteBranding` | server-only: defaults, then `server-branding.yml` through the module-private `loadYamlFile` helper, then env. Env wins. `SHOW_LOGO` and `SHOW_HEADLINE` parse with `readBoolean`. Imports `node:fs`, `node:path`, and `js-yaml` |
| `app/api/site-branding/route.ts::GET` | function | `(): Promise<Response>` | imports the server module, returns `{ name, tagline, showLogo, showHeadline }` publicly, no PII, no auth, Node runtime. The outline reports `()` and the implementer adds the `: Promise<Response>` annotation |
| `lib/hooks/use-site-branding.ts::useSiteBranding` | function | `(): SiteBrandingState` | returns defaults first, then the fetched values. Imports the client-safe module only |

Before-state capture notes: `lib/config/site-branding.ts` does not exist. No
`SITE_NAME`, `SITE_TAGLINE`, `SHOW_LOGO`, or `SHOW_HEADLINE` entry exists in
`.env.example`.
The brand is the static `DEFAULT_BRAND` (`lib/brand/brand-config.ts:27-34`).
The js-yaml loader to model is `loadYamlFile`
(`lib/server/provider-config.ts:208`), and the boolean precedent is
`readBoolean` (`lib/config/feature-flags.ts:10-12`, truthy is `'true'` or
`'1'`).

Postcondition: an operator changes the site identity through env or yaml and
the route serves the result. The route returns no PII and requires no
session. The hook renders defaults before the fetch resolves. On any non-2xx
response or fetch error, `useSiteBranding` keeps the defaults and does not
throw. `SHOW_LOGO` and `SHOW_HEADLINE` default to shown. The server-only
loader lives in `lib/config/site-branding.server.ts`. The client-safe surface
stays in `lib/config/site-branding.ts`. The route imports the server module.

Gates:

- unit: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/branding/site-branding.test.ts && echo BRAND_CFG_OK` expects `BRAND_CFG_OK`
- smoke: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/branding/site-branding-route.test.ts && echo BRAND_RT_OK` expects `BRAND_RT_OK`
- smoke: `grep -q "SHOW_HEADLINE" .env.example && grep -q "SITE_NAME" .env.example && echo BRAND_ENV_OK` expects `BRAND_ENV_OK`

Risk tier: 2.

### S2 Header chrome

Delivers: the standardized capsule component, the home header rebuild, the
hero cleanup, and the site-wide logo toggle application.

Deliverables (gate-bound, not symbol-bound): the `.env.example` entries for
`SITE_NAME`, `SITE_TAGLINE`, `SHOW_LOGO`, `SHOW_HEADLINE`. The BRAND_ENV_OK
gate binds them.

Ledger bindings:

| file::symbol | kind | after-signature or shape | behavior |
| --- | --- | --- | --- |
| `components/header-capsule.tsx::HeaderCapsule` | component | `({ onSettingsOpen, accountSlot }: HeaderCapsuleProps)` | renders language, theme, Pro toggle, account slot, gear in that exact order. The account slot renders null through a prop in G. The gear, theme, and language behaviors stay unchanged in function. The Pro toggle acts as the workbench entry affordance, the same intent as today's hero ProBadge routing. Its visibility stays ungated in G |
| `app/page.tsx::HomePage` | function | `()` | modified: top-left name and tagline from `useSiteBranding`. Right side renders `HeaderCapsule` with an empty account slot. Hero logo and tagline removed. `GreetingBar` no longer rendered. The hero renders the `home.headline` i18n key gated by `showHeadline`, with 12-locale parity |
| `app/page.tsx::GreetingBar` | function | `()` | modified: retired from the home hero, no render site remains |
| `components/edit/SlideNavRail/SlideNavRail.tsx::SlideNavRail` | component | `()` | modified: rail logo honors `showLogo` |

The two workspace rows carry multi-line signatures the outline reports verbatim. Their exact parameter text pins them:

- `components/workbench/workspace/WorkspaceHome.tsx::WorkspaceHome` (kind
  component, after-signature):

  ```
  ({
    composerReset,
    discoveryContent,
    courseOptions,
    onOpenSession,
    onExitPro,
  }: {
    readonly composerReset: number;
    readonly discoveryContent: ReactNode;
    /**
     * What the composer's `@` picker may name. The shell already has this list
     * (the rail renders it), so it is handed down rather than fetched again here.
     */
    readonly courseOptions: readonly CourseMentionSource[];
    readonly onOpenSession: (sessionId: string) => void;
    readonly onExitPro: () => void;
  })
  ```

  Behavior: modified: hero logo honors `showLogo`.

- `components/workbench/workspace/WorkspaceRail.tsx::WorkspaceRail` (kind
  component, after-signature):

  ```
  ({
    courses,
    sessions,
    sessionState,
    onReloadSessions,
    activeCourseId,
    activeSessionId,
    collapsed,
    onToggleCollapsed,
    onOpenCourse,
    onOpenSession,
    onNewSession,
    onGoHome,
    onExitPro,
    onSessionDeleted,
    onRenameSession,
    onDeleteCourse,
    resizeHandle,
  }: {
    readonly courses: Discovery;
    readonly sessions: readonly ProHomeSessionItem[];
    readonly sessionState: HomeDiscoveryState;
    readonly onReloadSessions: () => void;
    readonly activeCourseId: string | null;
    readonly activeSessionId: string | null;
    readonly collapsed: boolean;
    readonly onToggleCollapsed: () => void;
    readonly onOpenCourse: (id: string) => void;
    readonly onOpenSession: (id: string) => void;
    /**
     * A new conversation in the middle column. Both entries below (the compose row
     * and its collapsed `+`) call this ONE handler, and it deliberately does not
     * touch the classroom pane — see `startNewConversation` in the shell.
     */
    readonly onNewSession: () => void;
    /** Back to the bare `/workspace` — the logo, and the shell's own handler. */
    readonly onGoHome: () => void;
    readonly onExitPro: () => void;
    /** The shell drops the deleted chat's pane and URL param, once the server
     *  confirmed the delete. Rows are already gone optimistically down here. */
    readonly onSessionDeleted: (sessionId: string) => void;
    /**
     * Name a chat. The shell owns the write (one writer for this row and the
     * pane header both) and answers with a readable message when it is refused.
     */
    readonly onRenameSession: (sessionId: string, title: string) => Promise<string | null>;
    /** The shell deletes the course AND closes its classroom tab on success. */
    readonly onDeleteCourse: (courseId: string) => Promise<void> | void;
    /** The width drag, owned by the shell (it writes the CSS variable on the root). */
    readonly resizeHandle: ReactNode;
  })
  ```

  Behavior: modified: rail logo honors `showLogo`.

Before-state capture notes: the capsule pieces are inline in `HomePage`
(language at `app/page.tsx:729`, theme at `:733-777`). The hero logo renders
at `app/page.tsx:836`. `GreetingBar` renders at `:881` and is defined at
`:1362`. The home footer carries only a text credit
(`app/page.tsx:1347-1350`), no logo image, so it is unaffected by
`SHOW_LOGO`. The credit stays static in G. Logo sites today: `WorkspaceHome.tsx:141-144`,
`SlideNavRail.tsx:411`, `WorkspaceRail.tsx:849`. No `header-capsule`
component exists. The component test precedent is
`tests/ui/interactive-mode-button.test.ts:1-18`
(`renderToStaticMarkup` plus `createElement`, no test library).

Postcondition: the home capsule renders exactly language, theme, Pro toggle,
account slot, gear. The top-left shows the configured name and tagline. The
hero shows no logo and no tagline, and the greeting is retired. The hero
shows the `home.headline` copy when `showHeadline` is true. Every product
logo render site hides when `showLogo` is false. The footer credit stays
static. The config badge from the approved mockup is mockup-only and does not
ship in user UI. The gear, theme, and language controls behave exactly as
before within the new capsule. The Pro toggle remains the workbench entry
affordance, ungated in G, and batch C restricts it to creator and admin.

Gates:

- smoke: `npx tsc --noEmit && echo TSC_OK` expects `TSC_OK`
- integration: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/branding/header-capsule.test.ts && echo BRAND_HDR_OK` expects `BRAND_HDR_OK`
- smoke: `unset DATABASE_URL PERSISTENCE_DEV_TOKEN ACCESS_CODE OPENMAIC_AGENT_RUNTIME_ENABLED NEXT_PUBLIC_PRO_WORKBENCH_ENABLED NEXT_PUBLIC_MAIC_EDITOR_ENABLED; pnpm test tests/providers/provider-neutrality-guard.test.ts && echo NEUTRAL_OK` expects `NEUTRAL_OK`
- smoke: `pnpm check:i18n-keys && echo I18N_OK` expects `I18N_OK`

Risk tier: 3. The integration gate binds the hook, the capsule, and the home
chrome together through a fixture of the route contract, rendered to static
markup.

## Implementation Decisions

- Config precedence is defaults, then yaml, then env. Env wins. This mirrors
  the provider-config doctrine (`lib/server/provider-config.ts:208` and the
  module cache at `:354`). Batch E later adds the admin settings modal
  override on the same defaults-then-database spine.
- The client and server split. `loadSiteBranding` and its `loadYamlFile`
  helper live in `lib/config/site-branding.server.ts`, which imports
  `node:fs`, `node:path`, and `js-yaml`. `lib/config/site-branding.ts` keeps
  only the client-safe surface: the `SiteBranding` type,
  `SITE_BRANDING_DEFAULTS`, and `readBoolean`. The route imports the server
  module. Turbopack client bundling cannot carry `node:fs`, and the hook's
  import graph must stay pure.
- The import-graph guard. A static regression test,
  `tests/branding/client-import-graph.test.ts`, walks the hook import graph
  and asserts no `node:` imports. It is a gate-bound deliverable.
- `SHOW_LOGO` and `SHOW_HEADLINE` parse with `readBoolean` semantics from
  `lib/config/feature-flags.ts:10-12`: truthy is `'true'` or `'1'`. Both
  default to shown.
- The public route returns only `{ name, tagline, showLogo, showHeadline }`.
  It contains no PII and requires no session. Its Node runtime reads the
  config file with the same fs and js-yaml path the provider loader uses
  (`lib/server/provider-config.ts:208-220`). The `ACCESS_CODE` network
  curtain still applies to it at the middleware, per Q14. The route is not
  added to the middleware whitelist.
- Defaults: name falls back to `'OpenMAIC'`, matching
  `DEFAULT_BRAND.productName` (`lib/brand/brand-config.ts:28`). Tagline
  falls back to empty. Logo falls back to shown. Headline visibility falls
  back to shown.
- The capsule order is contractual: language, theme, Pro toggle, account
  slot, gear. G ships `HeaderCapsule` with the account slot as a prop that
  renders null. Batch A fills the slot with the account menu without
  re-chroming the header.
- The existing gear, theme, and language behaviors stay byte-for-byte in
  function inside the new capsule. The move is structural, not behavioral.
- The Pro toggle. It is a workbench entry affordance, the same intent as
  today's hero ProBadge routing to the Pro workbench, not the stage edit-mode
  switch. Its visibility stays ungated in G. Batch C restricts it to creator
  and admin.
- The hero headline. Batch G owns `home.headline` with the copy "Turn any
  material into a living classroom" and 12-locale parity at implementation.
  `SHOW_HEADLINE` toggles its visibility with `readBoolean` semantics, from
  env and `server-branding.yml`, with the batch E admin override like the
  other branding keys.
- The config badge. The "env · yaml" badge from the approved mockup is
  mockup-only. It does not ship in user UI.
- The footer credit. "OpenMAIC Open Source Project" stays static in G.
  `SHOW_LOGO` does not touch it.
- i18n: the brand strings are operator config, not locale keys. A locale
  key would pin a translation the operator cannot control. The route returns
  the operator strings as data. Surrounding UI copy stays on i18n keys, and
  `check:i18n-keys` keeps enforcing parity.
- Env vars, all documented in `.env.example` in this change: `SITE_NAME`,
  `SITE_TAGLINE`, `SHOW_LOGO`, `SHOW_HEADLINE`. No name contains the
  substrings "token" or "plan", so the provider-neutrality guard stays
  green.
- No database schema, no migration, no publishable package changes. G is
  chrome and config only.

## Testing Decisions

- Hermetic unit tests live under `tests/branding/`. Root vitest picks up
  `tests/**/*.test.ts` (`vitest.config.ts:11`) and `.env.local` is not
  loaded (`tests/setup-env.ts:4`).
- The env-clear prefix is the batch A canonical list, copied verbatim:
  `DATABASE_URL`, `PERSISTENCE_DEV_TOKEN`, `ACCESS_CODE`,
  `OPENMAIC_AGENT_RUNTIME_ENABLED`, `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED`,
  `NEXT_PUBLIC_MAIC_EDITOR_ENABLED`. Every vitest gate carries it.
- Env changes inside tests follow the save and restore pattern in
  `tests/config/feature-flags.test.ts:21-38`.
- The component test uses `renderToStaticMarkup` plus `createElement`, the
  established precedent at `tests/ui/interactive-mode-button.test.ts:1-18`.
  The header-capsule suite asserts the `home.headline` copy renders from the
  key and honors `showHeadline`.
- The route test calls the GET handler directly with the loader mocked,
  following the stage-meta route test style
  (`tests/agent-runtime/stage-meta-routes.test.ts:1-33`).
- The provider-neutrality guard runs in S2. New identifiers contain no
  token or plan segments, verified by inspection.
- The i18n parity check runs in S2. Brand strings bypass locale keys by
  design, so parity is preserved, not weakened.
- Non-capturable deliverables bind through gates only, per the batch A
  substitution rule. `.env.example` entries are gate-bound, never symbol
  targets.
- The import-graph guard test `tests/branding/client-import-graph.test.ts` is
  a gate-bound deliverable. It walks the hook import graph and asserts no
  server-only imports.
- Plan-time state: the `tests/branding/*` suites do not exist yet and fail
  with no marker until they do. The presence gate fails until `SITE_NAME`
  and `SHOW_HEADLINE` land in `.env.example`. These are the documented
  deliverable-dependent failures.

## Out of Scope

- Auth and accounts (batch A). The account slot stays empty in G.
- Gating and minimal-mode semantics (batch C).
- The library grid reflow. G keeps the single-column library as is. Batch C
  expands it into the multi-column grid.
- The admin settings modal for branding (batch E). G reads env and yaml
  only.
- i18n of the brand strings. Operator config is not locale copy.
- Any database schema, migration, or publishable package change.

## Further Notes

- The program record is `docs/meta-specs/rbac-minimal-mode.md`. The round-3
  register lives there. Batch A S03 rides the V2 capsule chrome G delivers.
- The soundness review re-dry-runs every gate in this spec against the live
  CLI before implementation starts.
- The visual-preview checkpoint runs before implementation. The approved
  mockups preview batch C's composer-hiding and multi-column library rule for
  visual sign-off only. G implements none of it.
- Client changes render in localhost and are verified in Safari before
  certification, including the new capsule order and the hero cleanup.
- Commit convention for this batch: `feat(branding): ...`.
- Every new operator-facing env var is documented in `.env.example` in the
  same change (S1).

## Amendment 2026-09-04 (client/server split)

`loadSiteBranding` and its `loadYamlFile` helper moved into
`lib/config/site-branding.server.ts`, and the client module keeps only the
`SiteBranding` type, `SITE_BRANDING_DEFAULTS`, and `readBoolean`. Turbopack
cannot bundle `node:fs` into the client, so the hook import graph must stay
pure, and `tests/branding/client-import-graph.test.ts` guards that. The
change is runtime-proven in the working tree: the home page returns 200, the
route serves the JSON `{ name, tagline, showLogo, showHeadline }`, and Safari
shows a console-clean session. The gate command text is unchanged.
Round-1 verification pinned the six signature strings to outline truth, and
the GET route gained its `: Promise<Response>` annotation.

## Research update (2026-09-04)

### What shipped

Batch G certified both slices. The final state in the working tree:

- S1 shipped the client and server split. `lib/config/site-branding.ts`
  carries the client-safe surface: `readBoolean` at `:13`, the `SiteBranding`
  type at `:17`, and `SITE_BRANDING_DEFAULTS` at `:24`.
  `lib/config/site-branding.server.ts` carries `DEFAULT_FILENAME` at `:13`,
  the module-private `loadYamlFile` at `:20`, and `loadSiteBranding` at
  `:37`. The route `app/api/site-branding/route.ts` runs on `nodejs` at `:4`
  and serves the branding JSON from `GET` at `:10`. The hook
  `lib/hooks/use-site-branding.ts::useSiteBranding` starts at `:16` and
  returns defaults first.
- S2 shipped the capsule and the chrome. `HeaderCapsule` renders at
  `components/header-capsule.tsx:34`, with `HeaderCapsuleProps` at `:25` and
  the `accountSlot` prop at `:31`, rendered at `:115`.
  `app/page.tsx::HomePage` starts at `:125` and `GreetingBar` at `:1250`.
  The logo sites honor `showLogo` at `WorkspaceHome.tsx:48`,
  `WorkspaceRail.tsx:183`, and `SlideNavRail.tsx:52`.
- Four env vars ship, all documented in `.env.example`: `SITE_NAME` at
  `:555`, `SITE_TAGLINE` at `:556`, `SHOW_LOGO` at `:557`, and
  `SHOW_HEADLINE` at `:558`.
- The `home.headline` key ships with the copy "Turn any material into a
  living classroom" (`lib/i18n/locales/en-US.json:14`) with parity across
  all 12 locale files.
- The guard test `tests/branding/client-import-graph.test.ts` ships and
  walks the hook import graph.

### Deviations and surprises

(a) Turbopack failed to bundle `node:fs` into the client, and the failure
surfaced only at runtime after every static gate passed. The client and
server split exists because of it. Lesson: a client-boundary proof must be a
gate for any future module that crosses the server and client boundary.

(b) Round-1 verification rejected both slices for signature-string drift.
The pinned `(): JSX.Element` and the rows pinned as `exists` do not match
outline truth. The fix pinned the six component signatures to the live
outline output. Lesson: pin signatures from live outline captures at ledger
build time, never from spec prose.

(c) The amendment sentence about the GET annotation pre-dated the code
change. The builder caught it during re-anchoring. The annotation now exists
at `app/api/site-branding/route.ts:10`. Lesson: never write completion prose
before the code lands.

(d) The spec row pins `SiteBranding` with kind `type`, while the code
declares an interface (`lib/config/site-branding.ts:17`). The CLI compares
kinds strictly, so the ledger records the interface kind. Lesson: confirm
the kind enum against the outline tool at target-add time.

(e) The multi-line signatures of `WorkspaceHome` and `WorkspaceRail` store
verbatim, at 486 and 1883 characters. Spec tables cannot carry them. The
code-block binding entries are the pattern for multi-line signatures.

(f) rivr caps expect strings at 300 characters. All seven markers are short
literals, so this batch stayed under the cap. Lesson: keep expect strings
short and literal.

(g) `rivr ledger init-batch` is orchestrator-actor-only. The researcher
cannot run it. Lesson: orchestration verbs belong to the orchestrator.

(h) Stage and expectation rewrites are legal only in the research stage.
Outside research every research-stage write exits 2. Lesson: finish
expectation work in research, because later stages freeze the ledger.

### Test results

| Gate | Result | Marker |
| --- | --- | --- |
| S1 unit `tests/branding/site-branding.test.ts` | PASS | BRAND_CFG_OK |
| S1 smoke `tests/branding/site-branding-route.test.ts` | PASS | BRAND_RT_OK |
| S1 smoke `.env.example` presence grep | PASS | BRAND_ENV_OK |
| S2 smoke `npx tsc --noEmit` | PASS | TSC_OK |
| S2 integration `tests/branding/header-capsule.test.ts` | PASS | BRAND_HDR_OK |
| S2 smoke provider-neutrality guard | PASS | NEUTRAL_OK |
| S2 smoke `pnpm check:i18n-keys` | PASS | I18N_OK |

The full suite runs 7498 passing tests with the single pre-existing
env-sensitive failure family documented in prior batches. Safari round-2
verification is console-clean. The batch lands on commits `e11a69e7` and
`15016c2d`.

### Retry accounting

count=3 of 5. Both round-1 deficiencies resolved in one fix pass. No
same-cause escalation: consecutive_same_cause=1.

### What batch A inherits

- The capsule `accountSlot` prop is ready
  (`components/header-capsule.tsx:31`, rendered at `:115`). Batch A renders
  its account menu into it.
- The `useSiteBranding` pattern is proven
  (`lib/hooks/use-site-branding.ts:16`): defaults first, server values
  after, defaults kept on error.
- The runtime-proof requirement. Any future module that crosses the server
  and client boundary needs a runtime proof, not only static gates.
## Certification Report

Certified: 2026-09-04T05:26:48.403Z
Signature: 4ae31ae4aaf2176d6c61c585088a0728dec78de374ec969a1ed92ae30ab1e798

### Summary

Slices: 2
Symbols: 12
Gates: 7

### Implemented Symbols

- **S2** (Header chrome):
  - components/header-capsule.tsx::HeaderCapsule
  - app/page.tsx::HomePage
  - app/page.tsx::GreetingBar
  - components/workbench/workspace/WorkspaceHome.tsx::WorkspaceHome
  - components/edit/SlideNavRail/SlideNavRail.tsx::SlideNavRail
  - components/workbench/workspace/WorkspaceRail.tsx::WorkspaceRail
- **S1** (Branding config and public surface):
  - lib/config/site-branding.ts::SiteBranding
  - lib/config/site-branding.ts::SITE_BRANDING_DEFAULTS
  - lib/config/site-branding.ts::readBoolean
  - lib/config/site-branding.server.ts::loadSiteBranding
  - app/api/site-branding/route.ts::GET
  - lib/hooks/use-site-branding.ts::useSiteBranding

### Gates Passed

- **S2**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"TSC_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/branding/header-capsule.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/branding/header-capsule.test.ts \u001b[2m(\u001b[22m\u001b[2m2 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 7\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m2 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m\n\u001b[2m   Start at \u001b[22m 17:20:41\n\u001b[2m   Duration \u001b[22m 174ms\u001b[2m (transform 37ms, setup 14ms, import 86ms, tests 7ms, environment 0ms)\u001b[22m\n\nBRAND_HDR_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/providers/provider-neutrality-guard.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/providers/provider-neutrality-guard.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 37\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 17:20:42\n\u001b[2m   Duration \u001b[22m 387ms\u001b[2m (transform 88ms, setup 15ms, import 273ms, tests 37ms, environment 0ms)\u001b[22m\n\nNEUTRAL_OK\n","passed":true}
  - g4: {"id":"g4","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 check:i18n-keys /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> node scripts/check-i18n-keys.mjs\n\ni18n key alignment check passed (12 locale files, source: en-US.json).\nI18N_OK\n","passed":true}
- **S1**:
  - g1: {"id":"g1","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/branding/site-branding.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/branding/site-branding.test.ts \u001b[2m(\u001b[22m\u001b[2m13 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 4\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m13 passed\u001b[39m\u001b[22m\u001b[90m (13)\u001b[39m\n\u001b[2m   Start at \u001b[22m 17:20:27\n\u001b[2m   Duration \u001b[22m 102ms\u001b[2m (transform 20ms, setup 14ms, import 17ms, tests 4ms, environment 0ms)\u001b[22m\n\nBRAND_CFG_OK\n","passed":true}
  - g2: {"id":"g2","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"\n> openmaic@1.0.0 test /Users/franky/Projects/MyOpenMAIC/Source/openMAIC\n> vitest run tests/branding/site-branding-route.test.ts\n\n\n\u001b[1m\u001b[30m\u001b[46m RUN \u001b[49m\u001b[39m\u001b[22m \u001b[36mv4.1.8 \u001b[39m\u001b[90m/Users/franky/Projects/MyOpenMAIC/Source/openMAIC\u001b[39m\n\n \u001b[32m✓\u001b[39m tests/branding/site-branding-route.test.ts \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[32m 4\u001b[2mms\u001b[22m\u001b[39m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (1)\u001b[39m\n\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n\u001b[2m   Start at \u001b[22m 17:20:27\n\u001b[2m   Duration \u001b[22m 120ms\u001b[2m (transform 19ms, setup 14ms, import 38ms, tests 4ms, environment 0ms)\u001b[22m\n\nBRAND_RT_OK\n","passed":true}
  - g3: {"id":"g3","shell":"/bin/sh","cwd":"/Users/franky/Projects/MyOpenMAIC/Source/openMAIC","exit":0,"pathHash":"1bf61d2260bdd3fbe5be372aa11d01730dd2191c30d8d8a798ff0dfdfe6610e9","pathCount":30,"output":"BRAND_ENV_OK\n","passed":true}

Certification hash: 4ae31ae4aaf2176d6c61c585088a0728dec78de374ec969a1ed92ae30ab1e798
Certified: 2026-09-04T05:26:48.403Z | Signature: 4ae31ae4aaf2176d6c61c585088a0728dec78de374ec969a1ed92ae30ab1e798 | Certifier: verifier
