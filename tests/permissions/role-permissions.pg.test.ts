/**
 * role_permissions PG contract — proves the override table and server
 * resolver against a real PostgreSQL instance.
 *
 * Provisions a scratch database, runs the full ensureAuthSchema chain,
 * seeds system roles, inserts role_permissions rows, and verifies
 * resolvePermissionSet merges correctly.
 *
 * Gate: fails closed when PG_CONTRACT_URL is not set.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureAuthSchema } from '../../lib/auth/schema';
import { seedRoleGrants } from '../../lib/auth/roles';
import { resolvePermissionSet } from '../../lib/auth/permissions-server';
import type { Role } from '../../lib/auth/roles';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('role_permissions PG contract', () => {
  const CONTRACT_DB = `openmaic_role_perm_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();

    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

    // Run the full ensure chain — creates all tables including role_permissions.
    await ensureAuthSchema(pool);

    // Seed system roles so foreign keys resolve.
    await seedRoleGrants(pool, []);
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB} WITH (FORCE)`);
    await admin.end();
  }, 15_000);

  // Helper to fetch a role by name from the seeded DB.
  async function getRole(name: string): Promise<Role> {
    const result = await pool.query<{
      id: string;
      name: string;
      rank: number;
      is_system: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, name, rank, "isSystem" as is_system,
              "createdAt" as created_at, "updatedAt" as updated_at
         FROM roles WHERE name = $1`,
      [name],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`role "${name}" not found`);
    return {
      id: row.id,
      name: row.name,
      rank: row.rank,
      isSystem: row.is_system,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // -----------------------------------------------------------------------
  // Table existence
  // -----------------------------------------------------------------------

  describe('role_permissions table', () => {
    it('exists after ensureAuthSchema', async () => {
      const result = await pool.query(
        `SELECT EXISTS (
           SELECT FROM information_schema.tables
           WHERE table_name = 'role_permissions'
         )`,
      );
      expect(result.rows[0].exists).toBe(true);
    });

    it('has the expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_name = 'role_permissions'
          ORDER BY ordinal_position`,
      );
      const cols = result.rows.map((r) => r.column_name);
      expect(cols).toContain('role_name');
      expect(cols).toContain('permission');
      expect(cols).toContain('granted');
    });
  });

  // -----------------------------------------------------------------------
  // Resolver against real DB
  // -----------------------------------------------------------------------

  describe('resolvePermissionSet against real DB', () => {
    it('guest gets rank defaults when no overrides exist', async () => {
      // Use a fresh pool for cache isolation.
      const freshPool = new Pool({
        connectionString: databaseUrl(url, CONTRACT_DB),
        max: 2,
      });
      const guest = await getRole('guest');
      const perms = await resolvePermissionSet(freshPool, guest);
      expect(perms.has('quiz.grade')).toBe(true);
      expect(perms.size).toBe(1);
      await freshPool.end();
    });

    it('granted true adds a permission', async () => {
      const freshPool = new Pool({
        connectionString: databaseUrl(url, CONTRACT_DB),
        max: 2,
      });
      const guest = await getRole('guest');
      await pool.query(
        `INSERT INTO role_permissions (role_name, permission, granted)
         VALUES ($1, $2, true)
         ON CONFLICT (role_name, permission) DO UPDATE SET granted = EXCLUDED.granted`,
        [guest.name, 'course.create'],
      );

      const perms = await resolvePermissionSet(freshPool, guest);
      expect(perms.has('course.create')).toBe(true);
      expect(perms.has('quiz.grade')).toBe(true);

      // Cleanup.
      await pool.query(`DELETE FROM role_permissions WHERE role_name = $1 AND permission = $2`, [
        guest.name,
        'course.create',
      ]);
      await freshPool.end();
    });

    it('granted false removes a permission', async () => {
      const freshPool = new Pool({
        connectionString: databaseUrl(url, CONTRACT_DB),
        max: 2,
      });
      const guest = await getRole('guest');
      await pool.query(
        `INSERT INTO role_permissions (role_name, permission, granted)
         VALUES ($1, $2, false)
         ON CONFLICT (role_name, permission) DO UPDATE SET granted = EXCLUDED.granted`,
        [guest.name, 'quiz.grade'],
      );

      const perms = await resolvePermissionSet(freshPool, guest);
      expect(perms.has('quiz.grade')).toBe(false);

      // Cleanup.
      await pool.query(`DELETE FROM role_permissions WHERE role_name = $1 AND permission = $2`, [
        guest.name,
        'quiz.grade',
      ]);
      await freshPool.end();
    });

    it('multiple overrides merge correctly', async () => {
      const freshPool = new Pool({
        connectionString: databaseUrl(url, CONTRACT_DB),
        max: 2,
      });
      const learner = await getRole('learner');
      await pool.query(
        `INSERT INTO role_permissions (role_name, permission, granted)
         VALUES ($1, $2, true), ($1, $3, false)
         ON CONFLICT (role_name, permission) DO UPDATE SET granted = EXCLUDED.granted`,
        [learner.name, 'course.create', 'quiz.grade'],
      );

      const perms = await resolvePermissionSet(freshPool, learner);
      expect(perms.has('course.create')).toBe(true);
      expect(perms.has('quiz.grade')).toBe(false);
      expect(perms.has('classroom.chat')).toBe(true);

      // Cleanup.
      await pool.query(`DELETE FROM role_permissions WHERE role_name = $1`, [learner.name]);
      await freshPool.end();
    });

    it('admin gets all eleven with no overrides', async () => {
      const freshPool = new Pool({
        connectionString: databaseUrl(url, CONTRACT_DB),
        max: 2,
      });
      const admin = await getRole('admin');
      const perms = await resolvePermissionSet(freshPool, admin);
      expect(perms.size).toBe(11);
      await freshPool.end();
    });
  });
});
