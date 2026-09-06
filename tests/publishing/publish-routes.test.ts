/**
 * Unit tests for the publish and unpublish routes.
 *
 * Drives the real POST handlers with mocked getSession, resolveStageAccess,
 * setStageVisibility, and resolveViewerRank. Verifies the full route flow:
 * permission guard, ownership/admin check, audience write, response shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the agent-runtime flag so routes return real responses.
vi.mock('@/lib/config/feature-flags', () => ({
  isAgentRuntimeConfigured: () => true,
}));

// Mock getSession to control the caller identity.
const mockGetSession = vi.fn<() => Promise<{ userId: string } | null>>();
vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...(args as [])),
  requirePermission: async (headers: Headers, permission: string) => {
    const session = await mockGetSession();
    if (!session) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    // Simulate rank check: creator rank 3 has course.publish, learner rank 2 does not.
    if (session.userId === 'learner-user') {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    return session;
  },
}));

// Mock resolveStageAccess to control course state.
const mockResolveStageAccess = vi.fn<
  () => Promise<{
    stageId: string;
    ownerId: string;
    name: string;
    isPublic: boolean;
    status: string;
    audience: number;
    publishedAt: number | null;
    generationComplete: boolean;
    source: string;
    deletedAt: Date | null;
  } | null>
>();
vi.mock('@/lib/server/stage-access', () => ({
  resolveStageAccess: (...args: unknown[]) => mockResolveStageAccess(...(args as [])),
  getStageAccessDb: vi.fn().mockResolvedValue({ query: vi.fn() }),
}));

// Mock setStageVisibility to capture calls.
const mockSetStageVisibility = vi.fn<() => Promise<void>>();
vi.mock('@/lib/persistence/stage-meta', () => ({
  setStageVisibility: (...args: unknown[]) => mockSetStageVisibility(...(args as [])),
}));

// Mock resolveViewerRank for admin check.
const mockResolveViewerRank = vi.fn<() => Promise<number>>();
vi.mock('@/lib/persistence/audience', () => ({
  resolveViewerRank: (...args: unknown[]) => mockResolveViewerRank(...(args as [])),
  AUDIENCE_RANK: { EVERYONE: 0, GUEST: 1, LEARNER: 2 },
}));

// Import AFTER mocks are set.
import { POST as publishPOST } from '@/app/api/stages/[id]/publish/route';
import { POST as unpublishPOST } from '@/app/api/stages/[id]/unpublish/route';

function makePublishRequest(stageId: string, body?: Record<string, unknown>): NextRequest {
  const url = `http://localhost/api/stages/${stageId}/publish`;
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeParams(stageId: string) {
  return { params: Promise.resolve({ id: stageId }) };
}

describe('publish-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- publish route ---

  describe('POST /api/stages/[id]/publish', () => {
    it('returns 403 for unauthenticated caller', async () => {
      mockGetSession.mockResolvedValue(null);
      const req = makePublishRequest('stage-1');
      const res = await publishPOST(req, makeParams('stage-1'));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('permission_denied');
    });

    it('returns 403 for learner (no course.publish permission)', async () => {
      mockGetSession.mockResolvedValue({ userId: 'learner-user' });
      const req = makePublishRequest('stage-1');
      const res = await publishPOST(req, makeParams('stage-1'));
      expect(res.status).toBe(403);
    });

    it('returns 404 for absent course', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue(null);
      const req = makePublishRequest('stage-missing');
      const res = await publishPOST(req, makeParams('stage-missing'));
      expect(res.status).toBe(404);
    });

    it('creator publishes own course with default audience 0', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-1',
        ownerId: 'creator-user',
        name: 'My Course',
        isPublic: false,
        status: 'draft',
        audience: 3,
        publishedAt: null,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });
      mockSetStageVisibility.mockResolvedValue(undefined);

      const req = makePublishRequest('stage-1');
      const res = await publishPOST(req, makeParams('stage-1'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.audience).toBe(0);
      expect(body.name).toBe('My Course');
      expect(mockSetStageVisibility).toHaveBeenCalledWith(
        expect.anything(),
        'stage-1',
        'published',
        0,
      );
    });

    it('creator publishes own course with explicit audience', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-1',
        ownerId: 'creator-user',
        name: 'My Course',
        isPublic: false,
        status: 'draft',
        audience: 3,
        publishedAt: null,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });
      mockSetStageVisibility.mockResolvedValue(undefined);

      const req = makePublishRequest('stage-1', { audience: 2 });
      const res = await publishPOST(req, makeParams('stage-1'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.audience).toBe(2);
      expect(mockSetStageVisibility).toHaveBeenCalledWith(
        expect.anything(),
        'stage-1',
        'published',
        2,
      );
    });

    it('creator returns 403 for foreign course', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-foreign',
        ownerId: 'other-creator',
        name: 'Foreign Course',
        isPublic: false,
        status: 'draft',
        audience: 3,
        publishedAt: null,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });
      mockResolveViewerRank.mockResolvedValue(3); // creator rank

      const req = makePublishRequest('stage-foreign');
      const res = await publishPOST(req, makeParams('stage-foreign'));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('forbidden');
    });

    it('admin publishes foreign course', async () => {
      mockGetSession.mockResolvedValue({ userId: 'admin-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-foreign',
        ownerId: 'other-creator',
        name: 'Foreign Course',
        isPublic: false,
        status: 'draft',
        audience: 3,
        publishedAt: null,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });
      mockResolveViewerRank.mockResolvedValue(4); // admin rank
      mockSetStageVisibility.mockResolvedValue(undefined);

      const req = makePublishRequest('stage-foreign');
      const res = await publishPOST(req, makeParams('stage-foreign'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('idempotent republish returns current row', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-1',
        ownerId: 'creator-user',
        name: 'My Course',
        isPublic: true,
        status: 'published',
        audience: 0,
        publishedAt: 1234567890,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });

      const req = makePublishRequest('stage-1');
      const res = await publishPOST(req, makeParams('stage-1'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.publishedAt).toBe(1234567890);
      expect(mockSetStageVisibility).not.toHaveBeenCalled();
    });

    it('audience outside 0-2 defaults to 0', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-1',
        ownerId: 'creator-user',
        name: 'My Course',
        isPublic: false,
        status: 'draft',
        audience: 3,
        publishedAt: null,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });
      mockSetStageVisibility.mockResolvedValue(undefined);

      const req = makePublishRequest('stage-1', { audience: 5 });
      const res = await publishPOST(req, makeParams('stage-1'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.audience).toBe(0);
    });
  });

  // --- unpublish route ---

  describe('POST /api/stages/[id]/unpublish', () => {
    it('returns 403 for unauthenticated caller', async () => {
      mockGetSession.mockResolvedValue(null);
      const req = makePublishRequest('stage-1');
      const res = await unpublishPOST(req, makeParams('stage-1'));
      expect(res.status).toBe(403);
    });

    it('unpublishes own course and keeps stored audience', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-1',
        ownerId: 'creator-user',
        name: 'My Course',
        isPublic: true,
        status: 'published',
        audience: 1,
        publishedAt: 1234567890,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });
      mockSetStageVisibility.mockResolvedValue(undefined);

      const req = makePublishRequest('stage-1');
      const res = await unpublishPOST(req, makeParams('stage-1'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockSetStageVisibility).toHaveBeenCalledWith(expect.anything(), 'stage-1', 'draft', 1);
    });

    it('admin unpublishes foreign course', async () => {
      mockGetSession.mockResolvedValue({ userId: 'admin-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-foreign',
        ownerId: 'other-creator',
        name: 'Foreign Course',
        isPublic: true,
        status: 'published',
        audience: 0,
        publishedAt: 1234567890,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });
      mockResolveViewerRank.mockResolvedValue(4);
      mockSetStageVisibility.mockResolvedValue(undefined);

      const req = makePublishRequest('stage-foreign');
      const res = await unpublishPOST(req, makeParams('stage-foreign'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('creator returns 403 for foreign unpublish', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue({
        stageId: 'stage-foreign',
        ownerId: 'other-creator',
        name: 'Foreign Course',
        isPublic: true,
        status: 'published',
        audience: 0,
        publishedAt: 1234567890,
        generationComplete: true,
        source: 'db',
        deletedAt: null,
      });
      mockResolveViewerRank.mockResolvedValue(3);

      const req = makePublishRequest('stage-foreign');
      const res = await unpublishPOST(req, makeParams('stage-foreign'));
      expect(res.status).toBe(403);
    });

    it('returns 404 for absent course', async () => {
      mockGetSession.mockResolvedValue({ userId: 'creator-user' });
      mockResolveStageAccess.mockResolvedValue(null);

      const req = makePublishRequest('stage-missing');
      const res = await unpublishPOST(req, makeParams('stage-missing'));
      expect(res.status).toBe(404);
    });
  });
});
