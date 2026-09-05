/**
 * Per-day quiz grading quota for rank-1 guests.
 *
 * When MINIMAL_MODE is on, each rank-1 guest may grade at most 5 quizzes
 * per UTC calendar day. The consumer acquires a row lock, checks the current
 * count, and increments only when below the cap. This prevents the off-by-one
 * where RETURNING count=5 could be misread as denial.
 *
 * Rank-2+ users and flag-off callers return without writing.
 */

import type { Queryable } from '@openmaic/storage/document/pg';
import { isMinimalModeEnabled } from '@/lib/config/feature-flags';

const DAILY_LIMIT = 5;

/**
 * Consumes one quiz grade quota slot for the given user.
 *
 * Returns normally when allowed. Throws a Response with status 429 and body
 * `{ message: "quiz grading quota exhausted", code: "quota_exhausted" }`
 * when the daily cap is reached. Rank-2+ users and flag-off callers return
 * without writing.
 *
 * @param queryable - Database connection (Pool, Client, or fake).
 * @param userId - The user ID from the authenticated session.
 */
// prettier-ignore
export async function consumeQuizGradeQuota(
  queryable: Queryable,
  userId: string,
): Promise<void> {
  // Kill-switch: no-op when MINIMAL_MODE is off.
  if (!isMinimalModeEnabled()) return;

  // Resolve the user's role rank. Rank-1 is guest; rank-2+ bypass.
  const rankResult = await queryable.query<{ rank: number }>(
    `SELECT r.rank FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
    [userId],
  );
  const rank = rankResult.rows.length > 0 ? rankResult.rows[0].rank : 0;
  if (rank >= 2) return;

  // Atomic check-and-increment keyed by (user_id, UTC day).
  // For real Pool connections, use a transaction with SELECT FOR UPDATE
  // to avoid the RETURNING ambiguity where count=5 could mean either
  // "just incremented to 5" (allowed) or "was already at 5" (denied).
  // For unit test fakes (no connect()), fall back to a single-SQL upsert.
  const maybePool = queryable as {
    connect?: () => Promise<{ query: Queryable['query']; release: () => void }>;
  };

  if (typeof maybePool.connect === 'function') {
    const client = await maybePool.connect();
    try {
      await client.query('BEGIN');

      // Lock the row and read the current count atomically.
      const lockResult = await client.query<{ count: number }>(
        `SELECT count FROM quiz_grade_quota
         WHERE user_id = $1 AND day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
         FOR UPDATE`,
        [userId],
      );

      const currentCount = lockResult.rows.length > 0 ? lockResult.rows[0].count : 0;

      if (currentCount >= DAILY_LIMIT) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Response(
          JSON.stringify({ message: 'quiz grading quota exhausted', code: 'quota_exhausted' }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        );
      }

      // Increment the count (insert if first time, update otherwise).
      if (lockResult.rows.length > 0) {
        await client.query(
          `UPDATE quiz_grade_quota SET count = count + 1
           WHERE user_id = $1 AND day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`,
          [userId],
        );
      } else {
        await client.query(
          `INSERT INTO quiz_grade_quota (user_id, day, count)
           VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)`,
          [userId],
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      if (!(e instanceof Response)) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw e;
    } finally {
      client.release();
    }
  } else {
    // Fallback for unit test fakes: single-SQL upsert.
    // The CASE uses count <= DAILY_LIMIT so that the 5th increment (4->5)
    // returns count=5 and the JS check (count > DAILY_LIMIT) allows it.
    // The 6th call returns count=6 and the JS check rejects it.
    const result = await queryable.query<{ count: number }>(
      `INSERT INTO quiz_grade_quota (user_id, day, count)
       VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)
       ON CONFLICT (user_id, day) DO UPDATE
         SET count = CASE
           WHEN quiz_grade_quota.count <= $2 THEN quiz_grade_quota.count + 1
           ELSE quiz_grade_quota.count
         END
       RETURNING count`,
      [userId, DAILY_LIMIT],
    );

    const count = result.rows.length > 0 ? result.rows[0].count : DAILY_LIMIT;
    if (count > DAILY_LIMIT) {
      throw new Response(
        JSON.stringify({ message: 'quiz grading quota exhausted', code: 'quota_exhausted' }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      );
    }
  }
}
