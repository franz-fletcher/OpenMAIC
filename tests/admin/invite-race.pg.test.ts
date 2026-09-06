/**
 * Adversarial concurrency test for invite consumption.
 *
 * Proves the SQL is single-statement atomic under concurrent access:
 * - Creates an invite
 * - Fires N=10 concurrent consumeInvite calls for the same code
 * - Asserts exactly 1 succeeds (returns the role name)
 * - Asserts exactly 9 return null
 * - Final state: 1 used row, 0 pending rows
 *
 * Mirrors the QUOTA_RACE_OK precedent from tests/minimal-mode/quiz-quota-concurrency.pg.test.ts.
 *
 * Requires: PG_CONTRACT_URL pointing to a scratch Postgres 16 database.
 *
 * Gate: INVITE_RACE_OK
 */

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PG_URL = process.env.PG_CONTRACT_URL;

describe.skipIf(!PG_URL)('INVITE_RACE_OK: invite race adversarial', () => {
  let pool: Pool;
  let inviteCode: string;
  let inviteId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });

    // Ensure auth schema.
    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    // Seed system roles.
    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);

    // Create a test user to consume the invite.
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ($1, 'race-user', $2, true)
       ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id`,
      [`race-user-${Date.now()}`, `race-test-${Date.now()}@test.example`],
    );

    // Create a test invite.
    const { createInvite } = await import('@/lib/auth/invites');
    const invite = await createInvite(
      pool,
      `race-invite-${Date.now()}@test.example`,
      'learner',
      'admin-user',
    );
    inviteCode = invite.code;
    inviteId = invite.id;
  });

  afterAll(async () => {
    if (inviteId) {
      await pool.query('DELETE FROM invites WHERE id = $1', [inviteId]);
    }
    await pool.end();
  });

  it('N=10 concurrent accepts: exactly 1 succeeds, 9 rejected, final state = 1 used row', async () => {
    const { consumeInvite } = await import('@/lib/auth/invites');

    const N = 10;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) => consumeInvite(pool, inviteCode, `race-user-${i}`)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value !== null).length;
    const rejected = results.filter((r) => r.status === 'fulfilled' && r.value === null).length;

    expect(succeeded).toBe(1);
    expect(rejected).toBe(N - 1);

    // Verify final state: exactly 1 used row for this invite.
    const usedResult = await pool.query<{ count: number }>(
      'SELECT count(*) as count FROM invites WHERE id = $1 AND used_at IS NOT NULL',
      [inviteId],
    );
    expect(Number(usedResult.rows[0].count)).toBe(1);

    // Verify no pending rows remain.
    const pendingResult = await pool.query<{ count: number }>(
      'SELECT count(*) as count FROM invites WHERE id = $1 AND used_at IS NULL',
      [inviteId],
    );
    expect(Number(pendingResult.rows[0].count)).toBe(0);
  });
});
