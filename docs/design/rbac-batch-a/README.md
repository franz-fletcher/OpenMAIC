# Batch A/G UI Preview — `feature:rbac-minimal-mode`

Pixel-faithful static mockups of the auth client surfaces (S03 of
`docs/specs/013-rbac-auth-foundation.md`) **plus the Round 3 revisions** from
the user's annotated home screenshot (`docs/research/rbac-minimal-mode-decision-round-1.md`
§Round 3, binding). **No app code changed; no routes added to the real app.**
Approval gate: the human reviews these in Safari, then implementation starts.

Served from: `python3 -m http.server 3100 --directory docs/design/rbac-batch-a`
→ **http://localhost:3100/** (nav page). Every mockup is self-contained
(Google Fonts Inter with the app's fallback chain; implementation must use the
app's existing `@fontsource-variable/inter`). All tokens in `styles.css` are
copied verbatim from `app/globals.css`.

## Surfaces

### Round 3 revisions (binding — working set)

| Surface | Page | States |
|---|---|---|
| Header (batch G, canonical) | `header-v2-rev.html` | R-1 signed out · R-2 learner dropdown · R-3 admin dropdown |
| Home — full mode (creator/admin) | `home-full.html` | F-01 headline + composer, no logo/tagline/GreetingBar |
| Home — minimal mode (anon/guest/learner) | `home-minimal.html` | M-1 populated 2-3-4 grid · M-2 guest empty + featured row (batch D preview) |
| Footer + logo toggle | `footer.html` | G-1 SHOW_LOGO false \| true |

### Approved batch A surfaces (unchanged)

| Surface | Page | States |
|---|---|---|
| Signup `/signup` | `signup.html` | S-01 base · S-02 validation errors · S-03 already registered · S-04 check-your-email |
| Login `/login` | `login.html` | L-01 base · L-02 unverified + resend · L-03 wrong credentials · L-04 success |
| Verify `/verify` | `verify.html` | V-01 verified (auto sign-in) · V-02 invalid/expired |
| Header V1 — home pill (superseded) | `header-v1.html` | kept for reference only; **rejected** |
| Header V2 — capsule precursor | `header-v2.html` | account-zone component precursor; lives on in `header-v2-rev.html` |

Screenshots (Safari, 1440 CSS px, light + dark): `shots/` (files `*-rev.png`,
`home-full-*.png`, `home-minimal-*.png`, `footer-*.png` are the Round 3 set).

---

## Round 3 decisions (recorded here as resolved)

- **Q1 resolved → V2.** The account zone sits in the top header capsule
  (stage/classroom style). The hero GreetingBar **retires** (Q2 resolved: the
  local-only profile seat is gone; server profile surfaces arrive later).
- **Hero:** the OpenMAIC logo + `home.slogan` tagline are removed from the home
  page. The header top-left becomes a configurable site lockup.
- **Capsule order (binding):** language → theme → **Pro toggle** → **account
  zone** → settings gear (gear stays last).
- **Minimal-mode layout rule** (anon/guest/learner; behavior ships batch C,
  layout defined by batch G): the entire composer + generation-toolbar
  container is hidden; the course/folder library expands into the responsive
  2-3-4 grid filling the freed space.
- **SHOW_LOGO** env/yaml toggle governs every logo-bearing surface, including
  the footer (`footer.html`).

Branding config keys **approved in Round 3** (land in batch G, spec
`014-branding-header` — env + `server-branding.yml`, same defaults-then-DB
doctrine, admin override in batch E):

| Key | Meaning | Example in mockups |
|---|---|---|
| `SITE_NAME` | Site display name (header lockup, text surfaces) | `MAIC` |
| `SITE_TAGLINE` | One-line descriptor under the name | `Learn anything, together` |
| `SHOW_LOGO` | Hide/show the OpenMAIC logo mark site-wide | footer G-1 |

The mockups render a small `config-badge` ("env · yaml") beside the tagline to
tell operators the text is config-driven, not code. **Note:** the badge copy is
operator-facing, not user-facing — implement it outside the i18n gate (code
tooltip is fine).

---

## Proposed i18n keys

`auth.*` namespace (S03) + new Round 3 keys. All 12 locale files need parity at
implementation (`pnpm check:i18n-keys` is the S03 gate).

### nav / account menu
```
auth.nav.signIn                "Sign in"
auth.nav.createAccount         "Create account"
auth.account.menu              "Account menu"                    // aria-label of the trigger
auth.account.title             "Account"
auth.account.settings          "Settings"                        // admin only, stub until batch E
auth.account.admin             "Admin"                           // admin only, stub until batch E
auth.account.signOut           "Sign out"
auth.account.language          "Language"                        // V1-only dropdown (superseded); V2 drops it (switcher adjacent)
auth.common.soon               "Soon"                            // stub badge + tooltip
auth.common.soonTooltip        "Arrives in a later release"
```

### role badges
```
auth.roles.guest               "Guest"
auth.roles.learner             "Learner"
auth.roles.creator             "Creator"
auth.roles.admin               "Admin"
```

### signup
```
auth.signup.title              "Create your account"
auth.signup.subtitle           "Join OpenMAIC to save classrooms, keep your course library, and pick up where you left off."
auth.signup.email              "Email"
auth.signup.password           "Password"
auth.signup.confirmPassword    "Confirm password"
auth.signup.passwordHint       "At least 8 characters, with letters and numbers."
auth.signup.submit             "Create account"
auth.signup.haveAccount        "Already have an account?"
auth.signup.signInLink         "Sign in"
auth.signup.validation.weakPassword       "Password is too weak — use 8+ characters with letters and numbers."
auth.signup.validation.checkCharCount     "8+ characters"
auth.signup.validation.checkMix           "Letters and numbers"
auth.signup.validation.checkNotEmail      "Different from your email"
auth.signup.validation.passwordMismatch   "Passwords do not match."
auth.signup.validation.emailInvalid       "Enter a valid email address."
auth.signup.errors.emailExists            "An account with this email already exists."
auth.signup.errors.signInInstead          "Sign in instead"
auth.signup.pending.title                 "Check your email"
auth.signup.pending.body                  "We sent a verification link to {email}. Open it to activate your account. You can close this tab."
auth.signup.pending.openMail              "Open email app"
auth.signup.pending.resend                "Resend verification email"
auth.signup.pending.spamHint              "Make sure to check your spam folder if it doesn't arrive in a few minutes."
auth.signup.pending.restart               "Start over with a different email"
```

### signin
```
auth.signin.title                "Welcome back"
auth.signin.subtitle             "Sign in to access your classrooms, course library, and saved sessions."
auth.signin.email                "Email"
auth.signin.password             "Password"
auth.signin.submit               "Sign in"
auth.signin.forgot               "Forgot password?"
auth.signin.forgotSoon           "Soon"
auth.signin.forgotTooltip        "Password reset ships in a later release"
auth.signin.forgotNote           "Password reset is planned for a later release — including a forgot-password flow here is deliberately deferred."
auth.signin.errors.invalidCredentials   "Incorrect email or password."
auth.signin.errors.invalidCredentialsDetail "Check both fields and try again."
auth.signin.errors.passwordIncorrect   "The password you entered is incorrect."
auth.signin.unverified.title     "Verify your email to sign in."
auth.signin.unverified.body      "We sent a verification link to {email}."
auth.signin.unverified.resend    "Resend verification email"
auth.signin.success              "Signed in — welcome back, {name}."
auth.signin.redirecting          "Redirecting to your home"
```

### verify
```
auth.verify.success.title        "Email verified"
auth.verify.success.body         "Your email is verified and you're signed in. Welcome to OpenMAIC, {name}."
auth.verify.success.continue     "Go to my home"
auth.verify.success.claimNote    "Your anonymous classroom library was carried over to this account."
auth.verify.failure.title        "Link invalid or expired"
auth.verify.failure.body         "This verification link has expired or was already used. Enter your email below and we'll send a fresh one."
auth.verify.failure.email        "Email"
auth.verify.failure.submit       "Send new link"
auth.verify.failure.loginResend  "resend from the sign-in page"
```

### home + library (Round 3 additions)
```
home.headline                    "Turn any material into a living classroom"   // full-mode hero (new; home.slogan is retired to SITE_TAGLINE)
classroom.sortRecent             "Recent"        // new sort affordance on the library header line
classroom.sortName               "Name"
classroom.sortOldest             "Oldest"
classroom.emptyTitle             "Your library is empty"                       // minimal-mode empty state
classroom.emptyGuestBody         "Sign in to create classrooms, keep folders, and carry your progress across devices. Until then, explore what the community is building."
classroom.browseFeatured         "Browse featured"
classroom.featured               "Featured"                                    // batch D placeholder row (M-2)
classroom.featuredSub            "Public courses from the community"
classroom.featuredBy             "by {author} · {rating}★"                    // test data; batch D will finalize
classroom.sortAria               "Sort library"
```

### mailer (proposed; server-side copy — same parity question as Q9)
```
auth.email.verifySubject         "Verify your OpenMAIC email"
auth.email.verifyBody            "Hello {name}, activate your account by opening the link below. It expires in 24 hours."
auth.email.verifyCta             "Verify my email"
```

### Deprecations
- `home.slogan` ("Generative Learning in Multi-Agent Interactive Classroom")
  is replaced by the operator-configurable `SITE_TAGLINE`; remove the key when
  batch G lands (flag for i18n cleanup).
- `classroom.emptyLibraryHint` ("No courses yet — create one above...") stays
  for full mode; minimal mode uses `classroom.emptyTitle`/`classroom.emptyGuestBody`.

---

## Open design questions

- **Q3 — verify-page resend needs an email input.** An unparseable/expired
  token carries no email, so the resend action on `/verify` needs the small
  inline email field (V-02). Spec S03 says the verify page renders "verification
  status and resend action" — V-02 keeps the form.
- **Q4 — admin stubs copy.** Product-facing "Soon" + tooltip (shown) vs
  dev-facing "Batch E". Recommended: "Soon"; the batch-E note lives in code
  comments.
- **Q5 — sign-in redirect target.** `returnTo` (pre-sign-in route, home if
  absent) recommended; batch A can ship plain "→ /" first. The success state
  shows "redirecting to your home".
- **Q6 — Guest badge (updated by Round 3).** With minimal mode, anonymous
  users sit at Guest rank, so **Guest becomes the FIRST role badge a real user
  ever sees** (before Learner). The R-series mockups keep the signed-out account
  zone badge-free ("Sign in" pill). Open sub-question: should anonymous show a
  Guest badge + menu (avatar-less identity) instead of the plain pill in batch C?
  One-line swap either way; the `auth.roles.guest` key exists.
- **Q7 — toast placement.** Sonner bottom-right default (L-04). Keep default.
- **Q8 — password policy source of truth.** Client validator and server error
  mapping must agree (min-8 + letter/number assumed from better-auth defaults).
- **Q9 — mailer copy i18n.** Recommend keys + en-US source of truth.
- **Q10 — footer text under SHOW_LOGO=false.** The today footer is the text
  "OpenMAIC Open Source Project". Under SHOW_LOGO=false the mockup uses the
  configured site name ("MAIC Open Source Project"); decide whether the text
  follows `SITE_NAME` or stays the hardcoded brand string.

Resolved by Round 3 (no longer open): Q1 (V2), Q2 (retire GreetingBar), plus
the new approved branding keys `SITE_NAME` / `SITE_TAGLINE` / `SHOW_LOGO` and
`server-branding.yml`.

---

## Deviations from existing component idioms (and why)

The approved batch A list (1-10) stands — see below for the Round 3 additions.
Base list from the batch A review:

1. Auth surfaces reuse the composer-card recipe, not `Card`.
2. 400px auth form column (forms beat full-width fields).
3. Static background blobs (hero's pulse removed on auth pages).
4. "Soon" pill as the honest stub idiom.
5. Role badge is a new scoped class (uniform tint; admin destructive-tinted).
6. Dropdown identity header (initials + name + email + badge).
7. Signed-in home pill stacks name over badge (superseded by V2 capsule).
8. Forgot-password present-but-deferred.
9. Cyan for info/success states.
10. Toast in login-success only (sonner bottom-right look).

### Round 3 additions

11. **Site lockup in the header** (name 17px bold over 12px tagline) replaces
    the hero logo/tagline. New component; modeled on the stage-title kicker
    pattern (components/header.tsx:77-87) inverted. `config-badge` beside the
    tagline is operator-only.
12. **Pro toggle relocated into the capsule** (binding order language → theme →
    Pro → account → gear). Was a sibling pill outside the capsule in
    `header-controls.tsx:219-261`; now uses the **compact** variant recipe
    (h-32px, tighter padding) so the capsule stays h-9.
13. **Sort pill added to the library header line** in minimal mode. Today the
    library row has search/import/new-folder but no sort; minimal mode surfaces
    it because the grid is the primary content.
14. **Minimal-mode empty state + featured placeholder row.** The featured row's
    "batch D gallery preview" marker is a preview-only annotation — it MUST NOT
    ship; it flags the future gallery contract only.
15. **Footer logo toggle.** Under SHOW_LOGO=true the footer gains the horizontal
    lockup image above the existing text line; false keeps text-only (uses
    `SITE_NAME`, see Q10).
16. **Headline copy is new** (`home.headline`). The hero had no headline before
    (logo + slogan only); with those retired to the lockup, the full-mode hero
    needed an anchor line.

## Verification checklist

- [ ] Opens at http://localhost:3100/ (python http.server, port 3100)
- [ ] All artboards render in Safari with zero console errors (static pages)
- [ ] Light + dark screenshots captured to `shots/` (Round 3 set: `header-v2-rev-*`,
      `home-full-*`, `home-minimal-*`, `footer-*`)
- [ ] Tokens verified against `app/globals.css` (oklch values, radius, button/input/dropdown recipes)