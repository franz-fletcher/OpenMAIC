import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Integration tests for GET /api/auth/permissions.
 *
 * The route returns the resolved permission list for the session.
 * Defaults-deny: anonymous clients get an empty list.
 * The ACCESS_CODE curtain still applies (middleware level, not route level).
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn();
const mockResolvePermissionSet = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('@/lib/auth/index', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock('@/lib/auth/permissions-server', () => ({
  resolvePermissionSet: (...args: unknown[]) => mockResolvePermissionSet(...args),
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn().mockResolvedValue({
    pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/auth/permissions', () => {
  it('returns empty permissions for anonymous (no session)', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/auth/permissions/route');
    const req = new NextRequest('http://localhost:3000/api/auth/permissions');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.permissions).toEqual([]);
  });

  it('returns resolved permissions for an authenticated session', async () => {
    const session = {
      id: 'sess-1',
      userId: 'user-1',
      token: 'tok',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };
    mockGetSession.mockResolvedValueOnce(session);
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ rank: 2, name: 'learner' }],
    });
    mockResolvePermissionSet.mockResolvedValueOnce(new Set(['quiz.grade', 'classroom.chat']));

    const { GET } = await import('@/app/api/auth/permissions/route');
    const req = new NextRequest('http://localhost:3000/api/auth/permissions');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.permissions).toContain('quiz.grade');
    expect(body.permissions).toContain('classroom.chat');
  });

  it('returns all eleven permissions for an admin session', async () => {
    const session = {
      id: 'sess-2',
      userId: 'user-2',
      token: 'tok',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };
    mockGetSession.mockResolvedValueOnce(session);
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ rank: 4, name: 'admin' }],
    });
    mockResolvePermissionSet.mockResolvedValueOnce(
      new Set([
        'course.create',
        'course.edit',
        'course.delete',
        'course.publish',
        'classroom.chat',
        'quiz.grade',
        'tts.use',
        'asr.use',
        'settings.manage',
        'users.manage',
        'roles.manage',
      ]),
    );

    const { GET } = await import('@/app/api/auth/permissions/route');
    const req = new NextRequest('http://localhost:3000/api/auth/permissions');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.permissions).toHaveLength(11);
  });

  it('returns empty permissions when user has no role', async () => {
    const session = {
      id: 'sess-3',
      userId: 'user-3',
      token: 'tok',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };
    mockGetSession.mockResolvedValueOnce(session);
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const { GET } = await import('@/app/api/auth/permissions/route');
    const req = new NextRequest('http://localhost:3000/api/auth/permissions');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.permissions).toEqual([]);
  });

  it('returns a JSON response with content-type application/json', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const { GET } = await import('@/app/api/auth/permissions/route');
    const req = new NextRequest('http://localhost:3000/api/auth/permissions');
    const res = await GET(req);

    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
