# 021 Spec Soundness Review

**Reviewer:** Independent spec-soundness reviewer (did not write the spec)
**Date:** 2026-09-13
**Spec:** docs/specs/021-upstream-sync-merge.md
**Author's analysis:** docs/research/upstream-sync-021-conflict-analysis.md

## Verdict

**APPROVE WITH FIXES**

Three blockers. Five concerns. The spec is sound in its conflict identification and resolution strategy, but it has gaps in the providers.ts dead-code removal scope, missing gate expect markers, and a misleading classroom route description.

## Blockers

### B1: providers.ts dead-code removal is incomplete

**File:** docs/specs/021-upstream-sync-merge.md, lines 34 and 85
**Evidence:** The merged blob (`git show e9b03324:lib/ai/providers.ts`) shows `getLlmNoTimeoutAgent` is called at lines 2302 and 2433 OUTSIDE the conflict markers. These lines inject a dispatcher into `fetchInit`. After resolving the conflict regions (lines 2308-2312 and 2437-2441) by taking upstream's `transportFetch` side, the `fetchInit` variable becomes unused, and the `getLlmNoTimeoutAgent` call becomes dead code. But the spec only says "Remove our `getLlmNoTimeoutAgent` function and `cachedNoTimeoutAgent` variable as dead code." It does not mention removing the dispatcher injection lines that reference them.

**Impact:** If the implementer deletes only the function definition and variable, the code will have unreachable statements (`const dispatcher = await getLlmNoTimeoutAgent()` and `const fetchInit = ...`) that reference a deleted symbol. `tsc --noEmit` will fail.

**Required spec edit:** Change line 85 from:
> Remove our `getLlmNoTimeoutAgent` function and `cachedNoTimeoutAgent` variable as dead code.

To:
> Remove our `getLlmNoTimeoutAgent` function, `cachedNoTimeoutAgent` variable, and the dispatcher injection lines that reference them (the `const dispatcher = await getLlmNoTimeoutAgent()` and `const fetchInit = init ? { ...init, dispatcher } : init` lines in the OpenAI-compatible and Anthropic branches). After conflict resolution, these lines produce unused variables because `transportFetch` handles the dispatcher internally.

### B2: Gate expect markers are missing

**File:** docs/specs/021-upstream-sync-merge.md, lines 64-71
**Evidence:** The spec lists gate commands with "expect clean exit" or "expect all tests pass" but does not specify the literal expect-marker strings required by rivr quirk (a). Rivr gates need a literal substring of stdout+stderr (or `/regex/`) to match. "Clean exit" is an exit code, not a marker.

**Impact:** The ledger builder cannot construct gates without knowing the expect markers. Silent-success commands (like `pnpm format`, `pnpm lint --fix`) need explicit echo markers.

**Required spec edit:** Replace the S5 Target commands block with:

```
**Target commands:**
- `pnpm format && echo FORMAT_OK` -- expect `FORMAT_OK`
- `pnpm lint --fix && echo LINT_OK` -- expect `LINT_OK`
- `npx tsc --noEmit && echo TSC_OK` -- expect `TSC_OK`
- `pnpm check && echo CHECK_OK` -- expect `CHECK_OK`
- `pnpm check:i18n-keys && echo I18N_OK` -- expect `I18N_OK`
- `pnpm test` -- expect `/Tests\s+\d+/` (vitest summary line)
```

### B3: Classroom route description conflates POST and GET handlers

**File:** docs/specs/021-upstream-sync-merge.md, line 32
**Evidence:** The spec says "union: our RBAC wrapper + their POST validation/sanitization." The actual conflict has two hunks:
1. Helper function area (lines 19-35): fork's `isMinimalMode()` vs upstream's `describeSceneIssue()`
2. GET handler body (lines 140-183): fork's `withRequestOwnerId` + MINIMAL_MODE-gated RBAC vs upstream's `sanitizeSceneContent(classroom)` on the return path

The POST handler auto-merged cleanly. Upstream's `validateScene` and `sanitizeSceneContent` for POST landed outside conflict regions. The RBAC wrapper is in the GET handler, not the POST handler.

