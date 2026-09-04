# Batch A UI Preview — `feature:rbac-minimal-mode`

Pixel-faithful static mockups of every client surface in the auth foundation slice
(S03 of `docs/specs/013-rbac-auth-foundation.md`). **No app code changed; no routes
added to the real app.** Approval gate: the human reviews these in Safari, then
implementation starts.

Served from: `python3 -m http.server 3100 --directory docs/design/rbac-batch-a`
→ **http://localhost:3100/** (nav page). Each mockup page is self-contained
(Google Fonts Inter with the app's fallback chain; implementation must use the
app's existing `@fontsource-variable/inter`). All tokens in `styles.css` are
copied verbatim from `app/globals.css`.

| Surface | Page | States |
|---|---|---|
| Signup `/signup` | `signup.html` | S-01 base · S-02 validation errors · S-03 email already registered · S-04 check-your-email pending |
| Login `/login` | `login.html` | L-01 base (forgot-password "Soon") · L-02 unverified + resend · L-03 wrong credentials · L-04 success redirect |
| Verify `/verify` | `verify.html` | V-01 verified (auto sign-in) · V-02 invalid/expired + resend |
| Header V1 — home GreetingBar seat | `header-v1.html` | H1-01 guest before · H1-02 learner signed-in (dropdown) · H1-03 admin signed-in (dropdown) |
| Header V2 — stage capsule | `header-v2.html` | H2-01 guest before · H2-02 learner signed-in (dropdown) · H2-03 admin signed-in (dropdown) |

Screenshots (Safari, 1440 CSS px, light + dark): `shots/`.

---

## Proposed `auth.*` i18n keys (en-US source of truth)

New namespace `auth`. All 12 locale files need parity at implementation
(`pnpm check:i18n-keys` is the S03 gate — see README-standard table in spec §S03).

### nav / account menu
```
auth.nav.signIn                "Sign in"
auth.nav.createAccount         "Create account"
auth.account.menu              "Account menu"                    // aria-label of the trigger
auth.account.title             "Account"
auth.account.settings          "Settings"                        // admin only, stub until batch E
auth.account.admin             "Admin"                           // admin only, stub until batch E
auth.account.signOut           "Sign out"
auth.account.language          "Language"                        // V1 only (dropdown), V2 skips (switcher adjacent)
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

### mailer (proposed; server-side copy, needs the same parity decision — open question Q9)
```
auth.email.verifySubject         "Verify your OpenMAIC email"
auth.email.verifyBody            "Hello {name}, activate your account by opening the link below. It expires in 24 hours."
auth.email.verifyCta             "Verify my email"
```

---

## Open design questions (for the human)

- **Q1 — V1 vs V2 placement.** This preview shows both; see the tradeoff note at
  the bottom of this README and on `index.html`. S03's header work depends on the pick.
- **Q2 — local-only GreetingBar fate.** Today the GreetingBar pill is a
  localStorage profile (nickname/avatar/bio, `useUserProfileStore`). V1 replaces
  it with the account zone when signed out/in. Should the local profile editor
  (avatar picker + bio) die with the seat, or move under
  Account → Profile until a server-side profile exists (batch C)? Recommended:
  retire it from the hero; do not ship two competing "profile" affordances.
- **Q3 — verify-page resend needs an email input.** An unparseable/expired token
  carries no email, so the resend action on `/verify` needs a small inline email
  field (V-02). Alternative: only ever route resend through `/login` and drop the
  verify-page form — but spec S03 says the verify page renders "verification
  status and resend action", so V-02 keeps the form.
- **Q4 — admin stubs copy.** Product-facing "Soon" + tooltip (shown) vs
  dev-facing "Batch E". Recommended: "Soon" (users should never read batch
  names); the batch-E note lives in code comments.
- **Q5 — sign-in redirect target.** `returnTo` (pre-sign-in route, home if
  absent) is recommended; batch A can ship plain "→ /" first. Needs an explicit
  decision since the success state mockup shows "redirecting to your home".
- **Q6 — role badge for Guest rank.** Signed-in users are at least Learner by
  construction (signup seeds learner), so Guest badge never renders on a session.
  Keep the key for future guest-mode sessions or drop it? Recommended: keep the
  key; batch C minimal mode may surface guest sessions.
- **Q7 — toast placement.** Sonner default is bottom-right (L-04 shows it).
  Keep default; app has no toast-position precedent to match.
- **Q8 — password policy source of truth.** Mockup checklist assumes min-8 +
  letter+number (better-auth default). Client validator and server error mapping
  must agree; the en-US copy above is the source of truth.
- **Q9 — mailer copy i18n.** The mailer template strings need the same
  locale-parity treatment or they ship English-only. Recommend keys + en-US
  source of truth; note that mail copy is read by email clients, not the app UI.

---

## Deviations from existing component idioms (and why)

1. **Auth surfaces use the composer-card recipe, not `Card`.** `auth-card` =
   the home composer's exact surface (`rounded-2xl border-border/60
   bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl`); matches hero
   typography scale (same logo height 48px, `text-sm` secondary text) without
   inventing a new card language. Slight padding reduction (24px) for forms.
2. **400px form column, not the 800px composer width.** Forms at 65–75ch read
   better than 800px fields; CTA is full-width inside the 400px card.
3. **Static background blobs on auth pages.** Same blue/purple blobs as the
   hero (`blob-blue`/`blob-purple`) but not pulsing (`animate-pulse` removed) —
   auth pages should feel calm, not kinetic. Trivial change; flagging so nobody
   "fixes" the mismatch.
4. **"Soon" pill as the honest stub idiom.** The repo precedent for
   not-ready-actions is the disabled Export button (`header-controls.tsx:270-282`,
   `share.notReady`). For menu entries that must still be *visible* (admin
   Settings/Admin) I used a muted uppercase "Soon" pill + disabled styling +
   title tooltip rather than hiding or fully enabling. New but small; reuses the
   `disabled:opacity-50` language of shadcn items.
5. **Role badge is a new token.** `role-badge`: brand-tinted `--primary` 10%
   surface, uppercase micro-label, uniform tint across Learner/Creator, admin
   gets a destructive-tinted variant. Two reasons: (a) hierarchy must not ride
   color alone, so rank is text + position; (b) the only existing badge recipe
   is `ProBadge` (workbench-specific) and the `Server` badge (settings) — neither
   fits a rank label. Carves no new global token; scoped class only.
6. **Dropdown identity header.** The account menu adds a non-interactive header
   row (initials avatar + name + email + role badge) above the first menu item —
   an extension of the shadcn `DropdownMenuContent` pattern. Precedent: the
   GreetingBar expanded panel (`app/page.tsx:1489`, white/95 rounded-2xl
   identity row). Menu keeps shadcn `min-w`, padding, ring, and item recipes.
7. **Signed-in home pill shows name + badge stacked, not on one line.**
   The GreetingBar pill is 32px tall by design (`px-2.5 py-1.5`, 13px name); a
   three-item single line (avatar + name + badge + chevron) would crowd at
   13px. Stacking name over badge keeps the hero pill compact and the badge
   legible. V2 capsule uses one-line (26px avatar, 12px name) because capsule
   controls are smaller by design.
8. **Forgot-password is present-but-deferred, not absent.** Spec S03 has no
   reset flow, so the link exists as muted, non-navigating text with a "Soon"
   pill, a native tooltip, and one deferral note under the form (L-01). The
   alternative — hiding the link entirely — read worse in review: users
   actively look for it.
9. **Cyan for informational/success states.** Success check + info banners use
   the app's existing cyan tint (`bg-cyan-50 dark:bg-cyan-950/40`,
   `text-cyan-700 dark:text-cyan-300` from the vocational-test toggle,
   `app/page.tsx:983`); green is reserved for the raw success check (emerald
   pair). No new global semantic token is introduced; both colors stay inline.
10. **Toast shown only in the login-success artboard.** The app does not yet
    have a toast-style precedent in these surfaces; mock uses sonner's
    bottom-right look. Copy in Q7.

## V1 vs V2 — tradeoff (3 sentences)

**V1 (home GreetingBar seat)** wins on identity prominence and dares to explain
itself: the hero is the only place a guest sees "Sign in / Create account" as a
real action, and signed-in the pill reads as "this is your workspace identity".
**V2 (stage capsule)** is mechanically invisible — it reuses the existing
capsule seam, keeps the gear last, and costs zero new layout, but it lives
inside a chrome element whose language/theme/gear neighbors are utilities, not
identity, so account actions read as secondary and the guest state is
plain "nothing here". **Recommendation: V1 for the account zone**, because
batch A's job is making identity legible, and the hero seat is the only surface
where that legibility is free; V2 remains the right *stage/classroom* placement
for the same control (they are two placements of one component, not rivals).

## Verification checklist

- [ ] Opens at http://localhost:3100/ (python http.server, port 3100)
- [ ] All artboards render in Safari with zero console errors (static pages)
- [ ] Light + dark screenshots captured to `shots/`
- [ ] Tokens verified against `app/globals.css` (oklch values, radius, button/input/dropdown recipes)