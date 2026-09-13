# 021 - Upstream Sync Merge

Spec status: research_update

## Results

Synced 49 upstream commits (ebf665f3) into fork main. Upstream brought: input validation hardening (PR #1387), structured scene-content failure causes (PR #1316), `isServerPersistenceConfigured` persistence flag fix (PR #1392), conversation-title generation (PR #1275), Exa web search provider (PR #1342), GLM-5.3 and GLM-5.3-Flash models (PR #1401), DeepSeek V4 Flash Vision (PR #1329), `transportFetch` timeout wrapper replacing undici dispatcher (PR #1404), playback/GenUI courseware references (PR #1281), and `sanitize-scene-content.ts` (301 lines, auto-merged).

Fork features survived intact: RBAC + MINIMAL_MODE gating at classroom and stage-meta seams, token-plan provider wiring (qwen, happyhorse), agent-context compaction stage, phase-progress `notify` calls in generation-tools, and `isAgentRuntimeConfigured` stability anchor.

Final merge commit: `4592efa0` on `chore/merge-upstream-2026-09` (parents `251d5095` + `ebf665f3`). Full test suite: 8671 passed, 0 failed, 200 skipped on Node 22. Lint chain green (0 errors) for the first time on main-line fork history.

## Problem Statement

The OpenMAIC fork (origin: franz-fletcher/OpenMAIC) diverged from upstream (THU-MAIC/OpenMAIC) by 216 local commits while upstream advanced 49 commits since merge-base d4ef5faa. The fork needed to sync to receive security fixes, new model support, input validation hardening, and other improvements. Nine files conflicted and required manual resolution.

## Solution

Merged `upstream/main` into the fork via dedicated sync branch `chore/merge-upstream-2026-09`. Resolved all 9 conflicts by taking the union of both sides' features. Regenerated the lockfile after resolving the storage package.json version. Ran the full CI gate to verify. Cleaned up 44 pre-existing lint errors in 13 files (S07 amendment).

## User Stories

1. As a fork operator, I want to sync with upstream so that I receive security fixes and new model support without losing fork-specific features.
2. As a developer, I want the merge to preserve all fork features (RBAC, token-plan, compaction, MINIMAL_MODE) so that no functionality is regressed.
3. As a developer, I want the merge to preserve all upstream features (input validation, failure causes, conversation titles, Exa, GLM-5.3, DeepSeek V4) so that no upstream work is lost.
4. As a CI operator, I want the full gate to pass so that the merged code is production-ready.

## Slices

### S1: Branch and merge start -- VERIFIED

Created sync branch from main, started merge, confirmed 9 conflict files matched predicted set.

**Target:** `lib/config/feature-flags.ts::isAgentRuntimeConfigured` (stability anchor).
**Status:** Verified. G1 `BRANCH_EXISTS` green. Branch `chore/merge-upstream-2026-09` at HEAD `251d5095`, `.git/MERGE_HEAD` = `ebf665f3`, 0 unmerged paths, 394 files staged.
**Tier:** 1.

### S2: Code conflict resolution (6 files) -- VERIFIED

Resolved 6 code-level conflicts. All conflict markers eliminated. `npx tsc --noEmit` passes.

**Resolution details with file:line references (merge commit 4592efa0):**

- `app/api/classroom/route.ts`: Union. Fork helper `isMinimalMode` :24 preserved. Upstream `describeSceneIssue` :32 and `validateScene` loop :69-80 landed. POST handler: upstream `sanitizeSceneContent` on persist path :96-97 plus fork MINIMAL_MODE flag. GET handler: `withRequestOwnerId` wrapper :135 with MINIMAL_MODE-gated RBAC :142/:156-166. `sanitizeSceneContent` applied to BOTH serving return paths :150/:177. RBAC verified to gate before content at :160-165 (published/audience checks run before `readClassroom` :168).
- `app/api/stage-meta/[stageId]/route.ts`: Upstream `isServerPersistenceConfigured` import :27 and flag gate :48. Fork RBAC body auto-merged (`getStageAccessDb` :28, `resolveViewerRank` :69).
- `lib/ai/providers.ts`: Full removal of `getLlmNoTimeoutAgent`, `cachedNoTimeoutAgent`, and dispatcher-injection lines. Zero repo-wide references after sweep. Upstream `transportFetch` defined :2168, wired through azure :2207, custom OpenAI :2277-2278, openai :2339, anthropic :2402/:2416, google :2456.
- `lib/server/agent-runtime/generation-tools.ts`: Union. Fork `notify` calls :397/:400/:459/:460/:467/:468 preserved after the early return. Upstream `SceneContentFailureCode` import :13, `contentFailure` :399, structured failure branch :432-457. `buildGenerationTools` :224 returns `AgentTool<never, never>[]`.
- `lib/server/model-routes.ts`: `LLM_STAGES` :132-156 contains both `maic-agent-compaction` :153 and `conversation-title` :154.
- `tests/server/model-routes.test.ts`: Expected set :378-383 contains both entries.

**Gates:** G1 `NO_CONFLICT_MARKERS`, G2 `TSC_OK` (integration), G3 model-routes test passed.
**Tier:** 3.

### S3: Package version and lockfile -- VERIFIED

Resolved storage/package.json version conflict (took 0.29.1). Regenerated pnpm-lock.yaml.

**Evidence:** `packages/@openmaic/storage/package.json` line 3 `"version": "0.29.1"` at 4592efa0. Lockfile: no conflict markers, storage importer section present :848, root importer keeps `link:packages/@openmaic/storage` :142.
**Gates:** G1 `VERSION_OK`, G2 `NO_LOCKFILE_CONFLICTS`.
**Tier:** 2.

### S4: Documentation conflict resolution -- VERIFIED

Resolved configuration.mdx conflict: union of upstream's Exa provider docs and fork's token-plan YAML example.

**Evidence:** `packages/docs/content/docs/configuration.mdx` at 4592efa0: `## Web search` heading :171, `EXA_API_KEY` :179, `EXA_BASE_URL` :180, upstream `exa` in provider IDs list :314, fork token-plan YAML example :316-344, `### LLM and image/video token-plan providers` :266-268.
**Gate:** G1 `NO_DOCS_CONFLICTS`.
**Tier:** 1.

### S5: Full CI gate -- VERIFIED

Ran complete CI gate. All six commands pass.

**Gates:** G1 `FORMAT_OK`, G2 `LINT_OK`, G3 `TSC_OK`, G4 `CHECK_OK`, G5 `I18N_OK`, G6 `Tests` summary line.
**Side-effect audit:** Staged index fingerprint identical before and after every gate run. `pnpm format` and `pnpm lint --fix` changed nothing.
**Full suite result (Node 22, unmasked re-run):** Test Files 774 passed / 34 skipped (808), Tests 8671 passed / 200 skipped (8871), exit code 0. Duration ~72s. Zero failures. Includes `tests/lint-llm-entry-guard.test.ts` (32 tests) and `tests/providers/provider-neutrality-guard.test.ts`.
**Tier:** 3.

### S6: Commit and push -- ABANDONED

Abandoned as a ledger slice. Merge commit and push are orchestrator landing mechanics, not implementer work. The two-parents oracle was run manually: `MERGE_HAS_TWO_PARENTS` and `ANCESTOR_OK` green at 4592efa0.

**Mid-merge commit hazard:** An orchestrator docs commit during MERGE_HEAD accidentally produced premature two-parent commit 91467049. Recovered with `git reset --soft 251d5095` + MERGE_HEAD restore before the real commit. Constraint recorded to project memory (ID 301): never commit while MERGE_HEAD exists unless the commit IS the merge resolution.
**Tier:** 1.

### S7: Pre-existing lint debt cleanup (amendment) -- VERIFIED

Fixed 44 error-severity lint violations across 13 files byte-identical to pre-merge main. Debt predates the sync.

**Scope:** app/verify/page.tsx, scripts/repair-compaction-entry.js, tests/admin/invite-mailer.test.ts, tests/admin/roles-audience.test.ts, tests/admin/roles-persistence.pg.test.ts, tests/agent-runtime/compaction-summary.test.ts, tests/agent-runtime/compaction-trigger.test.ts, tests/minimal-mode/live-wire.pg.test.ts, tests/minimal-mode/minimal-layout.test.ts, tests/publishing/gallery-list.test.ts, tests/publishing/no-leak.pg.test.ts, tests/publishing/publish-live-wire.pg.test.ts, tests/publishing/read-gate.test.ts.

**Actual edits:**
- `app/verify/page.tsx::Page` :151: setState-in-effect fix inside `VerifyContent`; initial status becomes `token ? 'loading' : 'failure'`, effect early-returns on no token. Steady-state rendering identical.
- `scripts/repair-compaction-entry.js`: 2-line edit converts `require('pg')` to `await import('pg')` inside the async pool path.
- Test files: type-only edits replacing `as any` casts with imported `Queryable` type annotations. Test semantics intact.

**Gates:** G1 `LINT_ZERO_ERRORS` (whole-repo `pnpm lint`, no `--fix`, zero error-severity violations), G2 read-gate suite passed.
**Tier:** 2.

## Implementation Decisions

1. **Merge strategy:** `git merge upstream/main` on a dedicated branch. NOT rebase (216 local commits make rewrite unsafe).
2. **Sync branch:** `chore/merge-upstream-2026-09` cut from main.
3. **providers.ts timeout fix:** Took upstream's `transportFetch` wrapper. Removed our `getLlmNoTimeoutAgent` function, `cachedNoTimeoutAgent` variable, and all dispatcher injection lines. Zero references remain.
4. **Storage version:** Took upstream's 0.29.1.
5. **Lockfile:** Regenerated with `pnpm install` after resolving package.json.
6. **stage-meta route flag:** Took upstream's `isServerPersistenceConfigured`.
7. **Classroom GET sanitization:** `sanitizeSceneContent` applied to BOTH serving return paths :150/:177. RBAC gates before content at :160-165.

## Testing Decisions

1. Full suite: `pnpm test` on Node 22. 8671 passed / 0 failed / 200 skipped.
2. Type checking: `npx tsc --noEmit` passes.
3. i18n parity: `pnpm check:i18n-keys` passes.
4. Linting: `pnpm lint` exits 0 (0 errors). First green on main-line fork history.
5. Formatting: `pnpm format` passes.
6. Provider neutrality guard: upstream `exa` debt entries landed; fork counts (qwen 24, token 5, plan 4) unchanged.
7. PG suites: lint + tsc only (DB-gated, expected skip).

## Out of Scope

1. E2E testing (`pnpm test:e2e`).
2. Version bumps beyond what upstream already bumped.
3. New feature work beyond conflict resolution.
4. Render service changes.
5. Documentation updates beyond configuration.mdx.

## Further Notes

1. **Vendor debt shift:** Upstream adds `exa` (5+2+4+3 entries across 4 groups). Fork counts unchanged.
2. **New model IDs:** `glm-5.3`, `glm-5.3-flash`, `deepseek-v4-flash-vision-exp`. No vendor-term triggers.
3. **LLM entry guard:** No upstream changes. Fork's compaction stage preserved.
4. **sanitize-scene-content.ts:** 301 lines, auto-merged cleanly.
5. **isServerPersistenceConfigured:** Auto-merges in feature-flags.ts.
6. **onUpdate parameter:** Fork-only, preserved.
7. **Risk tiers:** S1=1, S2=3, S3=2, S4=1, S5=3, S6=1 (abandoned), S7=2.
8. **S07 amendment:** Lint debt discovered mid-implementation. `rivr spec amend --action extension` returned stage to research. S07 contracted and verified.
9. **Node 22 requirement:** CI pins Node 22 (.nvmrc). Default local Node 24 produced ~46 environment flakes. Node 22 gave 8671/0/200.
10. **Mid-merge commit hazard:** Never commit while MERGE_HEAD exists unless the commit IS the merge resolution. Project memory ID 301.

## Deviations and Surprises

### S06 abandoned
Merge commit + push are orchestrator landing mechanics. The two-parents oracle was run manually at 4592efa0. Not an implementation failure; the slice was mis-scoped as implementer work.

### Mid-merge commit hazard
An orchestrator docs commit during MERGE_HEAD accidentally produced premature two-parent commit 91467049. Recovered with `git reset --soft 251d5095` + MERGE_HEAD restore. The real merge commit landed as 4592efa0.

### Node 22 requirement
Default local Node 24 produced ~46 environment flakes across the suite. CI-pinned Node 22 gave clean results (8671/0/200). Gate runs must use Node 22 for parity.

### Pre-existing lint debt (S07)
S05 G2 (`pnpm lint --fix && echo LINT_OK`) failed with 44 error-severity violations in 13 files. All byte-identical to pre-merge main. S07 extension approved and contracted.

### Classroom GET deviation
`sanitizeSceneContent` applied to BOTH serving return paths (:150 and :177), not just the main path. RBAC verified to gate before content at :160-165. The flag-off early return :150 also sanitizes, which is stricter than the original spec's "wrap their return inside our callback" wording.

### providers.ts full removal
Removed `getLlmNoTimeoutAgent` + `cachedNoTimeoutAgent` + all dispatcher injection lines. Zero references remain. The spec's original wording "remove dead code" understated the scope; the actual removal included 4 lines outside the conflict markers that referenced the deleted function.

## Contract/Gate Lessons (fixes owed to research practice)

### V1: ANSI-wrapped vitest output
`/Tests\s+\d+/` never matches ANSI-wrapped vitest output in this agent environment. Vitest emits ANSI grouping escapes inside the summary line even when stdout is a pipe. Verifier remedy: `NO_COLOR=1` in the gate-parent environment. Future gate specs should embed `NO_COLOR=1` or use ANSI-safe oracles.

### V2: Phantom postcondition artifacts
Nine diff lines classified deviates/missing against pre-merge reality: return-type annotations neither side wrote, `AgentTool<never, never>` missing its `[]`, `LLM_STAGES` annotated form that never existed, test-file inline literal treated as named symbol, JSON/heading capture kinds for package.json and configuration.mdx, `repairCompactionEntry` phantom (absent in all revisions), `AUDIENCE_RANK` defined outside its contracted file. Postconditions must be validated against real captures at build time.

### V3: Tail-piped gates mask exit codes
`pnpm test 2>&1 | tail -20` takes its exit code from `tail`, not `pnpm test`. The Tests marker matches failed summaries too. Recommend gates use `set -o pipefail` or drop the pipe.

### V4: Stability-anchor targets for operational slices
S01/S05/S06 needed targets but had no code artifacts. The `lib/config/feature-flags.ts::isAgentRuntimeConfigured` stability-anchor pattern worked but is a workaround for the contract grammar's "every slice needs a target" rule.

### V5: Researcher/amend friction
`rivr spec amend` is orchestrator-only. `stage return` is orchestrator-only. The researcher's only route for mid-implementation scope changes is `spec propose` (audit-only). The orchestrator must run the amend to unblock slice_crud. This friction is by design but slows emergency extensions.

## Commit SHAs

| Commit | Description |
|--------|-------------|
| `93b30f5f` | docs(rivr): batch 021 upstream-sync spec, conflict analysis, soundness review |
| `b11ccee0` | docs(spec): add status marker and expanded providers.ts removal detail for 021 |
| `251d5095` | chore(rivr): batch 021 stage advance to implementation (marker rewrite) |
| `4592efa0` | chore: merge upstream/main (ebf665f3) into fork (final merge commit) |
