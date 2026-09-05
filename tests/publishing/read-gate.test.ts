import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AUDIENCE_RANK, resolveViewerRank } from '@/lib/persistence/audience';
import {
  decideDocumentAccess,
  parseDocumentAction,
  type DocumentAction,
} from '@/lib/persistence/document-access';

describe('publishing read gate', () => {
  describe('AUDIENCE_RANK', () => {
    it('exposes the three rank tiers', () => {
      expect(AUDIENCE_RANK.EVERYONE).toBe(0);
      expect(AUDIENCE_RANK.GUEST).toBe(1);
      expect(AUDIENCE_RANK.LEARNER).toBe(2);
    });
  });

  describe('resolveViewerRank', () => {
    it('returns 0 for anon: owners', async () => {
      const queryable = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      const rank = await resolveViewerRank(queryable as any, 'anon:guest');
      expect(rank).toBe(0);
      expect(queryable.query).not.toHaveBeenCalled();
    });

    it('returns 0 for unknown user ids', async () => {
      const queryable = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      const rank = await resolveViewerRank(queryable as any, 'user:unknown');
      expect(rank).toBe(0);
      expect(queryable.query).toHaveBeenCalledWith(
        'SELECT r.rank FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1',
        ['user:unknown'],
      );
    });

    it('returns the role rank for known users', async () => {
      const queryable = {
        query: vi.fn().mockResolvedValue({ rows: [{ rank: 3 }] }),
      };
      const rank = await resolveViewerRank(queryable as any, 'user:creator');
      expect(rank).toBe(3);
    });
  });

  describe('decideDocumentAccess read case', () => {
    const readMeta = vi.fn();
    const documentExists = vi.fn().mockResolvedValue(true);

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('allows owner reads of drafts', async () => {
      readMeta.mockResolvedValue({
        stageId: 's1',
        ownerId: 'user:owner',
        isPublic: false,
        status: 'draft',
        audience: 3,
        publishedAt: null,
        deletedAt: null,
      });
      const action: DocumentAction = { kind: 'read', stageId: 's1' };
      const result = await decideDocumentAccess(
        action,
        'user:owner',
        readMeta,
        documentExists,
        readMeta,
        0,
      );
      expect(result).toBe('allow');
    });

    it('allows owner reads of published courses', async () => {
      readMeta.mockResolvedValue({
        stageId: 's1',
        ownerId: 'user:owner',
        isPublic: true,
        status: 'published',
        audience: 0,
        publishedAt: Date.now(),
        deletedAt: null,
      });
      const action: DocumentAction = { kind: 'read', stageId: 's1' };
      const result = await decideDocumentAccess(
        action,
        'user:owner',
        readMeta,
        documentExists,
        readMeta,
        0,
      );
      expect(result).toBe('allow');
    });

    it('returns not-found for non-owner reading a draft', async () => {
      readMeta.mockResolvedValue({
        stageId: 's1',
        ownerId: 'user:owner',
        isPublic: false,
        status: 'draft',
        audience: 3,
        publishedAt: null,
        deletedAt: null,
      });
      const action: DocumentAction = { kind: 'read', stageId: 's1' };
      const result = await decideDocumentAccess(
        action,
        'user:viewer',
        readMeta,
        documentExists,
        readMeta,
        0,
      );
      expect(result).toBe('not-found');
    });

    it('returns not-found for non-owner when viewer rank is below audience', async () => {
      readMeta.mockResolvedValue({
        stageId: 's1',
        ownerId: 'user:owner',
        isPublic: true,
        status: 'published',
        audience: 2,
        publishedAt: Date.now(),
        deletedAt: null,
      });
      const action: DocumentAction = { kind: 'read', stageId: 's1' };
      const result = await decideDocumentAccess(
        action,
        'user:guest',
        readMeta,
        documentExists,
        readMeta,
        1,
      );
      expect(result).toBe('not-found');
    });

    it('allows non-owner when course is published and viewer rank meets audience', async () => {
      readMeta.mockResolvedValue({
        stageId: 's1',
        ownerId: 'user:owner',
        isPublic: true,
        status: 'published',
        audience: 1,
        publishedAt: Date.now(),
        deletedAt: null,
      });
      const action: DocumentAction = { kind: 'read', stageId: 's1' };
      const result = await decideDocumentAccess(
        action,
        'user:learner',
        readMeta,
        documentExists,
        readMeta,
        2,
      );
      expect(result).toBe('allow');
    });

    it('returns not-found for non-published course with no owner match', async () => {
      readMeta.mockResolvedValue({
        stageId: 's1',
        ownerId: 'user:owner',
        isPublic: false,
        status: 'draft',
        audience: 3,
        publishedAt: null,
        deletedAt: null,
      });
      const action: DocumentAction = { kind: 'read', stageId: 's1' };
      const result = await decideDocumentAccess(
        action,
        'anon:guest',
        readMeta,
        documentExists,
        readMeta,
        0,
      );
      expect(result).toBe('not-found');
    });

    it('returns not-found when stage meta is absent', async () => {
      readMeta.mockResolvedValue(null);
      const action: DocumentAction = { kind: 'read', stageId: 'nonexistent' };
      const result = await decideDocumentAccess(
        action,
        'user:anyone',
        readMeta,
        documentExists,
        readMeta,
        0,
      );
      expect(result).toBe('not-found');
    });

    it('returns not-found for tombstoned course', async () => {
      readMeta.mockResolvedValue({
        stageId: 's1',
        ownerId: 'user:owner',
        isPublic: true,
        status: 'published',
        audience: 0,
        publishedAt: Date.now(),
        deletedAt: new Date(),
      });
      const action: DocumentAction = { kind: 'read', stageId: 's1' };
      const result = await decideDocumentAccess(
        action,
        'user:anyone',
        readMeta,
        documentExists,
        readMeta,
        0,
      );
      expect(result).toBe('not-found');
    });

    it('returns forbid for non-owner write when not owner', async () => {
      readMeta.mockResolvedValue({
        stageId: 's1',
        ownerId: 'user:owner',
        isPublic: true,
        status: 'published',
        audience: 0,
        publishedAt: Date.now(),
        deletedAt: null,
      });
      const action: DocumentAction = { kind: 'write', stageId: 's1' };
      const result = await decideDocumentAccess(
        action,
        'user:other',
        readMeta,
        documentExists,
        readMeta,
        0,
      );
      expect(result).toBe('forbid');
    });
  });
});
