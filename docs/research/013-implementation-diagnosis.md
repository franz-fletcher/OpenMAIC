# Batch A Implementation Diagnosis (2026-09-04)

Scope: `013-rbac-auth-foundation`, stage `implementation`, all five slices marked
`ready_for_verification`, tree uncommitted. Two implementer runs were cancelled
mid-wiring. This diagnosis was run directly by the orchestrator with fresh
commands. No code was changed by this document.

## Verdict

Batch A is structurally complete and statically healthy. Two must-fix items
block the verification round: a dev-database ownership break (signup 500s at
runtime) and four ledger signature drifts that `rivr diff` will reject.

## Checks run, with evidence

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Ledger audit | PASS | `Audit chain valid: 122 entries`; stage `implementation`; 5/5 marks |
| 2 | Typecheck | PASS | `npx tsc --noEmit` clean |
| 3 | Auth suites, hermetic | PASS | 30 passed, 2 skipped (`claim.pg.test.ts`, no `PG_CONTRACT_URL`), 0 failed |
| 4 | Full suite | PASS with known | 7528 passed / 1 failed / 33 skipped |
| 5 | The 1 failure is pre-existing | CONFIRMED | `tests/agent-runtime/runner-skills-registration.test.ts:255` fails identically on clean main with the batch stashed (`git stash` -> fail -> `stash pop`, 31 entries restored). Cause: `web_search` now registers before `create_skill`; batch A never touched tool order |
| 6 | Pages and routes live | PASS | `/`, `/signup`, `/login`, `/verify`, `/api/site-branding` all 200 |
| 7 | Live signup POST | FAIL | `POST /api/auth/sign-up/email` -> 500, empty body |
| 8 | Schema present | PASS | All six auth tables exist in the dev `openmaic` DB |
| 9 | Table ownership | ROOT CAUSE | `user`, `session`, `account`, `verification`, `roles`, `user_roles` are owned by role `franky`; the app connects as `openmaic` -> `permission denied for table roles`. `stage_meta` is correctly owned by `openmaic` |
| 10 | Probe hygiene | PASS | 0 probe rows created (the 500 fires before insert) |
| 11 | Signature fidelity vs ledger | 6/10 match | `createAuthServer`, `getSession`, `requireSession`, `listRoles` (both files), `claimAnonOwnership`, `ensureAuthSchema` match their pinned strings |

## Diff-risk table (would reject in the verification round)

| Row | Pinned | Live source | Fix route |
| --- | --- | --- | --- |
| `lib/server/agent-runtime/with-owner.ts::withRequestOwnerId` | `(req: Pick<Request, 'headers'>, handler: OwnerHandler): Promise<Response>` | inline expanded handler type, no `OwnerHandler` name | CODE: add the `OwnerHandler` type alias |
| `lib/auth/client.ts::createAuthClient` | `(opts: AuthClientOptions): AuthClient` | `(options: AuthClientOptions = {})` | CODE: rename param to `opts`, drop the default, update the four call sites (`components/account-zone.tsx:13`, `app/verify/page.tsx:9`, `app/signup/page.tsx:8`, `app/login/page.tsx:9`) to pass `{}` |
| `lib/auth/mailer.ts::createMailer` | `(env: MailerEnv): Mailer` | `(env: MailerEnv, deps: {...} = {}): Mailer` | LEDGER: re-pin to outline truth; the deps seam is deliberate test injection |
| `lib/auth/mailer.ts::sendVerificationLink` | `(to: string, url: string): Promise<void>` | `(mailer: Mailer, to: string, url: string): Promise<void>` | LEDGER: re-pin; the mailer param is deliberate DI |

## Completion plan, ordered

1. MUST-FIX, DB repair (implementer): `ALTER TABLE ... OWNER TO openmaic` for
   the six auth tables in the local dev database. Then re-run the live chain:
   signup 200 -> user row -> verification token -> verify -> login cookie ->
   `user_roles` shows guest. Delete probe rows and list them.
2. MUST-FIX, code pins (implementer): the two CODE rows above; then re-run the
   affected ledger gates byte-exact (`AUTH_CORE_OK`, `SESSION_RT_OK`,
   `TSC_OK`, plus any suite importing the changed modules).
3. MUST-FIX, ledger pins (researcher + orchestrator): the two LEDGER rows
   above. The spec's binding-table strings for `createMailer` and
   `sendVerificationLink` are rewritten to outline truth, then
   `rivr spec amend --action correction`, re-pin postconditions and symbol
   expectations at research, advance to implementation.
4. THEN verification round: fresh verifier, `rivr diff` both expectations and
   all 19 gates, Safari after-state, verdicts.
5. SHOULD-FIX, deferred: `pnpm check` reports pre-existing formatting drift in
   `docs/design/rbac-batch-a/*` (mockups, batch G artifacts). Not batch A
   scope; schedule with the next docs touch.
6. OBSERVATIONS: better-auth logs a `baseURL not set` warning in dev; set
   `BETTER_AUTH_URL` or the options `baseURL` at deploy time. The runner-skills
   registration failure on main deserves its own fix ticket (tool order vs
   assertion), unrelated to this program.

## Attribution note

The cancelled runs left the tree better than expected: the kysely
`PostgresDialect` wiring and the guest-default `databaseHooks` are present and
typed (`lib/auth/server.ts:37-77`), `package.json` carries
`better-auth ~1.7.2`, `nodemailer ^9.1.1`, `resend ^6.26.0`, `kysely ^0.29.5`,
and the lockfile is consistent. The only orphan was the untested runtime path,
which item 1 covers.
