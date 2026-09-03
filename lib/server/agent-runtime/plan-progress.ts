/**
 * Pure helper that compares a pinned stage-page plan against a list of
 * actual stage summaries (scene counts) and produces a progress report.
 *
 * No database access. The caller passes summaries in.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pinned per-stage page count from the approved plan. */
export interface StagePlanEntry {
  /** Stage number (1-based). */
  stage: number;
  /** Pinned page count for this stage. */
  pinnedPages: number;
  /** Optional display label (e.g. "Stage 1: Statics Refresher"). */
  label?: string;
}

/**
 * The pinned default plan from the approved build.
 *
 * Tables enumerate 8 rows for Stage 1 and 7 rows for each of Stages 2-7.
 * The plan text and approval both say 52. The tables sum to 50.
 * That 2-page discrepancy is surfaced as a flag on the report.
 */
export const PINNED_PLAN: StagePlanEntry[] = [
  { stage: 1, pinnedPages: 8, label: 'Stage 1: Statics Refresher' },
  { stage: 2, pinnedPages: 7, label: 'Stage 2: Free Body Diagrams' },
  { stage: 3, pinnedPages: 7, label: 'Stage 3: Force Systems' },
  { stage: 4, pinnedPages: 7, label: 'Stage 4: Equilibrium Equations' },
  { stage: 5, pinnedPages: 7, label: 'Stage 5: Truss Analysis' },
  { stage: 6, pinnedPages: 7, label: 'Stage 6: Frame and Machine Analysis' },
  { stage: 7, pinnedPages: 7, label: 'Stage 7: Cram Prep Review' },
];

/** The sum of all pinned page counts in the default plan. */
export const PINNED_TABLE_TOTAL = 50;

/** The label in the plan text / approval that says 52. */
export const PLAN_LABEL_TOTAL = 52;

/** Full plan shape: stage entries and a label total for discrepancy flagging. */
export interface StagePagePlan {
  /** Ordered list of stages with pinned page counts. */
  stages: StagePlanEntry[];
  /** The total stated in the plan text / approval (may differ from table sum). */
  labelTotal: number;
  /** The actual sum of pinnedPages across all stages. */
  tableTotal: number;
}

/** Summary of actual scenes for one stage, as passed in by the caller. */
export interface StagePageSummary {
  /** Stage number (1-based). Must match a stage in the plan. */
  stage: number;
  /** Number of scenes actually built for this stage. */
  sceneCount: number;
}

/** Status of a single stage in the progress report. */
export type StageStatus = 'missing' | 'matching' | 'over-built' | 'absent';

/** One row in the per-stage progress report. */
export interface StageProgressRow {
  /** Stage number (1-based). */
  stage: number;
  /** Optional display label from the plan. */
  label?: string;
  /** Pinned page count from the plan. */
  pinnedPages: number;
  /** Actual scene count from the summary (0 if absent). */
  sceneCount: number;
  /** Derived status. */
  status: StageStatus;
}

/** Full progress report returned by computePlanProgress. */
export interface PlanProgressReport {
  /** Per-stage rows in plan order. */
  stages: StageProgressRow[];
  /** True when labelTotal != tableTotal on the plan. */
  labelDiscrepancy: boolean;
  /** True when all plan stages are complete (matching). */
  allComplete: boolean;
}

// ---------------------------------------------------------------------------
// computePlanProgress
// ---------------------------------------------------------------------------

/**
 * Compare a pinned plan against actual stage summaries.
 *
 * Pure over its arguments. No database access, no side effects.
 *
 * @param plan - The pinned stage-page plan.
 * @param stages - Actual stage summaries (scene counts) from the caller.
 * @returns A progress report with per-stage status and discrepancy flag.
 */
export function computePlanProgress(
  plan: StagePagePlan,
  stages: StagePageSummary[],
): PlanProgressReport {
  const summaryMap = new Map<number, number>();
  for (const s of stages) {
    summaryMap.set(s.stage, s.sceneCount);
  }

  const stageRows: StageProgressRow[] = plan.stages.map((entry) => {
    const sceneCount = summaryMap.get(entry.stage) ?? 0;
    let status: StageStatus;
    if (sceneCount === 0) {
      status = 'missing';
    } else if (sceneCount === entry.pinnedPages) {
      status = 'matching';
    } else if (sceneCount > entry.pinnedPages) {
      status = 'over-built';
    } else {
      // sceneCount > 0 but < pinnedPages
      status = 'missing';
    }
    return {
      stage: entry.stage,
      label: entry.label,
      pinnedPages: entry.pinnedPages,
      sceneCount,
      status,
    };
  });

  const allComplete = stageRows.every((r) => r.status === 'matching');

  return {
    stages: stageRows,
    labelDiscrepancy: plan.labelTotal !== plan.tableTotal,
    allComplete,
  };
}

/**
 * Convenience: build the default StagePagePlan from PINNED_PLAN.
 */
export function defaultPlan(): StagePagePlan {
  return {
    stages: PINNED_PLAN,
    labelTotal: PLAN_LABEL_TOTAL,
    tableTotal: PINNED_TABLE_TOTAL,
  };
}
