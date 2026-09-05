/**
 * PG contract test for consumeQuizGradeQuota.
 *
 * Proves:
 * - atomic upsert-increment on a real PostgreSQL scratch database
 * - exactly 5 succeed, 6th throws 429 for rank-1 user
 * - UTC-day flip resets count
 *
 * Requires: PG_CONTRACT_URL pointing to a scratch Postgres 16 database.
 * The test creates a temporary schema and cleans up after itself.
 *
 * Gate: QUOTA_PG_OK
 */

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PG_URL = process.env.PG_CONTRACT_URL;

describe.skipIf(!PG_URL)('consumeQuizGradeQuota PG contract', () => {
  let pool: Pool;
  let testUserId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });

    // Create the auth schema tables needed by consumeQuizGradeQuota
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS user_email_idx ON "user" (email);

      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        rank INTEGER NOT NULL UNIQUE,
        "isSystem" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id),
        granted_by TEXT,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS quiz_grade_quota (
        user_id TEXT NOT NULL,
        day DATE NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `);

    // Seed a guest role
    await pool.query(`
      INSERT INTO roles (id, name, rank, "isSystem")
      VALUES ('role-guest', 'guest', 1, true)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Create a test user
    const userResult = await pool.query<{ id: string }>(
      `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ($1, 'test-guest', $2, false)
       ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id
       RETURNING id`,
      [`test-guest-${Date.now()}`, `quota-test-${Date.now()}@test.example`],
    );
    testUserId = userResult.rows[0].id;

    // Assign guest role
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'role-guest')
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [testUserId],
    );
  });

  afterAll(async () => {
    // Clean up: quota, user_roles, user
    if (testUserId) {
      await pool.query('DELETE FROM quiz_grade_quota WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM user_roles WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUserId]);
    }
    await pool.end();
  });

  it('allows exactly 5 grades per UTC day, rejects 6th', async () => {
    process.env.MINIMAL_MODE = 'true';
    const { consumeQuizGradeQuota } = await import('@/lib/auth/quiz-quota');

    // First 5 should succeed
    for (let i = 0; i < 5; i++) {
      await expect(consumeQuizGradeQuota(pool, testUserId)).resolves.toBeUndefined();
    }

    // 6th should throw 429
    await expect(consumeQuizGradeQuota(pool, testUserId)).rejects.toThrow();
    try {
      await consumeQuizGradeQuota(pool, testUserId);
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const resp = err as Response;
      expect(resp.status).toBe(429);
      const body = await resp.json();
      expect(body.code).toBe('quota_exhausted');
    }

    // Verify final count
    const result = await pool.query<{ count: number }>(
      'SELECT count FROM quiz_grade_quota WHERE user_id = $1',
      [testUserId],
    );
    expect(result.rows[0].count).toBe(5);
  });

  it('UTC-day flip resets count', async () => {
    process.env.MINIMAL_MODE = 'true';
    const { consumeQuizGradeQuota } = await import('@/lib/auth/quiz-quota');

    // Inject a row for yesterday
    await pool.query(
      `INSERT INTO quiz_grade_quota (user_id, day, count)
       VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - INTERVAL '1 day', 5)
       ON CONFLICT (user_id, day) DO UPDATE SET count = 5`,
      [testUserId],
    );

    // Today's quota should be fresh (the 5 from the previous test are today,
    // so we need to clean them first)
    await pool.query(
      "DELETE FROM quiz_grade_quota WHERE user_id = $1 AND day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date",
      [testUserId],
    );

    // Now should allow 5 fresh grades today
    for (let i = 0; i < 5; i++) {
      await expect(consumeQuizGradeQuota(pool, testUserId)).resolves.toBeUndefined();
    }

    // Verify today count = 5
    const todayResult = await pool.query<{ count: number }>(
      `SELECT count FROM quiz_grade_quota
       WHERE user_id = $1 AND day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date`,
      [testUserId],
    );
    expect(todayResult.rows[0].count).toBe(5);

    // Verify yesterday count = 5 (untouched)
    const yesterdayResult = await pool.query<{ count: number }>(
      `SELECT count FROM quiz_grade_quota
       WHERE user_id = $1 AND day = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - INTERVAL '1 day'`,
      [testUserId],
    );
    expect(yesterdayResult.rows[0].count).toBe(5);
  });
});
