import { describe, it, expect } from 'vitest';
import {
  computePlanProgress,
  defaultPlan,
  PINNED_PLAN,
  PINNED_TABLE_TOTAL,
  PLAN_LABEL_TOTAL,
} from '../../lib/server/agent-runtime/plan-progress';
import type { StagePageSummary } from '../../lib/server/agent-runtime/plan-progress';

const plan = defaultPlan();

/** Current database state: Stage 1 = 8, Stage 2 = 7, Stage 3 = 0, Stages 4-7 absent. */
const currentDb: StagePageSummary[] = [
  { stage: 1, sceneCount: 8 },
  { stage: 2, sceneCount: 7 },
  { stage: 3, sceneCount: 0 },
];

describe('computePlanProgress', () => {
  describe('current database state', () => {
    it('reports Stage 1 complete (8/8)', () => {
      const report = computePlanProgress(plan, currentDb);
      const s1 = report.stages.find((r) => r.stage === 1)!;
      expect(s1.pinnedPages).toBe(8);
      expect(s1.sceneCount).toBe(8);
      expect(s1.status).toBe('matching');
    });

    it('reports Stage 2 complete (7/7)', () => {
      const report = computePlanProgress(plan, currentDb);
      const s2 = report.stages.find((r) => r.stage === 2)!;
      expect(s2.pinnedPages).toBe(7);
      expect(s2.sceneCount).toBe(7);
      expect(s2.status).toBe('matching');
    });

    it('reports Stage 3 missing (0/7)', () => {
      const report = computePlanProgress(plan, currentDb);
      const s3 = report.stages.find((r) => r.stage === 3)!;
      expect(s3.pinnedPages).toBe(7);
      expect(s3.sceneCount).toBe(0);
      expect(s3.status).toBe('missing');
    });

    it('reports Stages 4-7 absent (not in summaries)', () => {
      const report = computePlanProgress(plan, currentDb);
      for (const stageNum of [4, 5, 6, 7]) {
        const row = report.stages.find((r) => r.stage === stageNum)!;
        expect(row.sceneCount).toBe(0);
        expect(row.status).toBe('missing');
      }
    });

    it('allComplete is false when any stage is missing', () => {
      const report = computePlanProgress(plan, currentDb);
      expect(report.allComplete).toBe(false);
    });
  });

  describe('over-built stage', () => {
    it('reports over-built, not complete, when scenes exceed pinned', () => {
      const summaries: StagePageSummary[] = [{ stage: 1, sceneCount: 9 }];
      const report = computePlanProgress(plan, summaries);
      const s1 = report.stages.find((r) => r.stage === 1)!;
      expect(s1.pinnedPages).toBe(8);
      expect(s1.sceneCount).toBe(9);
      expect(s1.status).toBe('over-built');
    });
  });

  describe('foreign stages ignored', () => {
    it('ignores summaries for stages not in the plan', () => {
      const summaries: StagePageSummary[] = [
        { stage: 1, sceneCount: 8 },
        { stage: 99, sceneCount: 5 },
      ];
      const report = computePlanProgress(plan, summaries);
      // Stage 99 should not appear
      expect(report.stages.find((r) => r.stage === 99)).toBeUndefined();
      // Stage 1 should still be correct
      expect(report.stages.find((r) => r.stage === 1)!.status).toBe('matching');
    });
  });

  describe('52 vs 50 label discrepancy', () => {
    it('flags labelDiscrepancy when labelTotal != tableTotal', () => {
      const report = computePlanProgress(plan, currentDb);
      expect(report.labelDiscrepancy).toBe(true);
    });

    it('does not flag when label matches table total', () => {
      const matchedPlan = {
        stages: PINNED_PLAN,
        labelTotal: PINNED_TABLE_TOTAL,
        tableTotal: PINNED_TABLE_TOTAL,
      };
      const report = computePlanProgress(matchedPlan, currentDb);
      expect(report.labelDiscrepancy).toBe(false);
    });
  });

  describe('allComplete', () => {
    it('true when every plan stage matches', () => {
      const summaries: StagePageSummary[] = [
        { stage: 1, sceneCount: 8 },
        { stage: 2, sceneCount: 7 },
        { stage: 3, sceneCount: 7 },
        { stage: 4, sceneCount: 7 },
        { stage: 5, sceneCount: 7 },
        { stage: 6, sceneCount: 7 },
        { stage: 7, sceneCount: 7 },
      ];
      const report = computePlanProgress(plan, summaries);
      expect(report.allComplete).toBe(true);
      expect(report.stages.every((r) => r.status === 'matching')).toBe(true);
    });
  });

  describe('partial stage (scenes < pinned)', () => {
    it('reports missing for a partially built stage', () => {
      const summaries: StagePageSummary[] = [{ stage: 3, sceneCount: 4 }];
      const report = computePlanProgress(plan, summaries);
      const s3 = report.stages.find((r) => r.stage === 3)!;
      expect(s3.sceneCount).toBe(4);
      expect(s3.status).toBe('missing');
    });
  });
});