**Impact:** An implementer reading "our RBAC wrapper + their POST validation/sanitization" might try to apply RBAC to the POST handler or miss the GET handler conflict entirely.

**Required spec edit:** Change line 32 from:
> `app/api/classroom/route.ts` -- union: our RBAC wrapper + their POST validation/sanitization

To:
> `app/api/classroom/route.ts` -- union: keep both helper functions (`isMinimalMode` ours + `describeSceneIssue` theirs); POST handler auto-merged (their `validateScene`/`sanitizeSceneContent` + our MINIMAL_MODE flag); GET handler: wrap their `sanitizeSceneContent(classroom)` return inside our `withRequestOwnerId` callback with MINIMAL_MODE-gated RBAC preserved

## Concerns

### C1: Risk tiers not specified for slices (Severity: Medium)

The spec assigns no risk tiers to slices. The rivr-ledger v2 rules require each slice to have a tier that sets minimum gate depth. The default is tier 2 (2 gates). S2 (code conflict resolution) and S5 (full CI gate) warrant tier 3 or 4 given their complexity.

**Suggested implementer note:** Assign tiers during ledger build: S1=tier1, S2=tier3, S3=tier2, S4=tier1, S5=tier3, S6=tier1.

### C2: S1 and S6 postconditions are vague (Severity: Low)

S1 postcondition: "Branch `chore/merge-upstream-2026-09` exists; `git merge upstream/main` reports exactly 9 conflicted files matching the spec's list."
S6 postcondition: "Merge commit exists on `chore/merge-upstream-2026-09`. Branch is pushed to origin. Main can be fast-forwarded."

These are prose, not verifiable commands. For git-operation slices, symbol-level postconditions don't apply, but the postconditions should specify verification commands.

**Suggested implementer note:** For S1, verify with `git rev-parse chore/merge-upstream-2026-09` and count conflict markers. For S6, verify with `git log --oneline -1`, `git status`, and `git merge-base --is-ancestor main chore/merge-upstream-2026-09`.

### C3: provider-neutrality-guard vendor debt counts need post-merge verification (Severity: Low)

The auto-merged test correctly combines fork's entries (qwen 24, token 5, plan 4) with upstream's entries (exa 5, exa 2, exa 4, exa 3). But the spec's Further Notes section says "The fork's existing vendor debt counts (qwen 24, token 5, plan 4) remain unchanged by this merge." This is true for the fork's entries, but the TOTAL counts in the test change because upstream adds exa entries.

**Suggested implementer note:** After merge, run `pnpm test tests/providers/provider-neutrality-guard.test.ts` to confirm the combined counts pass. The spec already mentions this in Testing Decisions item 8, but the Further Notes section could be clearer.

### C4: `isMinimalMode()` is a local function, not a feature-flag export (Severity: Low)

The spec and author's analysis refer to `isMinimalMode()` as if it were a feature-flag import. It is actually a local helper function defined in the classroom route file (lines 27-35 of the fork's version). The merged blob shows it in the first conflict hunk. The resolution keeps it (ours) vs `describeSceneIssue` (theirs).

**Suggested implementer note:** The resolution keeps both: `isMinimalMode()` (local helper, fork) and `describeSceneIssue()` (local helper, upstream). Neither is an import.

### C5: Known flake documentation is incomplete (Severity: Low)

The spec mentions the database-chat-cutover 5s-timeout flake (line 97) but does not mention `tests/server/classroom-media-generation.test.ts` which has a `gracefully skips media when every configured provider is force-disabled` test (line 188) that can be slow. The AGENTS.md testing quirks section mentions the 5s-timeout flake but not this specific test.

**Suggested implementer note:** If classroom-media-generation tests timeout during S5, retry once before flagging as a merge regression.

## Gate Audit

