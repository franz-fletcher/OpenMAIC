/**
 * Hermetic unit test for the enforcement wiring.
 *
 * Proves that database overrides in role_permissions reach requirePermission
 * through a fresh resolvePermissionSet call, and that no cross-request cache
 * exists. Mocks getSession and getServerPersistenceProvider; no real DB.
 *
 * Gate: GUARD_WIRE_OK
 */
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/lib/auth/index', () => ({
  getSession: (...args: unknown[]) => mocks.mockGetSession(...args),
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: { query: mocks.mockQuery },
  }),
}));

import { requirePermission } from '@/lib/auth/permissions-server';

function fakeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    token: 'tok-1',
    expiresAt: new Date('2026-12-31'),
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ipAddress: null,
    userAgent: null,
    ...overrides,
  };
}

function makeHeaders(sessionToken?: string): Headers {
  const h = new Headers();
  if (sessionToken) h.set('cookie', `session=${sessionToken}`);
  return h;
}

/** Fake a full role row query result. */
function fakeRoleRow(overrides: { name?: string; rank?: number } = {}) {
  return {
    id: `role-${overrides.rank ?? 1}`,
    name: overrides.name ?? 'guest',
    rank: overrides.rank ?? 1,
    is_system: true,
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-01-01'),
  };
}

/**
 * Set up the mock query to handle ban check, role row, and role_permissions
 * queries. Returns the mockQuery for further chaining if needed.
 */
function setupQueryMock(
  roleRow: ReturnType<typeof fakeRoleRow>,
  overrides: Array<{ permission: string; granted: boolean }> = [],
) {
  mocks.mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('"banned"')) return { rows: [] };
    if (sql.includes('user_roles') && sql.includes('roles')) {
      return { rows: [roleRow] };
    }
    if (sql.includes('role_permissions')) return { rows: overrides };
    return { rows: [] };
  });
}

// ---------------------------------------------------------------------------
// requirePermission — override grant flips deny to pass
// ---------------------------------------------------------------------------

describe('override grant flips deny to pass', () => {
  it('learner gains course.create through a role_permissions override', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    // Learner (rank 2) does not have course.create by default.
    setupQueryMock(fakeRoleRow({ name: 'learner', rank: 2 }), [
      { permission: 'course.create', granted: true },
    ]);
    const headers = makeHeaders('tok-1');

    const result = await requirePermission(headers, 'course.create');
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// requirePermission — override deny flips pass to deny
// ---------------------------------------------------------------------------

describe('override deny flips pass to deny', () => {
  it('admin loses users.manage through a role_permissions deny override', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    // Admin (rank 4) has users.manage by default; the override removes it.
    setupQueryMock(fakeRoleRow({ name: 'admin', rank: 4 }), [
      { permission: 'users.manage', granted: false },
    ]);
    const headers = makeHeaders('tok-1');

    try {
      await requirePermission(headers, 'users.manage');
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
      const body = await (err as Response).json();
      expect(body.code).toBe('permission_denied');
    }
  });
});

// ---------------------------------------------------------------------------
// requirePermission — no cache: fresh merge per call
// ---------------------------------------------------------------------------

describe('no cache: fresh merge per call', () => {
  it('first call denies, override added, second call passes', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    const headers = makeHeaders('tok-1');

    // First call: no overrides. Learner lacks course.create.
    let overrideRows: Array<{ permission: string; granted: boolean }> = [];
    mocks.mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('"banned"')) return { rows: [] };
      if (sql.includes('user_roles') && sql.includes('roles')) {
        return { rows: [fakeRoleRow({ name: 'learner', rank: 2 })] };
      }
      if (sql.includes('role_permissions')) return { rows: overrideRows };
      return { rows: [] };
    });

    try {
      await requirePermission(headers, 'course.create');
      expect.fail('Expected throw on first call');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }

    // Add the override. The mock now returns it.
    overrideRows = [{ permission: 'course.create', granted: true }];

    // Second call: override grants course.create.
    const result = await requirePermission(headers, 'course.create');
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// requirePermission — no session still 403
// ---------------------------------------------------------------------------

describe('no session still 403', () => {
  it('throws 403 when session is null', async () => {
    mocks.mockGetSession.mockResolvedValue(null);
    const headers = makeHeaders();

    try {
      await requirePermission(headers, 'quiz.grade');
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
      const body = await (err as Response).json();
      expect(body).toEqual({ message: 'permission denied', code: 'permission_denied' });
    }
  });
});

// ---------------------------------------------------------------------------
// requirePermission — no role row still 403
// ---------------------------------------------------------------------------

describe('no role row still 403', () => {
  it('throws 403 when user has no role', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    mocks.mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('"banned"')) return { rows: [] };
      return { rows: [] };
    });
    const headers = makeHeaders('tok-1');

    try {
      await requirePermission(headers, 'quiz.grade');
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// requirePermission — rank defaults still work without overrides
// ---------------------------------------------------------------------------

describe('rank defaults work without overrides', () => {
  it('guest allows quiz.grade via rank defaults', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    setupQueryMock(fakeRoleRow({ name: 'guest', rank: 1 }));
    const headers = makeHeaders('tok-1');

    const result = await requirePermission(headers, 'quiz.grade');
    expect(result).toBe(session);
  });

  it('guest denies course.create via rank defaults', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    setupQueryMock(fakeRoleRow({ name: 'guest', rank: 1 }));
    const headers = makeHeaders('tok-1');

    try {
      await requirePermission(headers, 'course.create');
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
  });

  it('admin allows all via rank defaults', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    setupQueryMock(fakeRoleRow({ name: 'admin', rank: 4 }));
    const headers = makeHeaders('tok-1');

    const result = await requirePermission(headers, 'roles.manage');
    expect(result).toBe(session);
  });
});
