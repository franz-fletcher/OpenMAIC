# Verification report: batch 015 permission-core

Verifier: independent evidence agent, no authorship, no ledger writes.
Date 2026-09-05. Ledger: `.rivr/specs/015-permission-core.ledger.json`.
Spec: `docs/specs/015-permission-core.md`. Branch: `main`.

## Verdict summary

The four ledger verdicts are recorded and the audit chain is valid. All four slices verify. Round 1 recorded four `verify_mark` entries, audit seq 71 through 74. The pre-round pin re-anchor is audit seq 65 with the follow-up re-pins at seq 66 through 68. The diff classifies 12 of 12 targets as matches after re-anchor. Thirteen gate runs carry exit 0 and passed true. This report adds the two missing artifacts: the Safari guest-state evidence and the runtime probe evidence. The report records one fresh runtime finding that the gates do not see.

## Gate evidence table

All 13 runs came from `rivr slice verify --run-gates` on 2026-09-05. The ledger stores the shell, cwd, exit code, output, and marker for each. Every run is exit 0.

| Slice | Tier | Gate | Check | Marker | Result |
| --- | --- | --- | --- | --- | --- |
| S1 | 2 | g1 | permissions-core unit | PERM_CORE_OK | pass, 37 tests |
| S1 | 2 | g2 | tsc smoke | TSC_OK | pass |
| S1 | 2 | g3 | provider-neutrality guard | NEUTRAL_OK | pass, 3 tests |
| S2 | 3 | g1 | role-permissions unit | ROLE_PERM_OK | pass, 9 tests |
| S2 | 3 | g2 | role-permissions pg contract | ROLE_PERM_PG_OK | pass, 7 tests |
| S2 | 3 | g3 | tsc smoke | TSC_OK | pass |
| S3 | 3 | g1 | require-permission unit | REQPERM_OK | pass, 7 tests |
| S3 | 3 | g2 | quiz-grade gate integration | QUIZ_GATE_OK | pass, 6 tests |
| S3 | 3 | g3 | tsc smoke | TSC_OK | pass |
| S4 | 3 | g1 | use-permissions unit | PERMS_CLI_OK | pass, 7 tests |
| S4 | 3 | g2 | permissions-route integration | PERMS_ROUTE_OK | pass, 5 tests |
| S4 | 3 | g3 | client-import-graph unit | PERMS_GRAPH_OK | pass, 1 test |
| S4 | 3 | g4 | i18n parity smoke | I18N_OK | pass, 12 locales |

Marker totals: PERM_CORE_OK, TSC_OK x3, NEUTRAL_OK, ROLE_PERM_OK, ROLE_PERM_PG_OK, REQPERM_OK, QUIZ_GATE_OK, PERMS_CLI_OK, PERMS_ROUTE_OK, PERMS_GRAPH_OK, I18N_OK. That is 13 markers for 13 runs. The unit and integration suites total 79 tests across 8 files. The tier rule holds. S2, S3, and S4 each carry the required integration gate.

## Diff evidence

Twelve targets exist across the four slices: S1 has 3, S2 has 2, S3 has 3, S4 has 4. Every target carries `postcondition_quality: VERIFIED`. The pre-round diff risk check found three S4 prose pins deviating from outline truth. Audit seq 65 records the `spec_amend` that re-anchored them, and seq 66 through 68 record the researcher postcondition re-pins for GET, PermissionGate, and AccountZone. The fresh diff after re-anchor classifies 12 of 12 as matches. No missing lines. No unexpected lines. No phantom targets.

## Runtime + Safari

### Verified guest through the live API

The dev server runs on port 3000 and its stdout is not observable. The probe created a verified guest through the live endpoints. Signup returned 200 with a user row. The verification token was minted as an HS256 JWT signed with the effective secret and verified through `GET /api/auth/verify-email`, which returned 302. Sign-in returned 200 with `better-auth.session_token`. The database confirmed the rows: the four system roles seeded with guest at rank 1, the probe user with `emailVerified=true`, and the `user_roles` row linking the user to guest rank 1.

### Fresh runtime finding: the session seam breaks at runtime

The permissions route returns `{"permissions":[]}` for the signed-in verified guest. The expected value is `["quiz.grade"]`. The quiz-grade route returns 403 permission_denied for the same guest. Anonymous also returns 403, which is correct. So the guest allow path fails on the live wire.

Root cause chain:

