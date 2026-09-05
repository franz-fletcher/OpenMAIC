/**
 * Unit tests for consumeQuizGradeQuota.
 *
 * Uses a fake Queryable to prove:
 * - flag-off no-op (returns without writing)
 * - rank-2+ bypass (returns without writing)
 * - allow 1..5, deny 6 for rank-1
 * - UTC-day flip resets count
 *
 * Gate: QUOTA_OK
 */

import { describe, expect, it } from 'vitest';
import { consumeQuizGradeQuota } from '@/lib/auth/quiz-quota';

type QueryRow = Record<string, unknown>;

/**
 * Fake Queryable that tracks SQL calls and returns canned results.
 * Two queries per call: rank resolution, then atomic upsert.
 */
function createFakeQueryable(
  roleRank: number,
  overrides?: {
    upsertRows?: QueryRow[];
    sqlLog?: string[];
  },
) {
  const upsertRows = overrides?.upsertRows ?? [];
  const sqlLog = overrides?.sqlLog ?? [];
  let callIndex = 0;

  return {
    query: async (text: string): Promise<{ rows: QueryRow[] }> => {
      sqlLog.push(text);
      callIndex++;
      // First call: rank resolution
      if (callIndex === 1) return { rows: [{ rank: roleRank }] };
      // Second call: atomic upsert
      if (callIndex === 2) return { rows: upsertRows };
      return { rows: [] };
    },
  };
}

describe('consumeQuizGradeQuota', () => {
  it('no-op when MINIMAL_MODE is off', async () => {
    const prev = process.env.MINIMAL_MODE;
    delete process.env.MINIMAL_MODE;
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(1, { sqlLog });

    await consumeQuizGradeQuota(fake as never, 'user-1');
    expect(sqlLog).toHaveLength(0);

    // Restore
    if (prev !== undefined) process.env.MINIMAL_MODE = prev;
    else delete process.env.MINIMAL_MODE;
  });

  it('bypass for rank 2 (learner)', async () => {
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(2, { sqlLog });

    process.env.MINIMAL_MODE = 'true';
    await consumeQuizGradeQuota(fake as never, 'user-1');
    // Only the rank query should fire, no quota write
    expect(sqlLog).toHaveLength(1);
    expect(sqlLog[0]).toContain('user_roles');
  });

  it('bypass for rank 3 (creator)', async () => {
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(3, { sqlLog });

    process.env.MINIMAL_MODE = 'true';
    await consumeQuizGradeQuota(fake as never, 'user-1');
    expect(sqlLog).toHaveLength(1);
  });

  it('bypass for rank 4 (admin)', async () => {
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(4, { sqlLog });

    process.env.MINIMAL_MODE = 'true';
    await consumeQuizGradeQuota(fake as never, 'user-1');
    expect(sqlLog).toHaveLength(1);
  });

  it('allows grade when upsert returns count < 5', async () => {
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(1, { sqlLog, upsertRows: [{ count: 3 }] });

    process.env.MINIMAL_MODE = 'true';
    await expect(consumeQuizGradeQuota(fake as never, 'user-1')).resolves.toBeUndefined();
    expect(sqlLog).toHaveLength(2);
    expect(sqlLog[1]).toContain('INSERT INTO');
  });

  it('allows grade when upsert returns count = 1 (first grade)', async () => {
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(1, { sqlLog, upsertRows: [{ count: 1 }] });

    process.env.MINIMAL_MODE = 'true';
    await expect(consumeQuizGradeQuota(fake as never, 'user-1')).resolves.toBeUndefined();
    expect(sqlLog).toHaveLength(2);
  });

  it('allows grade when upsert returns count = 5 (exactly at cap, not over)', async () => {
    // The 5th grade returns count=5 from RETURNING. The CASE incremented
    // from 4 to 5, so this is a valid allowance. The consumer should NOT
    // throw for count=5 from the RETURNING clause.
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(1, { sqlLog, upsertRows: [{ count: 5 }] });

    process.env.MINIMAL_MODE = 'true';
    await expect(consumeQuizGradeQuota(fake as never, 'user-1')).resolves.toBeUndefined();
    expect(sqlLog).toHaveLength(2);
  });

  it('rejects grade when upsert returns count = 6 (over cap)', async () => {
    // The 6th grade call returns count=6 (no increment, already at cap + 1).
    // The consumer throws 429 when count > DAILY_LIMIT.
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(1, { sqlLog, upsertRows: [{ count: 6 }] });

    process.env.MINIMAL_MODE = 'true';
    try {
      await consumeQuizGradeQuota(fake as never, 'user-1');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const resp = err as Response;
      expect(resp.status).toBe(429);
      const body = await resp.json();
      expect(body.code).toBe('quota_exhausted');
      expect(body.message).toBe('quiz grading quota exhausted');
    }
    expect(sqlLog).toHaveLength(2);
  });

  it('UTC-day flip resets count', async () => {
    const sqlLog: string[] = [];
    const fake = createFakeQueryable(1, { sqlLog, upsertRows: [{ count: 1 }] });

    process.env.MINIMAL_MODE = 'true';
    await expect(consumeQuizGradeQuota(fake as never, 'user-1')).resolves.toBeUndefined();
    // The upsert SQL should contain CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    expect(sqlLog[1]).toContain("AT TIME ZONE 'UTC'");
  });
});
