# Verification report: batch 003 qwen-token-plan-preset (round 1)

Round 1, 2026-09-01, independent verifier. Chain 43. All 10 gates hermetic, all passed fresh. Spot checks: preset matches the frozen table (token-plan-presets.ts:212-257, five targets, literal name, no websiteUrl); MODALITY_ORDER asr between tts and webSearch (:62-69); apply/remove asr cases (apply-token-plan.ts:219-226, :326-332); UI Mic/label wiring (token-plan-settings.tsx:46,:55,:106-115,:128-142); PRECEDENCE_SECTIONS covers five resolvers (precedence test :18-44); yml example hosts correct and parse-verified by its test; .env.example diff is comment-only; README pair content real; docs rows match shipped registries. Full suite: 7214 passed, only the allowed classroom-media-generation red (batch-001 F5 harness; also prints a live key — batch 005 target). i18n parity green, zero new keys.

Statuses r1: S1-S4 verified (gates) but diffs showed F1-class spurious deviates: six S1 postconditions plus the S4 README anchor lacked after-kind. Condition for certification: repair postcondition kinds so diffs record clean. F2: stale 'ASR is omitted' comment at token-plan-presets.ts:19. F3: allowed red confirmed pre-existing.

## ROUND 2 addendum

Correction rebind recorded; after-kind written on all seven contracts (README anchor also after-signature '###'); F2 comment removed (comment-only edit, S1 gates re-proven). Diffs now clean: S1 8/8, S2 1/1, S3 1/1, S4 1/1. Chain 54. S1 re-verified with fresh gates (#54). Final verdict: certifiable YES.
