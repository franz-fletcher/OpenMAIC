import { promises as fs, createReadStream, type ReadStream } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { CLASSROOMS_DIR, isValidClassroomId } from '@/lib/server/classroom-storage';
import { parseRangeHeader } from '@/lib/server/http-range';
import { createLogger } from '@/lib/logger';
import { decideMediaAccess } from '@/lib/persistence/media-access';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';

const log = createLogger('ClassroomMedia');

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
};

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=86400, immutable' } as const;
const GATED_CACHE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

/**
 * Flag-gated MINIMAL_MODE check.
 *
 * Uses globalThis.process to survive Turbopack's compile-time env replacement.
 */
function isMinimalMode(): boolean {
  // eslint-disable-next-line no-restricted-globals -- runtime env access for server-only flag
  const runtimeProcess = globalThis.process as NodeJS.Process | undefined;
  const mode = runtimeProcess?.env?.MINIMAL_MODE;
  return mode === 'true' || mode === '1';
}

/** Bridge a fs ReadStream into a web ReadableStream, propagating errors and cancel. */
function toWebStream(stream: ReadStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      stream.on('data', (chunk: Buffer | string) => controller.enqueue(chunk));
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classroomId: string; path: string[] }> },
) {
  return withRequestOwnerId(req, async (ownerId) => {
    const { classroomId, path: pathSegments } = await params;

    // Validate classroomId
    if (!isValidClassroomId(classroomId)) {
      return NextResponse.json({ error: 'Invalid classroom ID' }, { status: 400 });
    }

    // Validate path segments — no traversal
    const joined = pathSegments.join('/');
    if (joined.includes('..') || pathSegments.some((s) => s.includes('\0'))) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Only allow media/ and audio/ subdirectories
    const subDir = pathSegments[0];
    if (subDir !== 'media' && subDir !== 'audio') {
      return NextResponse.json({ error: 'Invalid path' }, { status: 404 });
    }

    // Under MINIMAL_MODE, decide access before opening the file so no bytes
    // leak on a deny. Flag-off keeps today's byte-identical behavior.
    if (isMinimalMode()) {
      try {
        const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
        const decision = await decideMediaAccess(pool, classroomId, ownerId);
        if (decision === 'deny') {
          return new NextResponse(null, {
            status: 404,
            headers: { 'Cache-Control': 'no-store' },
          });
        }
      } catch {
        // If the gate fails (e.g. no database), deny to prevent leaks.
        return new NextResponse(null, {
          status: 404,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    }

    const filePath = path.join(CLASSROOMS_DIR, classroomId, ...pathSegments);
    const resolvedBase = path.resolve(CLASSROOMS_DIR, classroomId);

    try {
      // Resolve symlinks and verify the real path stays within the classroom dir
      const realPath = await fs.realpath(filePath);
      if (!realPath.startsWith(resolvedBase + path.sep) && realPath !== resolvedBase) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const stat = await fs.stat(realPath);
      if (!stat.isFile()) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const ext = path.extname(realPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Range requests enable progressive playback and seeking for hosted media
      // (e.g. <video> streams the moov atom first, then fetches on seek).
      const range = parseRangeHeader(req.headers.get('range'), stat.size);

      if (range.kind === 'unsatisfiable') {
        // Never cache a range error: an immutable/public 416 would poison the
        // media URL in shared and browser caches, breaking later valid requests.
        return new NextResponse(null, {
          status: 416,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Range': `bytes */${stat.size}`,
          },
        });
      }

      const activeCacheHeaders = isMinimalMode() ? GATED_CACHE_HEADERS : CACHE_HEADERS;

      if (range.kind === 'range') {
        const stream = createReadStream(realPath, { start: range.start, end: range.end });
        return new NextResponse(toWebStream(stream), {
          status: 206,
          headers: {
            ...activeCacheHeaders,
            'Content-Type': contentType,
            'Content-Length': String(range.end - range.start + 1),
            'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      // Stream the file to avoid loading large videos into memory
      return new NextResponse(toWebStream(createReadStream(realPath)), {
        status: 200,
        headers: {
          ...activeCacheHeaders,
          'Content-Type': contentType,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      log.error(
        `Classroom media serving failed [classroomId=${classroomId}, path=${joined}]:`,
        error,
      );
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
  });
}
