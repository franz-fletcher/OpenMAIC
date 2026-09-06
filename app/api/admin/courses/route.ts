/**
 * GET /api/admin/courses -- admin course listing route.
 *
 * Gated by users.manage. Returns the full admin view including owner email,
 * status, audience, publishedAt, and deletedAt.
 *
 * The guard call is wrapped in the nested Response-rethrow catch so the
 * typed 403 survives both outer catch layers (the route catch and the
 * withRequestOwnerId callback catch).
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { listAllCoursesForAdmin } from '@/lib/persistence/admin-courses';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    // Permission guard: users.manage required.
    let session;
    try {
      session = await requirePermission(req.headers, 'users.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const url = new URL(req.url);
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true';

    const courses = await listAllCoursesForAdmin(pool, { includeDeleted });
    return Response.json({ success: true, courses });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
