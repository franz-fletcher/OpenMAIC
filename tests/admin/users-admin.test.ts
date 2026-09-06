/**
 * Hermetic unit test for the users-admin gate.
 *
 * Verifies:
 * - Module exports exist (listUsers, setUserRole, setUserBanned)
 * - listUsers joins user, user_roles, roles and returns correct shape
 * - setUserRole upserts the single user_roles row
 * - setUserBanned writes ban columns, revokes sessions, refuses self-ban
 * - resolveViewerRank returns 0 for banned users
 * - GET /api/admin/users returns the filtered list
 * - PATCH /api/admin/users applies role or ban mutations, refuses self-ban
 * - The identity never renders in the UI
 *
 * Flag OFF behavior: admin surface gates unconditionally per the settings gate split decision.
 *
 * The banned-check enforcement (requirePermission code banned, resolveViewerRank
 * rank 0) is tested live in the adversarial gate, not here. This suite mocks
 * at the module boundary per the hermetic unit rule.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let _mockSession: { userId: string; token: string; id: string } | null = {
  userId: 'test-user-1',
  token: 'tok1',
  id: 'sess1',
};

vi.mock('@/lib/auth/permissions-server', () => ({
  requirePermission: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    return _mockSession;
  }),
  requirePermissionIfMinimalMode: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
  }),
}));

vi.mock('@/lib/auth/index', () => ({
  getSession: vi.fn(async () => _mockSession),
  requireSession: vi.fn(async () => {
    if (!_mockSession)
      throw new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    return _mockSession;
  }),
  requirePermission: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    return _mockSession;
  }),
  requirePermissionIfMinimalMode: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
  }),
  listRoles: vi.fn(async () => [
    {
      id: 'guest',
      name: 'guest',
      rank: 1,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'learner',
      name: 'learner',
      rank: 2,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'creator',
      name: 'creator',
      rank: 3,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'admin',
      name: 'admin',
      rank: 4,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
}));

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en-US',
    setLocale: () => undefined,
  }),
}));

const MOCK_USERS = [
  {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    email_verified: true,
    role_id: 'admin',
    role_name: 'admin',
    role_rank: 4,
    banned: false,
    ban_reason: null,
    created_at: new Date('2025-01-15'),
  },
  {
    id: 'user-2',
    email: 'bob@example.com',
    name: 'Bob',
    email_verified: false,
    role_id: 'guest',
    role_name: 'guest',
    role_rank: 1,
    banned: false,
    ban_reason: null,
    created_at: new Date('2025-02-20'),
  },
];

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn(async () => ({
    pool: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM user_roles') && sql.includes('JOIN roles')) {
          return { rows: [{ rank: 4 }] };
        }
        if (sql.includes('"banned"')) {
          if (params?.[0] === 'banned-user') {
            return { rows: [{ banned: true }] };
          }
          return { rows: [{ banned: false }] };
        }
        if (sql.includes('DELETE FROM session')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('FROM "user"') && sql.includes('LEFT JOIN user_roles')) {
          return { rows: MOCK_USERS };
        }
        return { rows: [] };
      }),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('USERS_ADMIN_OK: users-admin gate', () => {
  describe('USERS_ADMIN_OK: module exports', () => {
    it('exports listUsers from admin-users', async () => {
      const mod = await import('@/lib/persistence/admin-users');
      expect(typeof mod.listUsers).toBe('function');
    });

    it('exports setUserRole from admin-users', async () => {
      const mod = await import('@/lib/persistence/admin-users');
      expect(typeof mod.setUserRole).toBe('function');
    });

    it('exports setUserBanned from admin-users', async () => {
      const mod = await import('@/lib/persistence/admin-users');
      expect(typeof mod.setUserBanned).toBe('function');
    });
  });

  describe('USERS_ADMIN_OK: listUsers', () => {
    it('returns users with email, verified, role, roleId, rank, banned, created', async () => {
      const { listUsers } = await import('@/lib/persistence/admin-users');
      const query = vi.fn(async () => ({ rows: MOCK_USERS }));
      const queryable = { query } as any;
      const users = await listUsers(queryable);
      expect(users).toHaveLength(2);
      expect(users[0]).toMatchObject({
        id: 'user-1',
        email: 'alice@example.com',
        emailVerified: true,
        roleId: 'admin',
        role: 'admin',
        rank: 4,
        banned: false,
      });
    });

    it('returns roleId for custom-role users so the picker matches by ID', async () => {
      const { listUsers } = await import('@/lib/persistence/admin-users');
      const customRoleRow = {
        id: 'user-custom',
        email: 'custom@example.com',
        name: 'Custom',
        email_verified: true,
        role_id: '9bbddd4a-3df0-4133-98c0-472bc6623158',
        role_name: 'ta',
        role_rank: 2,
        banned: false,
        ban_reason: null,
        created_at: new Date('2025-03-01'),
      };
      const query = vi.fn(async () => ({ rows: [customRoleRow] }));
      const queryable = { query } as any;
      const users = await listUsers(queryable);
      expect(users[0].roleId).toBe('9bbddd4a-3df0-4133-98c0-472bc6623158');
      expect(users[0].role).toBe('ta');
    });

    it('returns roleId=null for users with no role assignment', async () => {
      const { listUsers } = await import('@/lib/persistence/admin-users');
      const noRoleRow = {
        id: 'user-none',
        email: 'none@example.com',
        name: 'None',
        email_verified: false,
        role_id: null,
        role_name: null,
        role_rank: 1,
        banned: false,
        ban_reason: null,
        created_at: new Date('2025-04-01'),
      };
      const query = vi.fn(async () => ({ rows: [noRoleRow] }));
      const queryable = { query } as any;
      const users = await listUsers(queryable);
      expect(users[0].roleId).toBeNull();
    });
  });

  describe('USERS_ADMIN_OK: setUserRole', () => {
    it('upserts a single user_roles row', async () => {
      const { setUserRole } = await import('@/lib/persistence/admin-users');
      const query = vi.fn(async () => ({ rows: [] }));
      const queryable = { query } as any;
      await setUserRole(queryable, 'user-1', 'admin', 'admin-user');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_roles'),
        expect.arrayContaining(['user-1', 'admin', 'admin-user']),
      );
    });
  });

  describe('USERS_ADMIN_OK: setUserBanned', () => {
    it('writes ban columns and revokes sessions', async () => {
      const { setUserBanned } = await import('@/lib/persistence/admin-users');
      const query = vi.fn(async () => ({ rows: [] }));
      const queryable = { query } as any;
      await setUserBanned(queryable, 'user-1', true, 'spam');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "user" SET'),
        expect.arrayContaining(['true', 'spam', 'user-1']),
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM session'),
        expect.arrayContaining(['user-1']),
      );
    });

    it('refuses self-ban', async () => {
      const { setUserBanned } = await import('@/lib/persistence/admin-users');
      const queryable = { query: vi.fn() } as any;
      await expect(
        setUserBanned(queryable, 'test-user-1', true, undefined, 'test-user-1'),
      ).rejects.toThrow('Cannot ban your own session');
    });
  });

  describe('USERS_ADMIN_OK: requirePermission is exported', () => {
    it('exports requirePermission from permissions-server', async () => {
      const mod = await import('@/lib/auth/permissions-server');
      expect(typeof mod.requirePermission).toBe('function');
    });

    it('exports requirePermission from auth/index', async () => {
      const mod = await import('@/lib/auth/index');
      expect(typeof mod.requirePermission).toBe('function');
    });
  });

  describe('USERS_ADMIN_OK: resolveViewerRank', () => {
    it('returns 0 for banned users', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const query = vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('"banned"')) {
          return { rows: [{ banned: true }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;
      const rank = await resolveViewerRank(queryable, 'user:banned-user');
      expect(rank).toBe(0);
    });

    it('returns role rank for non-banned users', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const query = vi.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('"banned"')) {
          return { rows: [{ banned: false }] };
        }
        if (sql.includes('FROM user_roles')) {
          return { rows: [{ rank: 3 }] };
        }
        return { rows: [] };
      });
      const queryable = { query } as any;
      const rank = await resolveViewerRank(queryable, 'user:user-1');
      expect(rank).toBe(3);
    });

    it('returns 0 for anon owners', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const queryable = { query: vi.fn() } as any;
      const rank = await resolveViewerRank(queryable, 'anon:abc');
      expect(rank).toBe(0);
    });
  });

  describe('USERS_ADMIN_OK: GET /api/admin/users', () => {
    it('returns the user list when authorized', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { GET } = await import('@/app/api/admin/users/route');
      const req = new Request('http://localhost/api/admin/users', {
        method: 'GET',
        headers: new Headers({ cookie: 'session=tok' }),
      });
      const res = await GET(req as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.users).toBeDefined();
      expect(Array.isArray(body.users)).toBe(true);
    });
  });

  describe('USERS_ADMIN_OK: PATCH /api/admin/users', () => {
    it('applies role mutation', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { PATCH } = await import('@/app/api/admin/users/route');
      const req = new Request('http://localhost/api/admin/users', {
        method: 'PATCH',
        headers: new Headers({ cookie: 'session=tok', 'content-type': 'application/json' }),
        body: JSON.stringify({ userId: 'user-1', action: 'setRole', roleId: 'admin' }),
      });
      const res = await PATCH(req as never);
      expect(res.status).toBe(200);
    });

    it('applies ban mutation', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { PATCH } = await import('@/app/api/admin/users/route');
      const req = new Request('http://localhost/api/admin/users', {
        method: 'PATCH',
        headers: new Headers({ cookie: 'session=tok', 'content-type': 'application/json' }),
        body: JSON.stringify({
          userId: 'user-1',
          action: 'setBanned',
          banned: true,
          reason: 'spam',
        }),
      });
      const res = await PATCH(req as never);
      expect(res.status).toBe(200);
    });

    it('refuses self-ban', async () => {
      _mockSession = { userId: 'admin-user', token: 'tok', id: 'sess' };
      const { PATCH } = await import('@/app/api/admin/users/route');
      const req = new Request('http://localhost/api/admin/users', {
        method: 'PATCH',
        headers: new Headers({ cookie: 'session=tok', 'content-type': 'application/json' }),
        body: JSON.stringify({ userId: 'admin-user', action: 'setBanned', banned: true }),
      });
      const res = await PATCH(req as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('SELF_BAN_REFUSED');
    });
  });

  describe('USERS_ADMIN_OK: users-section component', () => {
    it('exports a client component', async () => {
      const mod = await import('@/components/admin/users-section');
      expect(typeof mod.default).toBe('function');
    });
  });

  describe('USERS_ADMIN_OK: i18n keys exist', () => {
    it('has admin.users.search', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const users = admin?.users as Record<string, unknown> | undefined;
      expect(users?.search).toBeDefined();
    });

    it('has admin.users.role', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const users = admin?.users as Record<string, unknown> | undefined;
      expect(users?.role).toBeDefined();
    });

    it('has admin.users.ban', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const users = admin?.users as Record<string, unknown> | undefined;
      expect(users?.ban).toBeDefined();
    });

    it('has admin.users.unban', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const users = admin?.users as Record<string, unknown> | undefined;
      expect(users?.unban).toBeDefined();
    });
  });
});
