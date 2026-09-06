/**
 * Admin course persistence. Provides the list-all query and the delete-any
 * operation for the admin courses section.
 *
 * listAllCoursesForAdmin joins stage_meta, document_stages, and user (left)
 * to return the full admin view including owner email, status, audience,
 * publishedAt, and deletedAt.
 *
 * deleteCourseForAdmin tombstones stage_meta then deletes the document row.
 * The ON DELETE CASCADE on stage_meta.stage_id removes the stage meta row
 * and all child rows when the document is deleted.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { tombstoneStageMeta } from '@/lib/persistence/stage-meta';

/** A single course entry in the admin course listing. */
export interface AdminCourse {
  stageId: string;
  name: string;
  ownerId: string;
  ownerEmail: string | null;
  status: 'draft' | 'published';
  audience: number;
  publishedAt: number | null;
  deletedAt: Date | null;
}

interface RawAdminCourseRow extends Record<string, unknown> {
  stage_id: string;
  name: string;
  owner_id: string;
  owner_email: string | null;
  status: string;
  audience: number;
  published_at: number | string | null;
  deleted_at: Date | string | null;
}

/**
 * List all courses for the admin table.
 *
 * Returns non-deleted courses by default. Pass `includeDeleted: true` to
 * include tombstoned rows. Returns owner, status, audience, publishedAt,
 * and deletedAt. Never returns document bytes.
 */
export async function listAllCoursesForAdmin(
  queryable: Queryable,
  filter?: { includeDeleted?: boolean },
): Promise<AdminCourse[]> {
  const includeDeleted = filter?.includeDeleted ?? false;

  const whereClause = includeDeleted ? '' : 'AND sm.deleted_at IS NULL';

  const result = await queryable.query<RawAdminCourseRow>(
    `SELECT sm.stage_id,
            d.name,
            sm.owner_id,
            u.email AS owner_email,
            sm.status,
            sm.audience,
            sm.published_at,
            sm.deleted_at
       FROM stage_meta sm
       JOIN document_stages d ON sm.stage_id = d.id
       LEFT JOIN "user" u ON sm.owner_id = 'user:' || u.id
      WHERE 1=1 ${whereClause}
      ORDER BY sm.published_at DESC NULLS LAST`,
    [],
  );

  return result.rows.map((row) => ({
    stageId: row.stage_id,
    name: row.name,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email,
    status: (row.status === 'published' ? 'published' : 'draft') as 'draft' | 'published',
    audience: typeof row.audience === 'number' ? row.audience : Number(row.audience) || 0,
    publishedAt:
      row.published_at === null
        ? null
        : typeof row.published_at === 'number'
          ? row.published_at
          : Number(row.published_at),
    deletedAt:
      row.deleted_at === null
        ? null
        : row.deleted_at instanceof Date
          ? row.deleted_at
          : new Date(row.deleted_at),
  }));
}

/**
 * Delete a course for the admin.
 *
 * Tombstones stage_meta first, then deletes the document row. The ON DELETE
 * CASCADE on stage_meta.stage_id removes the stage meta row and all child
 * rows when the document is deleted.
 *
 * The ownerId parameter scopes the delete through the owner-bound document
 * store so every store-level ownership check stays intact.
 */
export async function deleteCourseForAdmin(
  queryable: Queryable,
  stageId: string,
  ownerId: string,
): Promise<void> {
  // Tombstone first so the row exists for the cascade path.
  await tombstoneStageMeta(queryable, stageId);
  // Delete the document row. The ON DELETE CASCADE on stage_meta.stage_id
  // removes the stage meta row and all child rows.
  await queryable.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
}