| Gate | Command | Marker Strategy | Finding |
|------|---------|-----------------|---------|
| G1 format | `pnpm format && echo FORMAT_OK` | expect `FORMAT_OK` | Missing from spec (B2) |
| G2 lint | `pnpm lint --fix && echo LINT_OK` | expect `LINT_OK` | Missing from spec (B2) |
| G3 tsc | `npx tsc --noEmit && echo TSC_OK` | expect `TSC_OK` | Spec has this correct |
| G4 check | `pnpm check && echo CHECK_OK` | expect `CHECK_OK` | Missing from spec (B2) |
| G5 i18n | `pnpm check:i18n-keys && echo I18N_OK` | expect `I18N_OK` | Missing from spec (B2) |
| G6 test | `pnpm test` | expect `/Tests\s+\d+/` | Missing from spec (B2) |

All commands exist in package.json scripts. Command existence verified.

**Tier fit:** S5 should be tier 3 (integration tag) since it runs the full CI gate. S2 should also be tier 3 since it resolves code conflicts that affect type checking.

## Corrections to Author's Analysis

### A1: Classroom conflict hunk count

**Author's claim (line 22):** "Conflict hunks (2): 1. Lines 19-35: Import area and helper function. 2. Lines 140-183: GET handler body."
**Finding:** Correct. The merged blob has 6 conflict markers (2 hunks). Verified.

### A2: providers.ts transportFetch import compatibility

**Author's claim (line 69):** "Take upstream's `transportFetch` approach. It is strictly superior."
**Finding:** Correct. Upstream's `transportFetch` is defined at line 2169 of upstream's providers.ts. It uses `getLlmDispatcher()` internally (a different function from our `getLlmNoTimeoutAgent`). The signature is `typeof fetch` (standard fetch compatible). It is import-compatible with the file's remaining structure.

### A3: stage-meta auto-merge claim

**Author's claim (line 45):** "The body with our audience check landed cleanly via auto-merge."
**Finding:** Correct. The merged blob has only 3 conflict markers (1 hunk, the import block). The body with `withRequestOwnerId`, `resolveStageAccess`, `resolveViewerRank`, and `getStageAccessDb` auto-merged. Verified at merged blob lines 35-100+.

### A4: generation-tools notify placement

**Author's claim (lines 90-94):** The merged code should call `notify` after the early return for structured error handling.
**Finding:** Correct. The merged blob shows `notify` calls at lines 397, 400, 436-437, 474-475. The `contentFailure` variable from upstream is at line 402. The `notify('generate_scene phase content start')` is at line 400 (before the try block, after `contentFailure` declaration). The structured error handling from upstream is in the `if (!content)` block. The `notify` calls for "content done" and "actions start" are after the early return path. This matches the author's recommended resolution.

### A5: storage package.json workspace protocol

**Author's claim (line 132):** "The CI check (`check-package-version-bumps.mjs`) will pass because the version is already bumped."
**Finding:** Correct. Root package.json uses `"@openmaic/storage": "workspace:*"` (verified). The version bump from 0.28.3 to 0.29.1 is safe because the workspace protocol resolves to whatever version is in the local package.json. The `check-package-version-bumps.mjs` script checks for version bumps in the diff, and the upstream bump is already in the merge diff.

### A6: LLM entry guard stability

**Author's claim (line 113):** "No upstream changes to `tests/lint-llm-entry-guard.test.ts`."
**Finding:** Correct. `git diff HEAD upstream/main -- tests/lint-llm-entry-guard.test.ts` produces empty output. The test is unchanged between fork and upstream.

## Summary

- **Verdict:** APPROVE WITH FIXES
- **Blockers:** 3 (B1: providers.ts dead-code scope, B2: gate expect markers, B3: classroom description)
- **Concerns:** 5 (C1: risk tiers, C2: S1/S6 postconditions, C3: vendor debt verification, C4: isMinimalMode scope, C5: flake docs)
- **Corrections to author's analysis:** 6 entries, all confirmed correct

The spec's conflict identification and resolution strategy are sound. The three blockers are all fixable with text edits to the spec. No structural changes to the slice/tier architecture are needed, though risk tiers must be assigned during ledger build.
