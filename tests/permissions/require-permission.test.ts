import { describe, expect, it, vi } from 'vitest';

// Hermetic unit test — mocked session and DB, no real PostgreSQL.

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

// ---------------------------------------------------------------------------
// requirePermission — no session (403)
// ---------------------------------------------------------------------------

describe('requirePermission — no session', () => {
  it('throws a 403 Response when session is null', async () => {
    mocks.mockGetSession.mockResolvedValue(null);
    const headers = makeHeaders();

    try {
      await requirePermission(headers, 'quiz.grade');
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const response = err as Response;
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({
        message: 'permission denied',
        code: 'permission_denied',
      });
    }
  });

  it('rejects any permission without a session', async () => {
    mocks.mockGetSession.mockResolvedValue(null);
    const headers = makeHeaders();

    try {
      await requirePermission(headers, 'course.create');
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// requirePermission — session but no role (rank 0)
// ---------------------------------------------------------------------------

describe('requirePermission — no role in DB', () => {
  it('throws 403 when user has no role row', async () => {
    mocks.mockGetSession.mockResolvedValue(fakeSession());
    mocks.mockQuery.mockResolvedValue({ rows: [] });
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
// requirePermission — guest allows quiz.grade
// ---------------------------------------------------------------------------

describe('requirePermission — guest allows quiz.grade', () => {
  it('returns the session when guest holds quiz.grade', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    mocks.mockQuery.mockResolvedValue({
      rows: [{ rank: 1 }],
    });
    const headers = makeHeaders('tok-1');

    const result = await requirePermission(headers, 'quiz.grade');
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// requirePermission — guest denies course.create
// ---------------------------------------------------------------------------

describe('requirePermission — guest denies course.create', () => {
  it('throws 403 when guest lacks course.create', async () => {
    mocks.mockGetSession.mockResolvedValue(fakeSession());
    mocks.mockQuery.mockResolvedValue({
      rows: [{ rank: 1 }],
    });
    const headers = makeHeaders('tok-1');

    try {
      await requirePermission(headers, 'course.create');
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
// requirePermission — admin allows all
// ---------------------------------------------------------------------------

describe('requirePermission — admin allows all', () => {
  it('returns session for admin checking any permission', async () => {
    const session = fakeSession();
    mocks.mockGetSession.mockResolvedValue(session);
    mocks.mockQuery.mockResolvedValue({
      rows: [{ rank: 4 }],
    });
    const headers = makeHeaders('tok-1');

    const result = await requirePermission(headers, 'roles.manage');
    expect(result).toBe(session);
  });
});

// ---------------------------------------------------------------------------
// requirePermission — DB query shape
// ---------------------------------------------------------------------------

describe('requirePermission — DB query shape', () => {
  it('queries user_roles and roles for the userId', async () => {
    const session = fakeSession({ userId: 'user-42' });
    mocks.mockGetSession.mockResolvedValue(session);
    mocks.mockQuery.mockResolvedValue({
      rows: [{ rank: 2 }],
    });
    const headers = makeHeaders('tok-1');

    await requirePermission(headers, 'quiz.grade');

    expect(mocks.mockQuery).toHaveBeenCalledWith(expect.stringContaining('user_roles'), [
      'user-42',
    ]);
  });
});
