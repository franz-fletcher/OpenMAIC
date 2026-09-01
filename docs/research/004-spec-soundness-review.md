# Spec soundness review: batch 004 video i2v / r2v

Reviewer: independent researcher, no authorship. Date 2026-09-02.
Target: batch-004 spec claims (audited against the live repo before the spec file landed; the orchestrator then wrote `docs/specs/004-video-i2v-r2v.md` folding every finding below, which resolves blocker B1).

## Verdict (of the pre-edit draft claims)

Fit for approval after fixes. All repo-side facts were audited live. Three blockers and six concerns were found; all blockers are folded into the spec text.

## Blockers (folded)

**B1 (missing review target at dispatch time).** The spec file was not yet on disk when the review was dispatched. Fix: the orchestrator wrote the spec from this audit. The review re-verified the landed text against every finding below.

**B2 (locale count).** Six `supported-models*.mdx` files exist (English plus five copies), all carrying the HappyHorse row at line 54. Any "7 locales" claim is off by one. Fixed in spec: the docs gate greps the new ids across the six files and expects `6`, never the bare word `happyhorse` (26 repo-wide matches).

**B3 (phantom symbol).** `resolveHappyHorseBaseUrl` does not exist. The adapter has the unexported `normalizeBaseUrl` at `:56`. Ledger targets fixed to: `submitHappyHorseTask` (`:93`), `pollHappyHorseTask` (`:134`), `generateWithHappyHorse` (`:172`), plus any new exported helper pinned with its exact signature.

**B4 (route export shape).** `app/api/generate/video/route.ts` exports a NAMED `POST` (`:39`); tests import `const { POST } = await import(...)`. Spec wording fixed accordingly.

## Concerns (disposition)

**C1 (cancel unproven).** No token-plan cancel endpoint is proven; the adapter never reads `options.signal`, so abort does not stop vendor generation. Disposition: S05 needs no cancel. The r2v proof uses a controlled unreachable-reference URL: `Failed to download` on poll proves array acceptance and auth at zero quota.

**C2 (URL + error discrimination).** No positive image URL was previously recorded; schema errors and download errors share code `InvalidParameter`, discriminated by message (`Field required: input.media` vs `Failed to download <url>`; adapter renders `code: message` at `happyhorse-adapter.ts:87-91`). Disposition: spec pins the DashScope-CDN sample URL, orders the zero-quota proofs before the paid run, and pins message substrings.

**C3 (neutrality trip).** The route file is in `PROVIDER_NEUTRAL_FILES` (`provider-neutrality-guard.test.ts:72`) and `happyhorse` is a scanned vendor term with zero allowance in that file. Disposition: preflight is capability-driven through a registry helper (`getVideoModelSourceRequirement`), so no vendor literal enters the route. The registry file is the composition root, not scanned.

**C4 (managed path).** `resolveVideoModel` allowlists client models against provider `_MODELS` for managed config. Updating only the built-in list would strand managed deployments. Disposition: the yml example gains both ids (S04 integration gate), which the batch already covered.

**C5 (explicit boundaries).** `packages/@openmaic/generation/src/outline-types.ts:61-67` duplicates the request type and stays untouched (publishable exemption). The agent-runtime video tool (`lib/server/agent-runtime/generate-video.ts:296-302`) has no source-image fields. Disposition: recorded as boundaries in Implementation Decisions.

**C6 (probe evidence location).** Batch-004 probe facts previously lived only in session notes. Disposition: recorded in this review file and the spec's Solution section.

## Per-check outcomes

| Check | Outcome |
| --- | --- |
| Citation audit | PASS (9/9 line citations valid); locale count drift fixed |
| Route guard feasibility | PASS (model id present at `:87-94`; plain-JSON body; spread preserves unknown fields) |
| Adapter contract | PASS (t2v exact-body anchor at `tests/media/happyhorse-adapter.test.ts:40-62`; `{type,url}` matches probes) |
| Orchestrator pass-through | PASS (`exactOptionalPropertyTypes` off; precedent `signal?: AbortSignal`) |
| S05 design | PASS after C1/C2 dispositions |
| Gates | PASS after B2 fix; cwd pinned; G5.4 scoped re-run instead of full suite (cost note) |
| Ledger capturability | PASS after B3/B4 fixes; `VIDEO_PROVIDERS` capturable at `video-providers.ts:22`; per-model entries ride slice expectations and gates (batch-003 C4 pattern) |
| Meta consistency | PASS after scope-line refresh (adapter range corrected to `:104-115`) |
| Contradictions and phantoms | HUNTED; three confirmed and fixed; env.example-untouched, zero-i18n, no-package-changes all re-verified TRUE |

## Minor

1. Client abort does not stop vendor generation (adapter ignores `signal`). Recorded in spec Further Notes.
2. Memory note corrected: six supported-models files, not seven.
3. RIVR Rule 5 phrasing: Out-of-Scope items are boundaries, not "follow-up" deferrals. Spec wording complies.
