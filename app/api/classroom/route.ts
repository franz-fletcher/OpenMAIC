import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { resolveViewerRank } from '@/lib/persistence/audience';
import { resolveStageAccess, getStageAccessDb } from '@/lib/server/stage-access';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';

const log = createLogger('Classroom API');

/**
 * Flag-gated MINIMAL_MODE check.
 *
 * Uses globalThis.process to survive Turbopack's compile-time env replacement.
 */
function isMinimalMode(): boolean {
  // Use globalThis.process to survive Turbopack's compile-time env replacement.
  // eslint-disable-next-line no-restricted-globals -- runtime env access for server-only flag
  const runtimeProcess = globalThis.process as NodeJS.Process | undefined;
  const mode = runtimeProcess?.env?.MINIMAL_MODE;
  return mode === 'true' || mode === '1';
}

export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    const persisted = await persistClassroom({ id, stage: { ...stage, id }, scenes }, baseUrl);

    return apiSuccess({ id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    return withRequestOwnerId(request, async (ownerId, responseHeaders) => {
      // Check stage_meta for this id.
      const access = await resolveStageAccess(id);

      // No stage_meta row: under MINIMAL_MODE answer 404 (creates nothing).
      // Flag-off keeps today's file serving (parity).
      if (!access) {
        if (isMinimalMode()) {
          return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
        }
        // Flag-off: keep today's file serving.
        const classroom = await readClassroom(id);
        if (!classroom) {
          return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
        }
        return apiSuccess({ classroom });
      }

      // stage_meta exists: apply the audience rule ONLY under MINIMAL_MODE.
      // Flag-off keeps today's file serving unchanged (parity with pre-batch
      // behavior where stage_meta was not checked on the classroom seam).
      if (isMinimalMode()) {
        const db = await getStageAccessDb();
        const viewerRank = await resolveViewerRank(db, ownerId);

        if (access.status !== 'published') {
          return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
        }
        if (viewerRank < access.audience) {
          return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
        }
      }

      const classroom = await readClassroom(id);
      if (!classroom) {
        return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
      }

      return apiSuccess({ classroom });
    });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
