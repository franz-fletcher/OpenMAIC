/**
 * Adversarial concurrency test for consumeQuizGradeQuota.
 *
 * Proves the SQL is single-statement atomic under concurrent access:
 * - Fires N=12 concurrent consumeQuizGradeQuota calls for one guest
 * - Asserts exactly 5 succeed, 7 get 429
 * - Final count = 5 (no lost updates)
 *
 * Requires: PG_CONTRACT_URL pointing to a scratch Postgres 16 database.
 *
 * Gate: QUOTA_RACE_OK
 */

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PG_URL = process.env.PG_CONTRACT_URL;

describe.skipIf(!PG_URL)('consumeQuizGradeQuota concurrency adversarial', () => {
  let pool: Pool;
  let testUserId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });

    // Create the auth schema tables
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

    // Seed guest role
    await pool.query(`
      INSERT INTO roles (id, name, rank, "isSystem")
      VALUES ('role-guest', 'guest', 1, true)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Create test user
    const userResult = await pool.query<{ id: string }>(
      `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ($1, 'race-guest', $2, false)
       ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id
       RETURNING id`,
      [`race-guest-${Date.now()}`, `race-test-${Date.now()}@test.example`],
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
    if (testUserId) {
      await pool.query('DELETE FROM quiz_grade_quota WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM user_roles WHERE user_id = $1', [testUserId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [testUserId]);
    }
    await pool.end();
  });

  it('N=12 concurrent calls: exactly 5 succeed, 7 rejected, final count = 5', async () => {
    process.env.MINIMAL_MODE = 'true';
    const { consumeQuizGradeQuota } = await import('@/lib/auth/quiz-quota');

    const N = 12;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => consumeQuizGradeQuota(pool, testUserId)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;

    expect(succeeded).toBe(5);
    expect(rejected).toBe(7);

    // Verify no lost updates: final count must be exactly 5
    const finalResult = await pool.query<{ count: number }>(
      'SELECT count FROM quiz_grade_quota WHERE user_id = $1',
      [testUserId],
    );
    expect(finalResult.rows[0].count).toBe(5);
  });
});
