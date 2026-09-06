/**
 * Hermetic unit test for the roles-persistence gate.
 *
 * Verifies:
 * - Module exports exist (listRolesWithPermissions, createRole, updateRole,
 *   resetRoleOverrides, deleteRole)
 * - listRolesWithPermissions merges rank defaults with role_permissions overrides
 * - createRole refuses system-reserved names
 * - createRole inserts custom role with overrides
 * - updateRole renames through role_permissions.role_name in one transaction
 * - updateRole replaces override set
 * - resetRoleOverrides clears role_permissions rows for a role
 * - deleteRole refuses system roles
 * - deleteRole refuses roles with attached users
 * - deleteRole refuses roles with pending invites
 * - deleteRole removes override rows for deleted role
 * - ensureAuthSchema drops the roles_rank_key uniqueness constraint
 *
 * Env-clear prefix is the 016 canonical list.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'DATABASE_URL',
  'PERSISTENCE_DEV_TOKEN',
  'ACCESS_CODE',
  'OPENMAIC_AGENT_RUNTIME_ENABLED',
  'NEXT_PUBLIC_PRO_WORKBENCH_ENABLED',
  'NEXT_PUBLIC_MAIC_EDITOR_ENABLED',
  'MINIMAL_MODE',
  'NEXT_PUBLIC_MINIMAL_MODE',
] as const;

// Clear env before any import
for (const key of ENV_KEYS) {
  delete process.env[key];
}

// ---------------------------------------------------------------------------
// Mock fixtures
// ---------------------------------------------------------------------------

const SYSTEM_ROLES = [
  {
    id: 'guest',
    name: 'guest',
    rank: 1,
    is_system: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'learner',
    name: 'learner',
    rank: 2,
    is_system: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'creator',
    name: 'creator',
    rank: 3,
    is_system: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
  {
    id: 'admin',
    name: 'admin',
    rank: 4,
    is_system: true,
    created_at: new Date(),
    updated_at: new Date(),
  },
];

const CUSTOM_ROLE = {
  id: 'custom-1',
  name: 'moderator',
  rank: 2,
  is_system: false,
  created_at: new Date(),
  updated_at: new Date(),
};

const OVERRIDE_ROWS = [
  { role_name: 'moderator', permission: 'course.create', granted: true },
  { role_name: 'moderator', permission: 'quiz.grade', granted: false },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ROLES_CORE_OK: roles-persistence gate', () => {
  describe('ROLES_CORE_OK: module exports', () => {
    it('exports listRolesWithPermissions from admin-roles', async () => {
      const mod = await import('@/lib/persistence/admin-roles');
      expect(typeof mod.listRolesWithPermissions).toBe('function');
    });

    it('exports createRole from admin-roles', async () => {
      const mod = await import('@/lib/persistence/admin-roles');
      expect(typeof mod.createRole).toBe('function');
    });

    it('exports updateRole from admin-roles', async () => {
      const mod = await import('@/lib/persistence/admin-roles');
      expect(typeof mod.updateRole).toBe('function');
    });

    it('exports resetRoleOverrides from admin-roles', async () => {
      const mod = await import('@/lib/persistence/admin-roles');
      expect(typeof mod.resetRoleOverrides).toBe('function');
    });

    it('exports deleteRole from admin-roles', async () => {
      const mod = await import('@/lib/persistence/admin-roles');
      expect(typeof mod.deleteRole).toBe('function');
    });
  });

  describe('ROLES_CORE_OK: listRolesWithPermissions', () => {
    it('merges rank defaults with role_permissions overrides', async () => {
      const { listRolesWithPermissions } = await import('@/lib/persistence/admin-roles');

      const query = vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('FROM roles') && !sql.includes('role_permissions')) {
          // Return system roles + one custom role
          return { rows: [...SYSTEM_ROLES, CUSTOM_ROLE] };
        }
        if (sql.includes('FROM role_permissions')) {
          return { rows: OVERRIDE_ROWS };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      const roles = await listRolesWithPermissions(queryable);

      expect(roles).toHaveLength(5);

      // Custom role has overrides merged with defaults
      const custom = roles.find((r: any) => r.name === 'moderator') as any;
      expect(custom).toBeDefined();
      expect(custom.rank).toBe(2);
      expect(custom.isSystem).toBe(false);
      expect(custom.defaults).toContain('quiz.grade');
      expect(custom.defaults).toContain('classroom.chat');
      expect(custom.overrides.get('course.create')).toBe(true);
      expect(custom.overrides.get('quiz.grade')).toBe(false);
      // Effective should have course.create added and quiz.grade removed
      expect(custom.effective).toContain('course.create');
      expect(custom.effective).not.toContain('quiz.grade');
    });

    it('returns empty overrides for roles without role_permissions rows', async () => {
      const { listRolesWithPermissions } = await import('@/lib/persistence/admin-roles');

      const query = vi.fn(async (sql: string) => {
        if (sql.includes('FROM roles') && !sql.includes('role_permissions')) {
          return { rows: SYSTEM_ROLES };
        }
        if (sql.includes('FROM role_permissions')) {
          return { rows: [] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      const roles = await listRolesWithPermissions(queryable);

      expect(roles).toHaveLength(4);
      const guest = roles.find((r: any) => r.name === 'guest') as any;
      expect(guest.overrides.size).toBe(0);
      expect(guest.effective).toEqual(guest.defaults);
    });
  });

  describe('ROLES_CORE_OK: createRole', () => {
    it('refuses system-reserved names', async () => {
      const { createRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async () => ({ rows: [] }));
      const queryable = { query } as any;

      await expect(
        createRole(queryable, { name: 'admin', rank: 2, permissions: [] }),
      ).rejects.toThrow('system-reserved');
    });

    it('inserts a custom role with initial overrides', async () => {
      const { createRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO roles')) {
          return {
            rows: [{ id: 'new-role-1', name: params?.[0], rank: params?.[1], is_system: false }],
          };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      const role = await createRole(queryable, {
        name: 'moderator',
        rank: 2,
        permissions: [{ permission: 'course.create', granted: true }],
      });

      expect(role.name).toBe('moderator');
      expect(role.rank).toBe(2);
      expect(role.isSystem).toBe(false);
      // Should have called INSERT INTO roles and INSERT INTO role_permissions
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO roles'),
        expect.arrayContaining(['moderator', 2]),
      );
    });
  });

  describe('ROLES_CORE_OK: updateRole', () => {
    it('renames through role_permissions.role_name in one transaction', async () => {
      const { updateRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('is_system')) {
          return { rows: [{ name: 'moderator', is_system: false }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      await updateRole(queryable, 'custom-1', { name: 'super-moderator' });

      // Should update both roles.name and role_permissions.role_name
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE roles'),
        expect.arrayContaining(['super-moderator', 'custom-1']),
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE role_permissions'),
        expect.arrayContaining(['super-moderator', 'moderator']),
      );
    });

    it('replaces the override set', async () => {
      const { updateRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('is_system')) {
          return { rows: [{ name: 'moderator', is_system: false }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      await updateRole(queryable, 'custom-1', {
        permissions: [{ permission: 'tts.use', granted: true }],
      });

      // Should delete old overrides and insert new ones
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM role_permissions'),
        expect.arrayContaining(['moderator']),
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO role_permissions'),
        expect.arrayContaining(['tts.use', true]),
      );
    });

    it('changes rank', async () => {
      const { updateRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('is_system')) {
          return { rows: [{ name: 'moderator', is_system: false }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      await updateRole(queryable, 'custom-1', { rank: 3 });

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE roles'),
        expect.arrayContaining([3, 'custom-1']),
      );
    });
  });

  describe('ROLES_CORE_OK: resetRoleOverrides', () => {
    it('clears role_permissions rows for a role', async () => {
      const { resetRoleOverrides } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async () => ({ rows: [] }));
      const queryable = { query } as any;

      await resetRoleOverrides(queryable, 'moderator');

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM role_permissions'),
        expect.arrayContaining(['moderator']),
      );
    });
  });

  describe('ROLES_CORE_OK: deleteRole', () => {
    it('refuses system roles', async () => {
      const { deleteRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('is_system')) {
          return { rows: [{ name: 'guest', is_system: true }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      await expect(deleteRole(queryable, 'guest')).rejects.toThrow('system');
    });

    it('refuses roles with attached users', async () => {
      const { deleteRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('is_system')) {
          return { rows: [{ name: 'moderator', is_system: false }] };
        }
        if (sql.includes('SELECT') && sql.includes('user_roles')) {
          return { rows: [{ count: '1' }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      await expect(deleteRole(queryable, 'custom-1')).rejects.toThrow('attached users');
    });

    it('refuses roles with pending invites', async () => {
      const { deleteRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('is_system')) {
          return { rows: [{ name: 'moderator', is_system: false }] };
        }
        if (sql.includes('SELECT') && sql.includes('user_roles')) {
          return { rows: [{ count: '0' }] };
        }
        if (sql.includes('SELECT') && sql.includes('invites')) {
          return { rows: [{ count: '1' }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      await expect(deleteRole(queryable, 'custom-1')).rejects.toThrow('pending invites');
    });

    it('removes override rows for deleted role', async () => {
      const { deleteRole } = await import('@/lib/persistence/admin-roles');
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('is_system')) {
          return { rows: [{ name: 'moderator', is_system: false }] };
        }
        if (sql.includes('SELECT') && sql.includes('user_roles')) {
          return { rows: [{ count: '0' }] };
        }
        if (sql.includes('SELECT') && sql.includes('invites')) {
          return { rows: [{ count: '0' }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;

      await deleteRole(queryable, 'custom-1');

      // Should have deleted overrides and the role
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM role_permissions'),
        expect.arrayContaining(['moderator']),
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM roles'),
        expect.arrayContaining(['custom-1']),
      );
    });
  });

  describe('ROLES_CORE_OK: ensureAuthSchema drops rank constraint', () => {
    it('exports ensureAuthSchema from schema', async () => {
      const mod = await import('@/lib/auth/schema');
      expect(typeof mod.ensureAuthSchema).toBe('function');
    });

    it('drops the roles_rank_key constraint', async () => {
      const { ensureAuthSchema } = await import('@/lib/auth/schema');
      const query = vi.fn(async () => ({ rows: [] }));
      const queryable = { query } as any;

      await ensureAuthSchema(queryable);

      // Should contain the ALTER TABLE ... DROP CONSTRAINT IF EXISTS roles_rank_key
      const calls = query.mock.calls.map((c: any[]) => c[0]);
      const hasDrop = calls.some(
        (sql: string) => sql.includes('DROP CONSTRAINT') && sql.includes('roles_rank_key'),
      );
      expect(hasDrop).toBe(true);
    });
  });
});
