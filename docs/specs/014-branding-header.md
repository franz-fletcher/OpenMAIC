# Batch 014 spec: branding-header

Spec status: implementation

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
| `lib/config/site-branding.ts::SITE_BRANDING_DEFAULTS` | constant | shape `{ name: 'OpenMAIC', tagline: '', showLogo: true, showHeadline: true }` | the fallbacks when env and yaml say nothing |
| `lib/config/site-branding.ts::loadSiteBranding` | function | `(): SiteBranding` | merges defaults, yaml, then env. Env wins. `SHOW_LOGO` and `SHOW_HEADLINE` parse with `readBoolean` semantics |
| `app/api/site-branding/route.ts::GET` | function | `(): Promise<Response>` | returns `{ name, tagline, showLogo, showHeadline }` publicly, no PII, no auth, Node runtime |
| `lib/hooks/use-site-branding.ts::useSiteBranding` | function | `(): SiteBrandingState` | returns defaults first, then the fetched values |

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
throw. `SHOW_LOGO` and `SHOW_HEADLINE` default to shown.

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
| `components/header-capsule.tsx::HeaderCapsule` | component | exists | renders language, theme, Pro toggle, account slot, gear in that exact order. The account slot renders null through a prop in G. The gear, theme, and language behaviors stay unchanged in function. The Pro toggle acts as the workbench entry affordance, the same intent as today's hero ProBadge routing. Its visibility stays ungated in G |
| `app/page.tsx::HomePage` | function | `(): JSX.Element` | modified: top-left name and tagline from `useSiteBranding`. Right side renders `HeaderCapsule` with an empty account slot. Hero logo and tagline removed. `GreetingBar` no longer rendered. The hero renders the `home.headline` i18n key gated by `showHeadline`, with 12-locale parity |
| `app/page.tsx::GreetingBar` | function | `(): JSX.Element` | modified: retired from the home hero, no render site remains |
| `components/workbench/workspace/WorkspaceHome.tsx::WorkspaceHome` | component | exists | modified: hero logo honors `showLogo` |
| `components/edit/SlideNavRail/SlideNavRail.tsx::SlideNavRail` | component | exists | modified: rail logo honors `showLogo` |
| `components/workbench/workspace/WorkspaceRail.tsx::WorkspaceRail` | component | exists | modified: rail logo honors `showLogo` |

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