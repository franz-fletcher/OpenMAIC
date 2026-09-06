/**
 * DELETE /api/admin/courses/[id] -- admin delete-any route.
 *
 * Gates course.delete through requirePermission plus an explicit rank-4
 * check, because delete-any is a strict superset of the batch D publish-any
 * override and the catalog stays fixed at 11 permissions.
 *
 * Resolves the owner from stage_meta, tombstones, then deletes the document
 * row. The ON DELETE CASCADE removes stage_meta and all child rows.
 *
 * The guard call is wrapped in the nested Response-rethrow catch so the
 * typed 403 survives both outer catch layers (the route catch and the
 * withRequestOwnerId callback catch).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requirePermission } from '@/lib/auth';
import { resolveViewerRank } from '@/lib/persistence/audience';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { deleteCourseForAdmin } from '@/lib/persistence/admin-courses';
import { readStageAccessIncludingDeleted } from '@/lib/server/stage-access';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Params): Promise<Response> {
  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    const { id: stageId } = await params;

    try {
      // Permission guard inside the Response-rethrow catch so the
      // typed 403 rides through both catch layers unchanged.
      let session;
      try {
        session = await requirePermission(req.headers, 'course.delete');
      } catch (err) {
        if (err instanceof Response) return err;
        throw err;
      }

      // Explicit rank-4 check: delete-any is a strict superset of
      // publish-any, and the permission catalog stays fixed at 11 entries.
      const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      const viewerRank = await resolveViewerRank(pool, ownerId);
      if (viewerRank < 4) {
        return NextResponse.json(
          { error: 'forbidden', code: 'permission_denied' },
          { status: 403, headers: responseHeaders },
        );
      }

      // Resolve the owner from stage_meta (including tombstoned rows).
      const access = await readStageAccessIncludingDeleted(stageId);
      if (!access) {
        return NextResponse.json({ error: 'not_found' }, { status: 404, headers: responseHeaders });
      }

      // Delete through the owner scope so the cascade removes children.
      await deleteCourseForAdmin(pool, stageId, access.ownerId);

      return NextResponse.json({ success: true }, { status: 200, headers: responseHeaders });
    } catch (error) {
      console.error('Failed to delete course', {
        stageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'internal_error' },
        { status: 500, headers: responseHeaders },
      );
    }
  });
}
