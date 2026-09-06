/**
 * POST /api/stages/[id]/publish -- make a document-backed course public.
 *
 * Enforces course.publish through requirePermission inside the
 * Response-rethrow catch so the typed 403 survives both catch layers.
 * Reads an optional audience (0=everyone, 1=guests, 2=learners) from
 * the body and defaults to 0 (everyone).
 *
 * Admins can publish any course. Owners can publish their own.
 * Foreign courses return 403 unless the caller is rank 4.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { setStageVisibility } from '@/lib/persistence/stage-meta';
import { getStageAccessDb, resolveStageAccess } from '@/lib/server/stage-access';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import { requirePermission } from '@/lib/auth';
import { resolveViewerRank } from '@/lib/persistence/audience';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!isAgentRuntimeConfigured()) return new Response('Not found', { status: 404 });

  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    const { id: stageId } = await params;

    try {
      // Permission guard inside the Response-rethrow catch so the
      // typed 403 rides through both catch layers unchanged.
      try {
        await requirePermission(req.headers, 'course.publish');
      } catch (err) {
        if (err instanceof Response) return err;
        throw err;
      }

      const access = await resolveStageAccess(stageId);
      if (!access) {
        return NextResponse.json({ error: 'not_found' }, { status: 404, headers: responseHeaders });
      }

      // Owner or admin (rank 4) can publish any course.
      // Normalize both sides to raw IDs: strip 'user:' prefix from both
      // the request ownerId and the DB ownerId before comparing.
      const requestRawId = ownerId.startsWith('user:') ? ownerId.slice(5) : ownerId;
      const dbRawId = access.ownerId.startsWith('user:') ? access.ownerId.slice(5) : access.ownerId;
      const isOwner = requestRawId === dbRawId;
      if (!isOwner) {
        const db = await getStageAccessDb();
        const viewerRank = await resolveViewerRank(db, ownerId);
        const isAdmin = viewerRank >= 4;
        if (!isAdmin) {
          return NextResponse.json(
            { error: 'forbidden' },
            { status: 403, headers: responseHeaders },
          );
        }
      }

      // Parse optional audience from body. Default to 0 (everyone).
      let audience = 0;
      try {
        const body = (await req.json()) as Record<string, unknown>;
        const rawAudience = body?.audience;
        if (typeof rawAudience === 'number' && rawAudience >= 0 && rawAudience <= 2) {
          audience = rawAudience;
        }
      } catch {
        // No body or invalid JSON: use default audience.
      }

      // Idempotent: republish returns current row without rewriting published_at.
      if (access.isPublic) {
        return NextResponse.json(
          { success: true, publishedAt: access.publishedAt, name: access.name, audience },
          { status: 200, headers: responseHeaders },
        );
      }

      const db = await getStageAccessDb();
      const publishedAt = Date.now();
      await setStageVisibility(db, stageId, 'published', audience);

      console.info('Stage published', { stageId, ownerId, audience });
      return NextResponse.json(
        { success: true, publishedAt, name: access.name, audience },
        { status: 200, headers: responseHeaders },
      );
    } catch (error) {
      console.error('Failed to publish stage', {
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
