/**
 * Admin invite revoke route. Gated by users.manage.
 *
 * DELETE: revokes one invite by id so the accept link stops working.
 *
 * The guard call is wrapped in the nested Response-rethrow catch so the
 * typed 403 survives both outer catch layers (the route catch and the
 * withRequestOwnerId callback catch).
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { revokeInvite } from '@/lib/auth/invites';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params): Promise<Response> {
  try {
    let session;
    try {
      session = await requirePermission(_req.headers, 'users.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const { id } = await params;
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    await revokeInvite(pool, id);

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
