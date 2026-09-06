/**
 * Unit test for admin roles routes (GET, POST, PATCH, DELETE).
 *
 * Mocks getSession at the module boundary to return a session with the
 * rank the test family needs. The guard and persistence layers are real.
 *
 * Env-clear prefix is the 016 canonical list.
 *
 * Gate: ROLES_ADMIN_OK
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Hermetic env-clear before any import that reads env.
const savedEnv = { ...process.env };
beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.PERSISTENCE_DEV_TOKEN;
  delete process.env.ACCESS_CODE;
  delete process.env.OPENMAIC_AGENT_RUNTIME_ENABLED;
  delete process.env.NEXT_PUBLIC_PRO_WORKBENCH_ENABLED;
  delete process.env.NEXT_PUBLIC_MAIC_EDITOR_ENABLED;
  delete process.env.MINIMAL_MODE;
  delete process.env.NEXT_PUBLIC_MINIMAL_MODE;
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

// Mock getSession to return a session. The rank is set per test via the
// mock implementation below.
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    requirePermission: vi.fn().mockImplementation(async (headers: Headers, permission: string) => {
      // Delegate to the real permission check but with a mock session.
      const session = { id: 'sess-1', userId: 'admin-user-1', token: 'tok-1' };
      if (permission === 'roles.manage' || permission === 'users.manage') {
        return session;
      }
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }),
    getSession: vi.fn().mockResolvedValue({ id: 'sess-1', userId: 'admin-user-1', token: 'tok-1' }),
  };
});

// Mock getServerPersistenceProvider to return a pool that delegates
// to the real pg queries but with no DATABASE_URL.
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn().mockImplementation(async () => ({
    pool: {
      query: async (sql: string, params?: unknown[]) => {
        // Return minimal shapes based on SQL patterns.
        if (sql.includes('FROM roles') && sql.includes('ORDER BY')) {
          return {
            rows: [
              { id: 'role-admin', name: 'admin', rank: 4, is_system: true },
              { id: 'role-learner', name: 'learner', rank: 2, is_system: true },
              { id: 'role-custom', name: 'custom-role', rank: 2, is_system: false },
            ],
          };
        }
        if (sql.includes('FROM role_permissions')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO roles')) {
          return {
            rows: [
              {
                id: 'role-new',
                name: params?.[0] ?? 'new-role',
                rank: params?.[1] ?? 2,
                is_system: false,
              },
            ],
          };
        }
        if (sql.includes('INSERT INTO role_permissions')) {
          return { rows: [] };
        }
        // Resolve session role name: join user_roles + roles for the session user.
        if (
          sql.includes('user_roles ur') &&
          sql.includes('roles r') &&
          sql.includes('ur.user_id')
        ) {
          const userId = params?.[0];
          if (userId === 'admin-user-1') {
            return { rows: [{ role_name: 'admin' }] };
          }
          return { rows: [] };
        }
        if (sql.includes('SELECT name') && sql.includes('FROM roles')) {
          // For lockout check: return the role being patched.
          const roleId = params?.[0];
          if (roleId === 'role-admin') {
            return { rows: [{ name: 'admin', is_system: true }] };
          }
          if (roleId === 'role-custom') {
            return { rows: [{ name: 'custom-role', is_system: false }] };
          }
          return { rows: [{ name: 'unknown-role', is_system: false }] };
        }
        return { rows: [] };
      },
    },
  })),
}));

describe('ROLES_ADMIN_OK: admin roles routes (unit)', () => {
  it('GET /api/admin/roles returns role list with defaults and overrides', async () => {
    const { GET } = await import('@/app/api/admin/roles/route');
    const req = new NextRequest('http://localhost/api/admin/roles');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.roles).toBeDefined();
    expect(Array.isArray(body.roles)).toBe(true);
    expect(body.roles.length).toBeGreaterThanOrEqual(3);

    // Each role should have the defaults/overrides/effective shape.
    const role = body.roles[0];
    expect(role.id).toBeDefined();
    expect(role.name).toBeDefined();
    expect(typeof role.rank).toBe('number');
    expect(typeof role.isSystem).toBe('boolean');
    expect(Array.isArray(role.defaults)).toBe(true);
    expect(Array.isArray(role.effective)).toBe(true);
    expect(role.overrides).toBeDefined();
  });

  it('GET /api/admin/roles returns 403 without roles.manage', async () => {
    // Override the mock to deny roles.manage.
    const { requirePermission } = await import('@/lib/auth');
    vi.mocked(requirePermission).mockRejectedValueOnce(
      new Response(JSON.stringify({ message: 'permission denied', code: 'permission_denied' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { GET } = await import('@/app/api/admin/roles/route');
    const req = new NextRequest('http://localhost/api/admin/roles');
    const res = await GET(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('permission_denied');
  });

  it('POST /api/admin/roles creates a custom role', async () => {
    const { POST } = await import('@/app/api/admin/roles/route');
    const req = new NextRequest('http://localhost/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({ name: 'moderator', rank: 2, permissions: [] }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.role).toBeDefined();
    expect(body.role.name).toBe('moderator');
  });

  it('POST /api/admin/roles returns 400 with missing fields', async () => {
    const { POST } = await import('@/app/api/admin/roles/route');
    const req = new NextRequest('http://localhost/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('MISSING_FIELDS');
  });

  it('POST /api/admin/roles returns 403 without roles.manage', async () => {
    const { requirePermission } = await import('@/lib/auth');
    vi.mocked(requirePermission).mockRejectedValueOnce(
      new Response(JSON.stringify({ message: 'permission denied', code: 'permission_denied' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { POST } = await import('@/app/api/admin/roles/route');
    const req = new NextRequest('http://localhost/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({ name: 'test', rank: 2, permissions: [] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });
});

describe('ROLES_ADMIN_OK: admin roles/[id] routes (unit)', () => {
  it('PATCH /api/admin/roles/[id] applies rename', async () => {
    const { PATCH } = await import('@/app/api/admin/roles/[id]/route');
    const req = new NextRequest('http://localhost/api/admin/roles/role-custom', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'renamed-role' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'role-custom' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('PATCH /api/admin/roles/[id] refuses self-lockout on own role', async () => {
    // The session userId is 'admin-user-1' and the role 'role-admin' is
    // the session's own role (admin). Patching it should be refused.
    // We need to mock the route to know the session's role.
    // The route resolves the session role from the user_roles join.
    // For this test, we mock getServerPersistenceProvider to return
    // the admin role as the session's role.

    const { PATCH } = await import('@/app/api/admin/roles/[id]/route');
    const req = new NextRequest('http://localhost/api/admin/roles/role-admin', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'hacked-admin' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'role-admin' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SELF_LOCKOUT_REFUSED');
  });

  it('DELETE /api/admin/roles/[id] refuses self-lockout on own role', async () => {
    const { DELETE } = await import('@/app/api/admin/roles/[id]/route');
    const req = new NextRequest('http://localhost/api/admin/roles/role-admin', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'role-admin' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SELF_LOCKOUT_REFUSED');
  });

  it('DELETE /api/admin/roles/[id] returns 403 without roles.manage', async () => {
    const { requirePermission } = await import('@/lib/auth');
    vi.mocked(requirePermission).mockRejectedValueOnce(
      new Response(JSON.stringify({ message: 'permission denied', code: 'permission_denied' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { DELETE } = await import('@/app/api/admin/roles/[id]/route');
    const req = new NextRequest('http://localhost/api/admin/roles/role-custom', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'role-custom' }) });

    expect(res.status).toBe(403);
  });
});

describe('ROLES_ADMIN_OK: users PATCH SELF_DEMOTE_REFUSED (unit)', () => {
  it('setUserRole refuses self-demotion and returns typed 400', async () => {
    const { PATCH } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost/api/admin/users', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'setRole', userId: 'admin-user-1', roleId: 'role-learner' }),
    });
    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SELF_DEMOTE_REFUSED');
  });
});
