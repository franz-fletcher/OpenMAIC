# ADR-001: Progress-reset heartbeat over a flat budget raise

Status: Accepted (2026-09-03)

## Context

The ENGE503 build aborted at seq 5728 and 5764 at exactly 899992 ms and 900020 ms. Both calls were interactive widget pages whose content generation was still progressing. A flat raise of the budget only moves the cliff later and rewards hung calls. undici defaults `headersTimeout` and `bodyTimeout` to 300 s, so a silent provider fails the fetch before any watchdog can act.

## Decision

`withAgentToolTimeout` resets the execution deadline to the base budget whenever the tool reports progress through the pi `onUpdate` callback. A hard ceiling of 3 times the base budget caps the total. The LLM fetch path disables the undici `headersTimeout` and `bodyTimeout` with a no-timeout agent.

## Consequences

- A progressing widget page survives past 900 s, and a silent call still aborts at the base budget.
- A ceiling abort keeps the stable fragment `execution budget and was aborted`, so the S04 gate scan detects it at any budget value.
- The no-timeout undici agent removes a fetch safety net, so provider silence is bounded only by the heartbeat.
- Per-phase budgets stay future work, because only the base budget environment variable exists today.

References: `docs/specs/008-stage-generation-throughput.md` (S02, Delivered versus spec, Implementation Decisions), `lib/agent/runtime/tool-timeout.ts:41,93,211-216,228-231`, `lib/ai/providers.ts:1888-1890,2154,2274`. Commits `7844d653`, `919413dd`. Ledger stage `research_update`.