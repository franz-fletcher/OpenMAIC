import type { Queryable } from '@openmaic/storage/document/pg';

/** A single course entry in the public gallery listing. */
export interface GalleryCourse {
  stageId: string;
  name: string;
  publishedAt: number | null;
}

/**
 * List published, non-deleted courses visible to the given viewer rank.
 *
 * Returns courses whose audience tier is at or below the viewer rank,
 * ordered by `published_at` descending. The query joins the document_stages
 * table to obtain the course name but never returns `owner_id` or other
 * tenancy fields.
 *
 * Draft rows and rows with `deleted_at` set are excluded. Courses that
 * have no `stage_meta` row are also excluded.
 */
export async function listGalleryCourses(
  queryable: Queryable,
  viewerRank: number,
): Promise<GalleryCourse[]> {
  const result = await queryable.query<{
    stage_id: string;
    name: string;
    published_at: number | string | null;
  }>(
    `SELECT s.stage_id, d.name, s.published_at
       FROM stage_meta s
       JOIN document_stages d ON s.stage_id = d.id
      WHERE s.status = 'published'
        AND s.deleted_at IS NULL
        AND s.audience <= $1
      ORDER BY s.published_at DESC`,
    [viewerRank],
  );

  return result.rows.map((row) => ({
    stageId: row.stage_id,
    name: row.name,
    publishedAt:
      row.published_at === null
        ? null
        : typeof row.published_at === 'number'
          ? row.published_at
          : Number(row.published_at),
  }));
}
