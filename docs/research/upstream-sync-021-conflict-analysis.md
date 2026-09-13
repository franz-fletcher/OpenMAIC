# Upstream Sync Conflict Analysis

**Date:** 2026-09-13
**merge-base:** d4ef5faa
**ours (HEAD):** 83000f54 (208 commits ahead)
**theirs (upstream/main):** ebf665f3 (49 commits behind)

## Conflict Summary

9 files conflict. Everything else auto-merges, including all 12 locale JSONs, `.env.example`, and ~40 other changed files.

---

## 1. app/api/classroom/route.ts

**Why ours changed (3 commits):**
- Batch D: audience-enforced read gate at classroom seam, MINIMAL_MODE flag gating, RBAC viewer-rank check, owner resolution via `withRequestOwnerId`.

**Why theirs changed (1 commit):**
- PR #1387: input validation hardening. Adds `validateScene` for POST body, `sanitizeSceneContent` for POST output, `sanitizeSceneContent` for GET output, `describeSceneIssue` helper, and `isValidClassroomId` guard.

**Conflict hunks (2):**
1. Lines 19-35: Import area and helper function. Ours adds `isMinimalMode()` function. Theirs adds `describeSceneIssue()` function.
2. Lines 140-183: GET handler body. Ours wraps in `withRequestOwnerId` with MINIMAL_MODE-gated RBAC. Theirs adds `sanitizeSceneContent(classroom)` on the return path.

**Recommended resolution:** Union. Keep both: our `isMinimalMode()` + RBAC gating wrapper AND their `describeSceneIssue` + POST validation + GET sanitization. The GET handler becomes: `withRequestOwnerId` wrapper (ours) with `sanitizeSceneContent` applied to the final `apiSuccess` return (theirs). Their POST validation and sanitization land cleanly outside the conflict regions.

**Risk:** Medium. The GET handler restructure is the most complex merge. Must verify that `sanitizeSceneContent` is called on the returned classroom data inside the `withRequestOwnerId` callback.

**Tests to touch:** `tests/server/classroom-media-generation.test.ts` (auto-merged, verify), `tests/server/sanitize-scene-content.test.ts` (new from upstream, auto-merged).

---

## 2. app/api/stage-meta/[stageId]/route.ts

**Why ours changed (1 commit):**
- Batch D: adds audience-enforced read gate with `resolveViewerRank` + `getStageAccessDb`, non-owner draft/audience check.

**Why theirs changed (1 commit):**
- PR #1392: changes feature flag from `isAgentRuntimeConfigured` to `isServerPersistenceConfigured` (persistence exists without agent runtime).

**Conflict hunks (1):**
1. Lines 27-33: Import block. Ours imports `isAgentRuntimeConfigured` + `getStageAccessDb`. Theirs imports `isServerPersistenceConfigured` (no `getStageAccessDb`).

**Recommended resolution:** Take upstream's `isServerPersistenceConfigured` flag (it is the correct semantic gate for this endpoint). Keep our `getStageAccessDb` import and the RBAC audience check body (which is NOT in the conflict region -- it was auto-merged). The conflict is only the import line; the body with our audience check landed cleanly via auto-merge.

**Risk:** Low. The body is already merged. Only the import line differs.

**Tests to touch:** `tests/agent-runtime/stage-meta-routes.test.ts` (auto-merged, verify).

---

## 3. lib/ai/providers.ts

**Why ours changed (2 commits):**
- Batch 010: undici no-timeout agent (`getLlmNoTimeoutAgent`) to prevent 300s timeout killing long LLM requests. Injects dispatcher into fetch calls.
- Batch 008: phase-progress observability (not in conflict region).

**Why theirs changed (4 commits):**
- PR #1404: same timeout fix but via `transportFetch` wrapper (more robust: catches dispatcher import failure gracefully, warns once).
- PR #1401: adds GLM-5.3 and GLM-5.3-Flash models.
- PR #1329: adds `deepseek-v4-flash-vision-exp` model.
- PR #1387: URL validation hardening (not in conflict region).

