/**
 * Hermetic unit test for the includeDeleted strict parsing.
 *
 * Verifies that the admin courses GET handler accepts '1' and 'true'
 * (case-insensitive) for the includeDeleted query parameter, and that
 * '0', 'false', and missing stay false.
 *
 * Gate: INCLUDE_DELETED_OK
 */

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

vi.mock('@/lib/auth/permissions-server', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-admin-1',
    token: 'tok1',
    id: 'sess1',
  })),
  requirePermissionIfMinimalMode: vi.fn(async () => {}),
}));

vi.mock('@/lib/auth/index', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-admin-1',
    token: 'tok1',
    id: 'sess1',
  })),
}));

let lastIncludeDeleted: boolean | undefined;

vi.mock('@/lib/persistence/admin-courses', () => ({
  listAllCoursesForAdmin: vi.fn(async (_pool: unknown, options?: { includeDeleted?: boolean }) => {
    lastIncludeDeleted = options?.includeDeleted;
    return [
      {
        stageId: 'stage-1',
        name: 'Test Course',
        ownerId: 'user:raw-user-alice',
        ownerEmail: 'alice@example.com',
        status: 'published',
        audience: 0,
        publishedAt: 1700000000000,
        deletedAt: null,
      },
    ];
  }),
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn(async () => ({
    pool: {},
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('INCLUDE_DELETED_OK: includeDeleted strict parsing', () => {
  beforeEach(() => {
    lastIncludeDeleted = undefined;
  });

  function makeReq(searchParams: Record<string, string> = {}) {
    const params = new URLSearchParams(searchParams);
    const url = `http://localhost/api/admin/courses?${params.toString()}`;
    return new Request(url, {
      method: 'GET',
      headers: new Headers({ cookie: 'session=tok1' }),
    }) as never;
  }

  it('treats "true" as includeDeleted=true', async () => {
    const { GET } = await import('@/app/api/admin/courses/route');
    const res = await GET(makeReq({ includeDeleted: 'true' }));
    expect(res.status).toBe(200);
    expect(lastIncludeDeleted).toBe(true);
  });

  it('treats "1" as includeDeleted=true', async () => {
    const { GET } = await import('@/app/api/admin/courses/route');
    const res = await GET(makeReq({ includeDeleted: '1' }));
    expect(res.status).toBe(200);
    expect(lastIncludeDeleted).toBe(true);
  });

  it('treats "TRUE" (uppercase) as includeDeleted=true', async () => {
    const { GET } = await import('@/app/api/admin/courses/route');
    const res = await GET(makeReq({ includeDeleted: 'TRUE' }));
    expect(res.status).toBe(200);
    expect(lastIncludeDeleted).toBe(true);
  });

  it('treats "True" (mixed case) as includeDeleted=true', async () => {
    const { GET } = await import('@/app/api/admin/courses/route');
    const res = await GET(makeReq({ includeDeleted: 'True' }));
    expect(res.status).toBe(200);
    expect(lastIncludeDeleted).toBe(true);
  });

  it('treats "0" as includeDeleted=false', async () => {
    const { GET } = await import('@/app/api/admin/courses/route');
    const res = await GET(makeReq({ includeDeleted: '0' }));
    expect(res.status).toBe(200);
    expect(lastIncludeDeleted).toBe(false);
  });

  it('treats "false" as includeDeleted=false', async () => {
    const { GET } = await import('@/app/api/admin/courses/route');
    const res = await GET(makeReq({ includeDeleted: 'false' }));
    expect(res.status).toBe(200);
    expect(lastIncludeDeleted).toBe(false);
  });

  it('treats missing param as includeDeleted=false', async () => {
    const { GET } = await import('@/app/api/admin/courses/route');
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(lastIncludeDeleted).toBe(false);
  });

  it('treats garbage value as includeDeleted=false', async () => {
    const { GET } = await import('@/app/api/admin/courses/route');
    const res = await GET(makeReq({ includeDeleted: 'xyz' }));
    expect(res.status).toBe(200);
    expect(lastIncludeDeleted).toBe(false);
  });
});
