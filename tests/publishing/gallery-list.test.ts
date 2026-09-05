import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listGalleryCourses, type GalleryCourse } from '@/lib/persistence/gallery';

describe('publishing gallery list', () => {
  describe('listGalleryCourses', () => {
    it('returns published courses within viewer rank', async () => {
      const queryable = {
        query: vi.fn().mockResolvedValue({
          rows: [
            { stage_id: 's1', name: 'Math 101', published_at: 1000 },
            { stage_id: 's2', name: 'Physics 101', published_at: 500 },
          ],
        }),
      };

      const courses = await listGalleryCourses(queryable as any, 0);

      expect(courses).toHaveLength(2);
      expect(courses[0]).toEqual({ stageId: 's1', name: 'Math 101', publishedAt: 1000 });
      expect(courses[1]).toEqual({ stageId: 's2', name: 'Physics 101', publishedAt: 500 });
      expect(queryable.query).toHaveBeenCalledWith(
        `SELECT s.stage_id, d.name, s.published_at
       FROM stage_meta s
       JOIN document_stages d ON s.stage_id = d.id
      WHERE s.status = 'published'
        AND s.deleted_at IS NULL
        AND s.audience <= $1
      ORDER BY s.published_at DESC`,
        [0],
      );
    });

    it('filters by audience tier', async () => {
      const queryable = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      await listGalleryCourses(queryable as any, 1);

      expect(queryable.query).toHaveBeenCalledWith(expect.any(String), [1]);
    });

    it('returns empty array when no courses match', async () => {
      const queryable = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      const courses = await listGalleryCourses(queryable as any, 0);

      expect(courses).toEqual([]);
    });

    it('handles null published_at', async () => {
      const queryable = {
        query: vi.fn().mockResolvedValue({
          rows: [{ stage_id: 's1', name: 'Test', published_at: null }],
        }),
      };

      const courses = await listGalleryCourses(queryable as any, 0);

      expect(courses[0].publishedAt).toBeNull();
    });

    it('handles string published_at', async () => {
      const queryable = {
        query: vi.fn().mockResolvedValue({
          rows: [{ stage_id: 's1', name: 'Test', published_at: '1700000000' }],
        }),
      };

      const courses = await listGalleryCourses(queryable as any, 0);

      expect(courses[0].publishedAt).toBe(1700000000);
    });
  });
});
