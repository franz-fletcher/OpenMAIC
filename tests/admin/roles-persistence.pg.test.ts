/**
 * PG contract integration test for roles persistence.
 *
 * Proves against a real PostgreSQL that:
 * - ensureAuthSchema drops the roles_rank_key constraint
 * - Two roles can share rank 2 after the constraint drop
 * - listRolesWithPermissions merges defaults with overrides
 * - createRole inserts a custom role with overrides
 * - updateRole renames, re-ranks, and replaces overrides atomically
 * - resetRoleOverrides clears role_permissions rows
 * - deleteRole refuses system roles, attached users, and pending invites
 * - deleteRole removes override rows for deleted role
 *
 * Seeds real data in a scratch database. No mocking.
 *
 * Gate: ROLES_CORE_PG_OK
 */

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('ROLES_CORE_PG_OK: roles persistence PG contract', () => {
  const CONTRACT_DB = `openmaic_roles_core_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

    // Ensure auth schema (creates tables + drops rank constraint).
    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    // Seed system roles.
    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);
  });

  afterAll(async () => {
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
  });

  it('ensureAuthSchema drops the roles_rank_key constraint', async () => {
    // Verify the constraint is gone by inserting two roles with rank 2.
    await pool.query(
      `INSERT INTO roles (id, name, rank, "isSystem")
       VALUES ('test-role-a', 'test-a', 2, false)`,
    );
    await pool.query(
      `INSERT INTO roles (id, name, rank, "isSystem")
       VALUES ('test-role-b', 'test-b', 2, false)`,
    );

    // Both should exist.
    const result = await pool.query(
      `SELECT name FROM roles WHERE rank = 2 AND "isSystem" = false ORDER BY name`,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r: any) => r.name)).toEqual(['test-a', 'test-b']);

    // Clean up.
    await pool.query(`DELETE FROM roles WHERE id IN ('test-role-a', 'test-role-b')`);
  });

  it('listRolesWithPermissions merges defaults with overrides', async () => {
    const { listRolesWithPermissions } = await import('@/lib/persistence/admin-roles');
    const roles = await listRolesWithPermissions(pool);

    // Should have 4 system roles.
    expect(roles.length).toBeGreaterThanOrEqual(4);

    // Guest role should have quiz.grade as default.
    const guest = roles.find((r) => r.name === 'guest');
    expect(guest).toBeDefined();
    expect(guest!.defaults).toContain('quiz.grade');
    expect(guest!.overrides.size).toBe(0);
    expect(guest!.effective).toEqual(guest!.defaults);
  });

  it('createRole inserts a custom role with overrides', async () => {
    const { createRole } = await import('@/lib/persistence/admin-roles');
    const role = await createRole(pool, {
      name: 'moderator',
      rank: 2,
      permissions: [
        { permission: 'course.create', granted: true },
        { permission: 'quiz.grade', granted: false },
      ],
    });

    expect(role.name).toBe('moderator');
    expect(role.rank).toBe(2);
    expect(role.isSystem).toBe(false);

    // Verify the role exists in the database.
    const result = await pool.query(`SELECT * FROM roles WHERE name = 'moderator'`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].rank).toBe(2);

    // Verify overrides exist.
    const overrides = await pool.query(
      `SELECT * FROM role_permissions WHERE role_name = 'moderator'`,
    );
    expect(overrides.rows).toHaveLength(2);
  });

  it('createRole refuses system-reserved names', async () => {
    const { createRole } = await import('@/lib/persistence/admin-roles');
    await expect(createRole(pool, { name: 'admin', rank: 2, permissions: [] })).rejects.toThrow(
      'system-reserved',
    );
  });

  it('updateRole renames, re-ranks, and replaces overrides', async () => {
    const { createRole, updateRole, listRolesWithPermissions } =
      await import('@/lib/persistence/admin-roles');

    // Create a role to update.
    const role = await createRole(pool, {
      name: 'updater-test',
      rank: 2,
      permissions: [{ permission: 'tts.use', granted: true }],
    });

    // Update name, rank, and permissions.
    await updateRole(pool, role.id, {
      name: 'updater-renamed',
      rank: 3,
      permissions: [{ permission: 'asr.use', granted: true }],
    });

    // Verify the rename.
    const renamed = await pool.query(`SELECT name, rank FROM roles WHERE id = $1`, [role.id]);
    expect(renamed.rows[0].name).toBe('updater-renamed');
    expect(renamed.rows[0].rank).toBe(3);

    // Verify old override is gone and new override exists.
    const oldOverrides = await pool.query(
      `SELECT * FROM role_permissions WHERE role_name = 'updater-test'`,
    );
    expect(oldOverrides.rows).toHaveLength(0);

    const newOverrides = await pool.query(
      `SELECT * FROM role_permissions WHERE role_name = 'updater-renamed'`,
    );
    expect(newOverrides.rows).toHaveLength(1);
    expect(newOverrides.rows[0].permission).toBe('asr.use');

    // Clean up.
    await pool.query(`DELETE FROM role_permissions WHERE role_name = 'updater-renamed'`);
    await pool.query(`DELETE FROM roles WHERE id = $1`, [role.id]);
  });

  it('resetRoleOverrides clears role_permissions rows', async () => {
    const { createRole, resetRoleOverrides, listRolesWithPermissions } =
      await import('@/lib/persistence/admin-roles');

    // Create a role with overrides.
    const role = await createRole(pool, {
      name: 'reset-test',
      rank: 2,
      permissions: [{ permission: 'course.create', granted: true }],
    });

    // Verify overrides exist.
    const before = await listRolesWithPermissions(pool);
    const beforeRole = before.find((r) => r.name === 'reset-test');
    expect(beforeRole!.overrides.size).toBe(1);

    // Reset overrides.
    await resetRoleOverrides(pool, 'reset-test');

    // Verify overrides are gone.
    const after = await listRolesWithPermissions(pool);
    const afterRole = after.find((r) => r.name === 'reset-test');
    expect(afterRole!.overrides.size).toBe(0);
    expect(afterRole!.effective).toEqual(afterRole!.defaults);

    // Clean up.
    await pool.query(`DELETE FROM roles WHERE id = $1`, [role.id]);
  });

  it('deleteRole refuses system roles', async () => {
    const { deleteRole } = await import('@/lib/persistence/admin-roles');
    const guestResult = await pool.query(`SELECT id FROM roles WHERE name = 'guest'`);
    const guestId = guestResult.rows[0].id;
    await expect(deleteRole(pool, guestId)).rejects.toThrow('system');
  });

  it('deleteRole refuses roles with attached users', async () => {
    const { createRole } = await import('@/lib/persistence/admin-roles');
    const role = await createRole(pool, {
      name: 'attached-test',
      rank: 2,
      permissions: [],
    });

    // Create a user and assign the role.
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('test-user-attach', 'Test', 'attach@test.com', true, now(), now())`,
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ('test-user-attach', $1, 'admin', now())`,
      [role.id],
    );

    const { deleteRole } = await import('@/lib/persistence/admin-roles');
    await expect(deleteRole(pool, role.id)).rejects.toThrow('attached users');

    // Clean up.
    await pool.query(`DELETE FROM user_roles WHERE user_id = 'test-user-attach'`);
    await pool.query(`DELETE FROM "user" WHERE id = 'test-user-attach'`);
    await pool.query(`DELETE FROM roles WHERE id = $1`, [role.id]);
  });

  it('deleteRole refuses roles with pending invites', async () => {
    const { createRole } = await import('@/lib/persistence/admin-roles');
    const role = await createRole(pool, {
      name: 'invite-test',
      rank: 2,
      permissions: [],
    });

    // Create a pending invite referencing this role name.
    await pool.query(
      `INSERT INTO invites (email, role_name, code, expires_at, created_by)
       VALUES ('invite@test.com', 'invite-test', 'test-hash', now() + interval '7 days', 'admin')`,
    );

    const { deleteRole } = await import('@/lib/persistence/admin-roles');
    await expect(deleteRole(pool, role.id)).rejects.toThrow('pending invites');

    // Clean up.
    await pool.query(`DELETE FROM invites WHERE role_name = 'invite-test'`);
    await pool.query(`DELETE FROM roles WHERE id = $1`, [role.id]);
  });

  it('deleteRole removes override rows for deleted role', async () => {
    const { createRole, deleteRole } = await import('@/lib/persistence/admin-roles');

    // Create a role with overrides.
    const role = await createRole(pool, {
      name: 'delete-test',
      rank: 2,
      permissions: [{ permission: 'course.create', granted: true }],
    });

    // Verify overrides exist.
    const before = await pool.query(
      `SELECT * FROM role_permissions WHERE role_name = 'delete-test'`,
    );
    expect(before.rows).toHaveLength(1);

    // Delete the role.
    await deleteRole(pool, role.id);

    // Verify overrides are gone.
    const after = await pool.query(
      `SELECT * FROM role_permissions WHERE role_name = 'delete-test'`,
    );
    expect(after.rows).toHaveLength(0);

    // Verify the role is gone.
    const roleCheck = await pool.query(`SELECT * FROM roles WHERE id = $1`, [role.id]);
    expect(roleCheck.rows).toHaveLength(0);
  });

  it('createRole rejects duplicate names', async () => {
    const { createRole } = await import('@/lib/persistence/admin-roles');
    await createRole(pool, {
      name: 'unique-test',
      rank: 2,
      permissions: [],
    });

    // Second create with same name should fail.
    await expect(
      createRole(pool, { name: 'unique-test', rank: 3, permissions: [] }),
    ).rejects.toThrow();

    // Clean up.
    await pool.query(`DELETE FROM roles WHERE name = 'unique-test'`);
  });
});
