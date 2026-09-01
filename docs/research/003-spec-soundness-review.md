# Spec soundness review: batch 003 qwen-token-plan preset registration

Reviewer: independent researcher, no authorship. Date 2026-09-01. Reviewed: docs/specs/003-qwen-token-plan-preset.md (branch main).

## Verdict

NOT fit for approval as written: one blocker (B1, phantom prettier gate). Plan otherwise sound: citations hold, precedence doctrine matches shipped code, preset data matches the probe table. Folded by the orchestrator same-day; fixes marked below.

## Blockers

**B1 (FIXED — G4.1 replaced).** Prettier silently skips every file named by the original G4.1: `.prettierignore:30` ignores `*.md` and `:15` ignores `packages/docs/`. Proof: dirty `SECURITY.md` prints "All matched files use Prettier code style!" with exit 0; a probe file with trailing whitespace behaved identically. The gate would have passed on any content. Replaced with a content-count gate: `grep -l "qwen-token-plan" README.md README-zh.md packages/docs/content/docs/configuration.mdx packages/docs/content/docs/supported-models.mdx | wc -l` expect `4`, mirroring the batch-001 i18n grep-gate pattern. Docs prettier limitation recorded in spec Further Notes.

## Concerns (all folded)

- **C1 (FIXED):** precedence test must cover all five section resolvers (`resolveApiKey`/`BaseUrl`, `resolveTTS*` :687, `resolveASR*` :785, `resolveImage*` :853, `resolveVideo*` :906), not just the LLM pair. Simulation via the proven env-stub + module-reload pattern (`provider-config.test.ts:64-99`).
- **C2 (FIXED):** loader is not path-parameterized (`getConfig` reads `server-providers.yml` from cwd only). G3.1's test reads the example with real fs and injects via the `yamlOverride` fs-mock pattern (`provider-config.test.ts:82-99`). Stated in the spec.
- **C3 (FIXED):** `rivr capture` parses only rs/md/txt/ts/tsx/js/jsx. No symbol targets for `.env.example`, `.yml.example`, or `.mdx`; S3/S4 ride slice expectations + gates.
- **C4 (FIXED):** `TOKEN_PLAN_PRESETS` is a 120-line array; after-signature pinned short as `TokenPlanPreset[]`. Full signatures for `TokenPlanModality`, `MODALITY_ORDER`, `applyModality`, `removeModality`.
- **C5 (FIXED):** seeded catalog ids have no thinking-metadata entries (`model-metadata.ts:456-469`), so the thinking toggle hides for `qwen3.8-max` et al. Generation unaffected; volcengine ships the same shape. Accepted in Further Notes.

## Minor (applied)

Stray backtick before `qwen3.7-plus` fixed; happyhorse append citation `:97` → `:98`; meta wording "adds .env.example token-plan sections" → "adds preset pointers inside existing sections" (batch 001/002 shipped the sections); operator-addressed phrasing in the spec rewritten impersonally; stale comment note for `components/settings/utils.ts:11` recorded, no action.

## Per-check outcomes

| Check | Outcome |
| --- | --- |
| Line-citation audit | PASS after 2 drift fixes |
| MODALITY_ORDER ripple | PASS (consumers enumerated; `arrayContaining` survives; no e2e coverage of the page) |
| UI existence/preset registration | PASS (category filter auto-includes; no feature gate) |
| LLM target semantics | PASS (replace-vs-merge verified; unknown ids null-safe at `providers.ts:2315`) |
| Yml example validity | PASS (no zod strictness; loader tolerant; section keys verified) |
| Gates empirical | G1.1/G1.2/G1.3/G2.2/G3.2 real; G4.1 false-pass caught and replaced; G4.2 exit-1-now valid oracle |
| Precedence testability | PASS after C1 |
| RIVR mechanics | PASS after C3/C4 (kinds type/variable/function confirmed; tier-3 tag present) |
| i18n | PASS (`settings.asrSettings` 12/12; literal name render confirmed at `:184`) |
| Meta consistency | PASS after minor fix |

## Overall (post-fix)

Fit for the human approval gate.