**Conflict hunks (2):**
1. Lines 2305-2311: OpenAI-compatible fetch call. Ours uses `fetchCustomOpenAIChat(url, fetchInit)` with dispatcher. Theirs uses `fetchCustomOpenAIChat(url, init, transportFetch)` with `transportFetch`.
2. Lines 2432-2438: Anthropic fallback fetch. Ours uses `getLlmNoTimeoutAgent` + `globalThis.fetch(url, fetchInit)`. Theirs uses `transportFetch(url, init)`.

**Recommended resolution:** Take upstream's `transportFetch` approach. It is strictly superior: (a) it catches dispatcher import failure gracefully and warns once, (b) it is used consistently across all provider branches (azure, openai, anthropic, google), (c) it respects caller-supplied dispatchers. Our `getLlmNoTimeoutAgent` function becomes dead code and should be removed. The upstream approach achieves the same goal (no 300s timeout) with better error handling.

**Risk:** Medium. Must verify that removing our `getLlmNoTimeoutAgent` and its `cachedNoTimeoutAgent` variable does not break any test that stubs it. Also need to verify the `transportFetch` approach is imported/defined correctly in the merged file.

**Tests to touch:** `tests/providers/provider-neutrality-guard.test.ts` (vendor debt counts may shift), `tests/lint-llm-entry-guard.test.ts` (no upstream changes, should be stable).

---

## 4. lib/server/agent-runtime/generation-tools.ts

**Why ours changed (2 commits):**
- Batch 008: adds `onUpdate` parameter to `execute`, `notify()` helper for phase-progress observability (content start/done, actions start/done, persist).
- Batch 008: tolerates stringified `widgetOutline` (JSON.parse coercion).

**Why theirs changed (1 commit):**
- PR #1316: preserves `generate_scene` failure causes. Adds `SceneContentFailureCode` type, `contentFailure` variable, `onFailure` callback, structured error logging, and differentiated error messages for `prompt-unavailable` vs `invalid-model-output`.

**Conflict hunks (2):**
1. Lines 399-403: Before `try` block. Ours adds `notify('generate_scene phase content start')`. Theirs adds `let contentFailure: SceneContentFailureCode | undefined`.
2. Lines 434-467: After `if (!content)` check. Ours adds `notify` calls for phase transitions. Theirs replaces the one-liner with structured failure handling (error code, log.warn, differentiated message).

**Recommended resolution:** Union. Keep both: our `notify` calls AND their structured failure handling. The merged code should:
1. Declare `contentFailure` (theirs) before the try block.
2. Call `notify('generate_scene phase content start')` (ours) right after.
3. In the `onFailure` callback: keep theirs (captures failure code).
4. After `if (!content)`: use their structured error handling, then call our `notify('generate_scene phase content done')` and `notify('generate_scene phase actions start')` AFTER the early return.

**Risk:** Medium. The two features are orthogonal but touch adjacent lines. Must verify the notify calls are placed correctly relative to the early-return paths.

**Tests to touch:** `tests/agent-runtime/generation-tools.test.ts` (auto-merged, verify).

---

## 5. lib/server/model-routes.ts

**Why ours changed (1 commit):**
- Batch 009: adds `'maic-agent-compaction'` to `LLM_STAGES` array.

**Why theirs changed (1 commit):**
- PR #1275: adds `'conversation-title'` to `LLM_STAGES` array, updates JSDoc comments about fallback behavior.

**Conflict hunks (1):**
1. Lines 153-157: The `LLM_STAGES` array. Ours appends `'maic-agent-compaction'`. Theirs appends `'conversation-title'`.

**Recommended resolution:** Keep both entries. The array should contain both `'maic-agent-compaction'` (ours) and `'conversation-title'` (theirs). Also keep their updated JSDoc comments (which are outside the conflict region and auto-merged).

**Risk:** Low. Pure list addition, no semantic conflict.

**Tests to touch:** `tests/server/model-routes.test.ts` (conflicts separately, see below).

---

## 6. packages/@openmaic/storage/package.json

**Why ours changed (2 commits):**
- Bumped version to 0.28.3 for storage changes (compaction, workbench).

