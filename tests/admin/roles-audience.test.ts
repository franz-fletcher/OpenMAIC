/**
 * Hermetic unit test for custom role audience rank probes.
 *
 * Verifies that:
 * - resolveViewerRank resolves custom rank-2 role users to rank 2
 * - decideDocumentAccess allows a rank-2 viewer to read a published
 *   learner-audience course
 * - decideDocumentAccess denies a rank-2 viewer reading a creator-audience
 *   course (audience 3 > rank 2)
 *
 * Gate: ROLE_AUDIENCE_OK
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
// Tests
// ---------------------------------------------------------------------------

describe('ROLE_AUDIENCE_OK: custom role audience rank probes', () => {
  describe('resolveViewerRank', () => {
    it('returns 0 for anon: owners', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const queryable = {
        query: vi.fn(async () => ({ rows: [] })),
      } as any;
      const rank = await resolveViewerRank(queryable, 'anon:session-1');
      expect(rank).toBe(0);
    });

    it('returns the role rank for user: owners with a role assignment', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const queryable = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('"banned"')) {
            return { rows: [{ banned: false }] };
          }
          if (sql.includes('user_roles')) {
            return { rows: [{ rank: 2 }] };
          }
          return { rows: [] };
        }),
      } as any;
      const rank = await resolveViewerRank(queryable, 'user:custom-user-1');
      expect(rank).toBe(2);
    });

    it('strips the user: prefix before joining user_roles', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const capturedParams: unknown[] = [];
      const queryable = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('"banned"')) {
            return { rows: [{ banned: false }] };
          }
          if (sql.includes('user_roles')) {
            capturedParams.push(...(params ?? []));
            return { rows: [{ rank: 2 }] };
          }
          return { rows: [] };
        }),
      } as any;
      await resolveViewerRank(queryable, 'user:abc-123');
      // The second call (user_roles join) should have the raw id without prefix
      expect(capturedParams).toContain('abc-123');
    });

    it('returns 0 for unknown users with no role assignment', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const queryable = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('"banned"')) {
            return { rows: [] };
          }
          if (sql.includes('user_roles')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as any;
      const rank = await resolveViewerRank(queryable, 'user:unknown-user');
      expect(rank).toBe(0);
    });

    it('returns 0 for banned users', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const queryable = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('"banned"')) {
            return { rows: [{ banned: true }] };
          }
          return { rows: [] };
        }),
      } as any;
      const rank = await resolveViewerRank(queryable, 'user:banned-user');
      expect(rank).toBe(0);
    });
  });

  describe('decideDocumentAccess', () => {
    const readMetaFn = (overrides: Record<string, unknown> = {}) => {
      return vi.fn(async () => ({
        stageId: 'course-1',
        ownerId: 'user:other-owner',
        status: 'published' as const,
        audience: 2,
        publishedAt: Date.now(),
        generationComplete: true,
        deletedAt: null,
        isPublic: true,
        ...overrides,
      }));
    };

    const documentExistsFn = (exists = true) => {
      return vi.fn(async () => exists);
    };

    it('allows a rank-2 viewer to read a published learner-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:rank2-viewer',
        readMetaFn(),
        documentExistsFn(),
        readMetaFn(),
        2,
      );
      expect(result).toBe('allow');
    });

    it('allows a rank-2 viewer to read a published everyone-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:rank2-viewer',
        readMetaFn({ audience: 0 }),
        documentExistsFn(),
        readMetaFn({ audience: 0 }),
        2,
      );
      expect(result).toBe('allow');
    });

    it('allows a rank-2 viewer to read a published guest-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:rank2-viewer',
        readMetaFn({ audience: 1 }),
        documentExistsFn(),
        readMetaFn({ audience: 1 }),
        2,
      );
      expect(result).toBe('allow');
    });

    it('denies a rank-1 viewer reading a learner-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:rank1-viewer',
        readMetaFn(),
        documentExistsFn(),
        readMetaFn(),
        1,
      );
      expect(result).toBe('not-found');
    });

    it('denies a rank-0 viewer reading a learner-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:rank0-viewer',
        readMetaFn(),
        documentExistsFn(),
        readMetaFn(),
        0,
      );
      expect(result).toBe('not-found');
    });

    it('denies a rank-2 viewer reading a creator-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:rank2-viewer',
        readMetaFn({ audience: 3 }),
        documentExistsFn(),
        readMetaFn({ audience: 3 }),
        2,
      );
      expect(result).toBe('not-found');
    });

    it('returns not-found for a draft course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:rank2-viewer',
        readMetaFn({ status: 'draft' }),
        documentExistsFn(),
        readMetaFn({ status: 'draft' }),
        2,
      );
      expect(result).toBe('not-found');
    });

    it('returns not-found for a deleted course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:rank2-viewer',
        readMetaFn({ deletedAt: new Date() }),
        documentExistsFn(),
        readMetaFn({ deletedAt: new Date() }),
        2,
      );
      expect(result).toBe('not-found');
    });

    it('allows the owner to read their own draft course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const action = { kind: 'read' as const, stageId: 'course-1' };
      const result = await decideDocumentAccess(
        action,
        'user:course-owner',
        readMetaFn({ ownerId: 'user:course-owner', status: 'draft' }),
        documentExistsFn(),
        readMetaFn({ ownerId: 'user:course-owner', status: 'draft' }),
        0,
      );
      expect(result).toBe('allow');
    });
  });
});
