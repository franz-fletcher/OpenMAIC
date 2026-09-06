/**
 * Audience gate for the classroom media byte server.
 *
 * Decides whether a viewer may access a media file based on the stage_meta
 * row for the classroom (which IS the stage_id). The decision runs before
 * the file is opened so no bytes leak on a deny.
 *
 * Under MINIMAL_MODE the byte route calls this function and returns 404
 * on deny. Flag-off routes skip this gate entirely, keeping byte-identical
 * parity with the pre-batch behavior.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { resolveViewerRank } from '@/lib/persistence/audience';
import { readStageMeta } from '@/lib/persistence/stage-meta';

/**
 * Decide whether the viewer may access media for the given classroom.
 *
 * - Owner always passes (the owner created the media).
 * - Published courses pass when `audience <= viewerRank`.
 * - Draft courses, wrong-audience courses, tombstoned courses, and
 *   missing stage_meta rows all deny.
 *
 * @param queryable - Database connection for stage_meta and rank lookups.
 * @param classroomId - The classroom id (doubles as stage_id in stage_meta).
 * @param ownerId - The viewer's owner id (`user:<id>` or `anon:<cookie>`).
 * @returns `'allow'` or `'deny'`.
 */
export async function decideMediaAccess(
  queryable: Queryable,
  classroomId: string,
  ownerId: string,
): Promise<'allow' | 'deny'> {
  const viewerRank = await resolveViewerRank(queryable, ownerId);
  const meta = await readStageMeta(queryable, classroomId);
  if (!meta) return 'deny';
  if (meta.deletedAt !== null) return 'deny';
  if (meta.ownerId === ownerId) return 'allow';
  if (meta.status !== 'published') return 'deny';
  if (viewerRank < meta.audience) return 'deny';
  return 'allow';
}
