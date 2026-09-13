/**
 * Hermetic unit test for the media gate (decideMediaAccess).
 *
 * Verifies:
 * - decideMediaAccess exists and is callable
 * - Published everyone-audience media serves to rank 0 and above
 * - Published learner media serves to rank 2 and above
 * - Draft courses answer deny
 * - Tombstoned courses answer deny
 * - Missing stage_meta rows answer deny
 * - Owner always passes regardless of status/audience
 * - Gated cache headers are private, no-store (route-level, verified in adversarial)
 * - Flag-off route returns public immutable headers (parity, verified in adversarial)
 *
 * Mocks at the queryable boundary per the hermetic unit rule.
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

const _mockSession: { userId: string; token: string; id: string } | null = null;

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

// ---------------------------------------------------------------------------
// decideMediaAccess tests (no DB required — queryable is mocked)
// ---------------------------------------------------------------------------

function mockQueryable(responses: any[]) {
  let callIndex = 0;
  return {
    query: vi.fn(async () => {
      const resp = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return resp;
    }),
  };
}

describe('MEDIA_GATE_OK: media gate unit', () => {
  it('module exports decideMediaAccess', async () => {
    const mod = await import('@/lib/persistence/media-access');
    expect(typeof mod.decideMediaAccess).toBe('function');
  });

  it('published everyone-audience media serves to anon (rank 0)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    // resolveViewerRank: anon returns 0 immediately (no queries)
    // readStageMeta: published, audience 0, not owner
    const q = mockQueryable([
      { rows: [{ status: 'published', audience: 0, deleted_at: null, owner_id: 'user:other' }] },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'anon:cookie');
    expect(result).toBe('allow');
  });

  it('published everyone-audience media serves to guest (rank 1)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const q = mockQueryable([
      { rows: [] },
      { rows: [{ rank: 1 }] },
      { rows: [{ status: 'published', audience: 0, deleted_at: null, owner_id: 'user:other' }] },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:guest-id');
    expect(result).toBe('allow');
  });

  it('published learner media serves to learner (rank 2)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const q = mockQueryable([
      { rows: [] },
      { rows: [{ rank: 2 }] },
      { rows: [{ status: 'published', audience: 2, deleted_at: null, owner_id: 'user:other' }] },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:learner-id');
    expect(result).toBe('allow');
  });

  it('published learner media denies guest (rank 1 < audience 2)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const q = mockQueryable([
      { rows: [] },
      { rows: [{ rank: 1 }] },
      { rows: [{ status: 'published', audience: 2, deleted_at: null, owner_id: 'user:other' }] },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:guest-id');
    expect(result).toBe('deny');
  });

  it('draft course answers deny', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const q = mockQueryable([
      { rows: [] },
      { rows: [{ rank: 4 }] },
      { rows: [{ status: 'draft', audience: 0, deleted_at: null, owner_id: 'user:other' }] },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:admin-id');
    expect(result).toBe('deny');
  });

  it('tombstoned course answers deny', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const q = mockQueryable([
      { rows: [] },
      { rows: [{ rank: 4 }] },
      {
        rows: [
          { status: 'published', audience: 0, deleted_at: new Date(), owner_id: 'user:other' },
        ],
      },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:admin-id');
    expect(result).toBe('deny');
  });

  it('missing stage_meta row answers deny', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const q = mockQueryable([{ rows: [] }, { rows: [{ rank: 4 }] }, { rows: [] }]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:admin-id');
    expect(result).toBe('deny');
  });

  it('owner always passes (published)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const q = mockQueryable([
      { rows: [] },
      { rows: [{ rank: 0 }] },
      { rows: [{ status: 'published', audience: 2, deleted_at: null, owner_id: 'user:owner-id' }] },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:owner-id');
    expect(result).toBe('allow');
  });

  it('owner always passes (draft)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const q = mockQueryable([
      { rows: [] },
      { rows: [{ rank: 0 }] },
      { rows: [{ status: 'draft', audience: 0, deleted_at: null, owner_id: 'user:owner-id' }] },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:owner-id');
    expect(result).toBe('allow');
  });

  it('banned user resolves to rank 0 (via resolveViewerRank)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    // resolveViewerRank: banned check returns true -> rank 0
    // readStageMeta: published learner media (audience 2) -> 0 < 2 -> deny
    const q = mockQueryable([
      { rows: [{ banned: true }] },
      { rows: [{ status: 'published', audience: 2, deleted_at: null, owner_id: 'user:other' }] },
    ]);
    const result = await decideMediaAccess(q as any, 'classroom-1', 'user:banned-id');
    expect(result).toBe('deny');
  });
});
