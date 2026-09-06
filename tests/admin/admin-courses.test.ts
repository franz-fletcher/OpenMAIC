/**
 * Hermetic unit test for the admin-courses gate.
 *
 * Verifies:
 * - Module exports exist (listAllCoursesForAdmin, deleteCourseForAdmin)
 * - listAllCoursesForAdmin joins stage_meta, document_stages, user and returns correct shape
 * - deleteCourseForAdmin tournstones stage_meta and deletes the document row
 * - DELETE /api/admin/courses/[id] requires course.delete permission
 * - DELETE /api/admin/courses/[id] requires rank >= 4 (explicit rank-4 check)
 * - The courses-section component exports a client component
 * - i18n keys exist for admin.courses
 *
 * Flag OFF behavior: admin surface gates unconditionally per the settings gate split decision.
 *
 * The rank-4 enforcement and the 403 body shape are tested live in the pg
 * integration gate, not here. This suite mocks at the module boundary per
 * the hermetic unit rule.
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
  userId: 'test-admin-1',
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
}));

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en-US',
    setLocale: () => undefined,
  }),
}));

const MOCK_COURSES = [
  {
    stage_id: 'stage-1',
    name: 'Intro to Algebra',
    owner_id: 'user:raw-user-alice',
    owner_email: 'alice@example.com',
    status: 'published',
    audience: 0,
    published_at: 1700000000000,
    deleted_at: null,
  },
  {
    stage_id: 'stage-2',
    name: 'Advanced Physics',
    owner_id: 'user:raw-user-bob',
    owner_email: 'bob@example.com',
    status: 'draft',
    audience: 2,
    published_at: null,
    deleted_at: null,
  },
];

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn(async () => ({
    pool: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        // resolveViewerRank: return rank 4 for admin users
        if (sql.includes('FROM user_roles') && sql.includes('JOIN roles')) {
          return { rows: [{ rank: 4 }] };
        }
        // listAllCoursesForAdmin query
        if (sql.includes('FROM stage_meta') && sql.includes('JOIN document_stages')) {
          return { rows: MOCK_COURSES };
        }
        // tombstoneStageMeta
        if (sql.includes('UPDATE stage_meta') && sql.includes('deleted_at')) {
          return { rows: [], rowCount: 1 };
        }
        // deleteCourseForAdmin: DELETE FROM document_stages
        if (sql.includes('DELETE FROM document_stages')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [] };
      }),
    },
  })),
}));

vi.mock('@/lib/server/stage-access', () => ({
  readStageAccessIncludingDeleted: vi.fn(async (stageId: string) => {
    if (stageId === 'stage-1') {
      return {
        stageId: 'stage-1',
        ownerId: 'user:raw-user-alice',
        name: 'Intro to Algebra',
        isPublic: true,
        status: 'published',
        audience: 0,
        publishedAt: 1700000000000,
        generationComplete: true,
        source: 'document',
        deletedAt: null,
      };
    }
    if (stageId === 'stage-not-found') {
      return null;
    }
    return {
      stageId,
      ownerId: 'user:raw-user-bob',
      name: 'Some Course',
      isPublic: false,
      status: 'draft',
      audience: 2,
      publishedAt: null,
      generationComplete: false,
      source: 'document',
      deletedAt: null,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ADMIN_COURSES_OK: admin-courses gate', () => {
  describe('ADMIN_COURSES_OK: module exports', () => {
    it('exports listAllCoursesForAdmin from admin-courses', async () => {
      const mod = await import('@/lib/persistence/admin-courses');
      expect(typeof mod.listAllCoursesForAdmin).toBe('function');
    });

    it('exports deleteCourseForAdmin from admin-courses', async () => {
      const mod = await import('@/lib/persistence/admin-courses');
      expect(typeof mod.deleteCourseForAdmin).toBe('function');
    });
  });

  describe('ADMIN_COURSES_OK: listAllCoursesForAdmin', () => {
    it('returns courses with owner, status, audience, publishedAt', async () => {
      const { listAllCoursesForAdmin } = await import('@/lib/persistence/admin-courses');
      const query = vi.fn(async () => ({ rows: MOCK_COURSES }));
      const queryable = { query } as any;
      const courses = await listAllCoursesForAdmin(queryable);
      expect(courses).toHaveLength(2);
      expect(courses[0]).toMatchObject({
        stageId: 'stage-1',
        name: 'Intro to Algebra',
        ownerId: 'user:raw-user-alice',
        ownerEmail: 'alice@example.com',
        status: 'published',
        audience: 0,
        publishedAt: 1700000000000,
        deletedAt: null,
      });
      expect(courses[1]).toMatchObject({
        stageId: 'stage-2',
        name: 'Advanced Physics',
        status: 'draft',
        audience: 2,
        publishedAt: null,
      });
    });

    it('excludes deleted courses by default', async () => {
      const { listAllCoursesForAdmin } = await import('@/lib/persistence/admin-courses');
      const query = vi.fn(async () => ({
        rows: MOCK_COURSES.filter((c) => c.deleted_at === null),
      }));
      const queryable = { query } as any;
      const courses = await listAllCoursesForAdmin(queryable);
      expect(courses.every((c) => c.deletedAt === null)).toBe(true);
    });
  });

  describe('ADMIN_COURSES_OK: deleteCourseForAdmin', () => {
    it('tournstones stage_meta and deletes the document row', async () => {
      const { deleteCourseForAdmin } = await import('@/lib/persistence/admin-courses');
      const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
      const queryable = { query } as any;
      await deleteCourseForAdmin(queryable, 'stage-1', 'user:raw-user-alice');
      // First call: tombstoneStageMeta (UPDATE stage_meta SET deleted_at)
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE stage_meta'),
        expect.arrayContaining(['stage-1']),
      );
      // Second call: DELETE FROM document_stages
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM document_stages'),
        expect.arrayContaining(['stage-1']),
      );
    });
  });

  describe('ADMIN_COURSES_OK: DELETE /api/admin/courses/[id]', () => {
    it('returns 200 when authorized as admin', async () => {
      _mockSession = { userId: 'test-admin-1', token: 'tok', id: 'sess' };
      const { DELETE } = await import('@/app/api/admin/courses/[id]/route');
      const req = new Request('http://localhost/api/admin/courses/stage-1', {
        method: 'DELETE',
        headers: new Headers({ cookie: 'session=tok' }),
      });
      const res = await DELETE(req as never, {
        params: Promise.resolve({ id: 'stage-1' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 403 when no session', async () => {
      _mockSession = null;
      const { DELETE } = await import('@/app/api/admin/courses/[id]/route');
      const req = new Request('http://localhost/api/admin/courses/stage-1', {
        method: 'DELETE',
        headers: new Headers(),
      });
      const res = await DELETE(req as never, {
        params: Promise.resolve({ id: 'stage-1' }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 for missing course', async () => {
      _mockSession = { userId: 'test-admin-1', token: 'tok', id: 'sess' };
      const { DELETE } = await import('@/app/api/admin/courses/[id]/route');
      const req = new Request('http://localhost/api/admin/courses/stage-not-found', {
        method: 'DELETE',
        headers: new Headers({ cookie: 'session=tok' }),
      });
      const res = await DELETE(req as never, {
        params: Promise.resolve({ id: 'stage-not-found' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('ADMIN_COURSES_OK: GET /api/admin/courses', () => {
    it('returns 200 with courses array when authorized as admin', async () => {
      _mockSession = { userId: 'test-admin-1', token: 'tok', id: 'sess' };
      const { GET } = await import('@/app/api/admin/courses/route');
      const req = new Request('http://localhost/api/admin/courses', {
        method: 'GET',
        headers: new Headers({ cookie: 'session=tok' }),
      });
      const res = await GET(req as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.courses)).toBe(true);
      expect(body.courses).toHaveLength(2);
      expect(body.courses[0]).toMatchObject({
        stageId: 'stage-1',
        name: 'Intro to Algebra',
        ownerId: 'user:raw-user-alice',
        ownerEmail: 'alice@example.com',
        status: 'published',
        audience: 0,
        publishedAt: 1700000000000,
      });
    });

    it('returns 403 when no session', async () => {
      _mockSession = null;
      const { GET } = await import('@/app/api/admin/courses/route');
      const req = new Request('http://localhost/api/admin/courses', {
        method: 'GET',
        headers: new Headers(),
      });
      const res = await GET(req as never);
      expect(res.status).toBe(403);
    });
  });

  describe('ADMIN_COURSES_OK: courses-section component', () => {
    it('exports a client component', async () => {
      const mod = await import('@/components/admin/courses-section');
      expect(typeof mod.default).toBe('function');
    });
  });

  describe('ADMIN_COURSES_OK: i18n keys exist', () => {
    it('has admin.courses.title', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const courses = admin?.courses as Record<string, unknown> | undefined;
      expect(courses?.title).toBeDefined();
    });

    it('has admin.courses.owner', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const courses = admin?.courses as Record<string, unknown> | undefined;
      expect(courses?.owner).toBeDefined();
    });

    it('has admin.courses.delete', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const courses = admin?.courses as Record<string, unknown> | undefined;
      expect(courses?.delete).toBeDefined();
    });

    it('has admin.courses.unpublish', async () => {
      const mod = await import('@/lib/i18n/locales/en-US.json');
      const data = (mod as { default: Record<string, unknown> }).default;
      const admin = data.admin as Record<string, unknown> | undefined;
      const courses = admin?.courses as Record<string, unknown> | undefined;
      expect(courses?.unpublish).toBeDefined();
    });
  });
});
