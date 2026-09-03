# ADR-005: Tandem validation model for meta acceptance

Status: Accepted (2026-09-03)

## Context

The child gates certify hermetic, so they cannot prove behavior against live provider behavior and real page timings. The meta spec needs one acceptance activity that observes the finished build in production.

## Decision

A tandem run is the meta level acceptance activity: the human drives the workbench UI while the orchestrator monitors read only with `psql`. The run changes no code and writes no database rows, and the abort criteria map each observation to the owning slice.

## Consequences

- Child certification stays hermetic and zero paid, so the tandem run never blocks a batch gate.
- The tandem run is the hostile environment validation per batch 005 doctrine and observes compaction quality directly.
- A failed observation returns to the owning slice instead of restarting the meta cycle.
- The run needs a live human at the workbench and orchestrator attention for the 4 to 8 hour build window.

References: `docs/meta-specs/rivr-stage-generation.md` (Tandem Completion Protocol, Acceptance Parameters, ADR List), batch 005 doctrine, `docs/specs/009-agent-context-compaction.md` (Out of Scope). Certification commits `6a280248`, `574ad1c5`. Meta ledger stage `research_update`.