1. `lib/auth/server.ts:101-102`. `apiCall` builds the internal request as `new Request('/api/auth/get-session', init)`. The URL is relative.
2. Node's undici Request rejects relative URLs. A direct check throws `TypeError: Failed to parse URL from /api/auth/get-session`.
3. `lib/auth/index.ts:43-64`. `getSession` calls `apiCall` inside try and catch, then returns null on any throw.
4. `lib/auth/permissions-server.ts:32-38`. `requirePermission` sees a null session and throws the 403 refusal. This hits every signed-in user, not just guests.
5. `app/api/auth/permissions/route.ts:17-20`. The route returns the empty list for a null session.
6. `app/api/quiz-grade/route.ts:35`. The guard rejects before the LLM call.

The gate suites do not see this because they mock the seam. `tests/permissions/require-permission.test.ts:10-11` mocks `getSession` in `@/lib/auth/index`. `tests/permissions/permissions-route.test.ts:20-21` does the same. `tests/permissions/quiz-grade-gate.test.ts:20-22` mocks the whole `@/lib/auth` module including `requirePermission`. The gates prove the composed modules in isolation. They never run the live chain from route to handler.

This finding does not change the recorded verdicts and I make no ledger writes. It is evidence the orchestrator should weigh before batch C rides this seam. The fix belongs to the implementer, not the verifier.

### Safari guest-state check

The safaridriver build exposes 17 MCP tools. It has no cookie-injection tool, so the probe used the login page UI, which is the stronger proof. The flow: create a tab at `/login`, set the viewport, fill email and password through the native input setter, submit the form. The page redirected to `/`. The account pill rendered the initials BA and the name `batchb.guest.1788571612`.

The dropdown opened with the account trigger marked `expanded=true`. The content tree shows the signed-in identity as name plus email. The menu shows exactly three actionable rows.

| Item | Guest render |
| --- | --- |
| Account | visible |
| Settings | visible with the Soon badge |
| Admin | absent |
| Sign out | visible |

This matches the S4 postcondition. Settings stays visible with the Soon badge for users without `settings.manage`, so the row is gated and non-actionable. Admin appears only with `users.manage`, and the guest does not hold it. There is no role badge in the batch B surface. The `auth.roles.guest` key exists in the locales but has no render site in the current TSX, and the batch A design defers the badge to batch C minimal mode (`docs/design/rbac-batch-a/header-v2-rev.html:358`). The identity and the guest gating are observable through the permission-driven menu.

Browser console: zero errors, zero warnings. The check for the module-error family also passes. Screenshot saved to `docs/research/ui-after/15-home-batchB-guest.png`.

The quiz-grade seam from the browser perspective is the curl proof above. The browser would send the same session cookie, and it receives 403 permission_denied. No additional page interaction was needed.

## Cleanup

The probe user was removed after the Safari proof. Delete order: session, account, user_roles, user, all by probe email `batchb.guest.1788571612@probe.example`.

| Table | Before | Deleted | After |
| --- | --- | --- | --- |
| user | 1 | 1 | 0 |
| account | 1 | 1 | 0 |
| session | 5 | 5 | 0 |
| user_roles | 1 | 1 | 0 |

The session count includes the verify auto-sign-in session, one API sign-in, and the Safari UI sign-ins. The verification table was not touched: better-auth uses JWTs, not verification rows. A sweep for `%@probe.example`, `%batchb%`, and `probe.%` users returns zero rows. The lost verifier's 5 probe users were already removed by the orchestrator and are not re-listed here. The guest session cookie was confirmed dead after cleanup, and the permissions route still returns the empty list, which preserves defaults-deny.

## Notes

Verification-JWT note for future sessions. better-auth 1.7.2 email verification validates an HS256 JWT signed with the effective secret. The effective secret is `AUTH_SECRET`, or the fallback `dev-secret-change-me` in `lib/auth/server.ts:41` when `AUTH_SECRET` is absent. `.env.local` has no `AUTH_SECRET` in this dev environment, so the fallback signs the tokens. The payload needs `email`, `iat`, and `exp`. There is no verification-table row involved. The verified-guest recipe: POST `/api/auth/sign-up/email`, mint the JWT, GET `/api/auth/verify-email?token=...` which 302s, POST `/api/auth/sign-in/email`, capture `better-auth.session_token`. The guest role assignment happens in the user-create database hook at `lib/auth/server.ts:71-94`, which inserts the rank 1 row.

Status: evidence artifacts complete. Two artifacts delivered. Safari guest-state check passed with the badge-free identity, the soon-badged Settings row, no Admin entry, and a clean console. The report records the runtime seam defect as a fresh finding for the orchestrator. The four ledger verdicts stand unchanged.