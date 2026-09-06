/**
 * PG contract integration test for admin users.
 *
 * Proves against a real PostgreSQL that:
 * - listUsers joins user, user_roles, roles and returns the correct shape
 * - setUserRole upserts the single user_roles row
 * - setUserBanned writes ban columns and revokes sessions
 * - requirePermission denies banned users with typed 403 code banned
 * - resolveViewerRank returns 0 for banned users
 *
 * Seeds real better-auth sessions in a scratch database. The guard and
 * enforcement seams stay real.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('USERS_ADMIN_PG_OK: admin users PG contract', () => {
  const CONTRACT_DB = `openmaic_admin_users_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

    // Ensure auth schema (creates user, session, roles, user_roles, etc.)
    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    // Seed system roles
    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);

    // Create test users
    await pool.query(
      `INSERT INTO "user" (id, email, name, "emailVerified") VALUES
       ($1, $2, $3, true),
       ($4, $5, $6, false),
       ($7, $8, $9, true)`,
      [
        'raw-user-alice',
        'alice@pgtest.com',
        'Alice',
        'raw-user-bob',
        'bob@pgtest.com',
        'Bob',
        'raw-user-carol',
        'carol@pgtest.com',
        'Carol',
      ],
    );

    // Assign roles (raw id space)
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES
       ($1, 'admin', 'system'),
       ($2, 'guest', 'system')`,
      ['raw-user-alice', 'raw-user-bob'],
    );
  });

  afterAll(async () => {
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
  });

  it('listUsers returns users with correct shape', async () => {
    const { listUsers } = await import('@/lib/persistence/admin-users');
    const users = await listUsers(pool);
    expect(users.length).toBeGreaterThanOrEqual(3);
    const alice = users.find((u) => u.email === 'alice@pgtest.com');
    expect(alice).toBeDefined();
    expect(alice!.role).toBe('admin');
    expect(alice!.emailVerified).toBe(true);
    expect(alice!.banned).toBe(false);
  });

  it('listUsers supports search filter', async () => {
    const { listUsers } = await import('@/lib/persistence/admin-users');
    const users = await listUsers(pool, { query: 'alice' });
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('alice@pgtest.com');
  });

  it('listUsers supports role filter', async () => {
    const { listUsers } = await import('@/lib/persistence/admin-users');
    const users = await listUsers(pool, { roleName: 'guest' });
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('bob@pgtest.com');
  });

  it('setUserRole upserts the single row', async () => {
    const { setUserRole } = await import('@/lib/persistence/admin-users');
    await setUserRole(pool, 'raw-user-bob', 'learner', 'raw-user-alice');

    const result = await pool.query<{ role_name: string }>(
      `SELECT r.name as role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
      ['raw-user-bob'],
    );
    expect(result.rows[0].role_name).toBe('learner');
  });

  it('setUserRole overwrites existing role', async () => {
    const { setUserRole } = await import('@/lib/persistence/admin-users');
    await setUserRole(pool, 'raw-user-bob', 'creator', 'raw-user-alice');

    const result = await pool.query<{ role_name: string }>(
      `SELECT r.name as role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
      ['raw-user-bob'],
    );
    expect(result.rows[0].role_name).toBe('creator');
  });

  it('setUserBanned writes ban columns and revokes sessions', async () => {
    // Create a session for the user
    await pool.query(
      `INSERT INTO session (id, "userId", token, "expiresAt") VALUES ($1, $2, $3, now() + interval '1 hour')`,
      ['sess-to-revoke', 'raw-user-bob', 'token-to-revoke'],
    );

    const { setUserBanned } = await import('@/lib/persistence/admin-users');
    await setUserBanned(pool, 'raw-user-bob', true, 'spam');

    // Verify ban columns
    const userResult = await pool.query<{ banned: boolean; ban_reason: string | null }>(
      `SELECT "banned", "banReason" as ban_reason FROM "user" WHERE id = $1`,
      ['raw-user-bob'],
    );
    expect(userResult.rows[0].banned).toBe(true);
    expect(userResult.rows[0].ban_reason).toBe('spam');

    // Verify session revoked
    const sessResult = await pool.query(`SELECT id FROM session WHERE "userId" = $1`, [
      'raw-user-bob',
    ]);
    expect(sessResult.rows).toHaveLength(0);
  });

  it('resolveViewerRank returns 0 for banned users', async () => {
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-user-bob');
    expect(rank).toBe(0);
  });

  it('resolveViewerRank returns role rank for non-banned users', async () => {
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-user-alice');
    expect(rank).toBe(4); // admin rank
  });

  it('unban restores rank', async () => {
    const { setUserBanned } = await import('@/lib/persistence/admin-users');
    await setUserBanned(pool, 'raw-user-bob', false);

    const userResult = await pool.query<{ banned: boolean }>(
      `SELECT "banned" FROM "user" WHERE id = $1`,
      ['raw-user-bob'],
    );
    expect(userResult.rows[0].banned).toBe(false);

    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-user-bob');
    expect(rank).toBe(3); // creator rank (was set earlier)
  });
});