**Why theirs changed (2 commits):**
- PR #1392 and #1275: bumped version to 0.29.1 for media asset pool and conversation titles.

**Conflict hunks (1):**
1. Lines 3-7: Version field. Ours: `0.28.3`. Theirs: `0.29.1`.

**Recommended resolution:** Take upstream's `0.29.1`. It is the higher published version. After merge, the fork should NOT bump this further unless it makes additional publishable changes to the storage package. The CI check (`check-package-version-bumps.mjs`) will pass because the version is already bumped.

**Risk:** Low. Version number only.

**Tests to touch:** None directly. CI will validate via `check-package-version-bumps.mjs`.

---

## 7. packages/docs/content/docs/configuration.mdx

**Why ours changed (1 commit):**
- Batch 003: adds token-plan YAML example section, TTS_QWEN_TOKEN_PLAN and ASR_QWEN_TOKEN_PLAN env vars, LLM and image/video token-plan providers section.

**Why theirs changed (2 commits):**
- PR #1281: adds `NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED` flag, playback references.
- PR #1342: adds Exa web search provider (EXA_API_KEY, EXA_BASE_URL).

**Conflict hunks (1):**
1. Lines 314-349: End of YAML config section. Ours adds token-plan YAML example block. Theirs updates the provider IDs list to include `exa`.

**Recommended resolution:** Union. Keep their `exa` addition to the provider IDs list AND our token-plan YAML example. The merged text should: (a) include `exa` in the provider IDs list, (b) include our token-plan YAML example section after the closing sentence.

**Risk:** Low. Documentation only.

**Tests to touch:** `pnpm check:i18n-keys` (verify i18n parity, though this file is outside the locale system).

---

## 8. pnpm-lock.yaml

**Why ours changed:** Lockfile reflects our dependency tree (208 commits of changes).
**Why theirs changed:** Lockfile reflects upstream's dependency tree (49 commits of changes).

**Conflict hunks (14):** All are sub-dependency version resolution hashes (e.g., `@noble/hashes` 2.4.0 vs 1.8.0, `lodash` 4.17.23 vs 4.18.1, `@emnapi/runtime` 1.8.1 vs 1.11.3).

**Recommended resolution:** Do NOT manually resolve. After resolving the `package.json` conflict (storage version), regenerate the lockfile with `pnpm install`. The package manager will resolve all sub-dependency versions deterministically.

**Risk:** Low (mechanical). The only risk is if a sub-dependency version change breaks something, which `pnpm test` will catch.

**Tests to touch:** Full test suite after regeneration.

---

## 9. tests/server/model-routes.test.ts

**Why ours changed (1 commit):**
- Batch 009: adds `'maic-agent-compaction'` to the expected LLM_STAGES test assertion.

**Why theirs changed (1 commit):**
- PR #1275: adds `'conversation-title'` to the expected LLM_STAGES test assertion.

**Conflict hunks (1):**
1. Lines 381-385: Expected stages array in test. Ours: `'maic-agent-compaction'`. Theirs: `'conversation-title'`.

**Recommended resolution:** Keep both entries in the expected array, matching the model-routes.ts resolution.

**Risk:** Low. Pure list addition.

**Tests to touch:** This IS the test. Verify it passes after merge.

---

## Structural Clash Assessment

No structural clashes found. The fork's features (RBAC, token-plan, compaction, MINIMAL_MODE) and upstream's features (input validation, failure causes, conversation titles, Exa, GLM-5.3, DeepSeek V4) are orthogonal. The only overlap is the undici timeout fix (both sides solved it differently), which is resolved by taking upstream's superior approach.

## Vendor Debt Impact

Upstream adds new provider IDs: `glm-5.3`, `glm-5.3-flash`, `deepseek-v4-flash-vision-exp`. None of these contain vendor terms that would trigger the provider-neutrality guard. Upstream also adds `exa` as a web search provider, which adds vendor debt entries (5 total across 4 groups) to the neutrality guard test. These are already accounted for in upstream's test changes (auto-merged).

The fork's existing vendor debt counts (qwen 24, token 5, plan 4) remain unchanged by this merge.
