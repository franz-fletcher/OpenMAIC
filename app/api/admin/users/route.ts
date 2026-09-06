/**
 * Admin user management routes. Gated by users.manage.
 *
 * GET: returns the filtered user list.
 * PATCH: applies role or ban mutations.
 *
 * The guard call is wrapped in the nested Response-rethrow catch so the
 * typed 403 survives both outer catch layers (the route catch and the
 * withRequestOwnerId callback catch).
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { listUsers, setUserRole, setUserBanned } from '@/lib/persistence/admin-users';
import { listRoles } from '@/lib/auth/roles';
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
    const query = url.searchParams.get('query') ?? undefined;
    const roleName = url.searchParams.get('role') ?? undefined;
    const bannedParam = url.searchParams.get('banned');
    const banned = bannedParam !== null ? bannedParam === 'true' : undefined;

    const users = await listUsers(pool, { query, roleName, banned });
    return Response.json({ success: true, users });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function PATCH(req: NextRequest): Promise<Response> {
  try {
    // Permission guard: users.manage required.
    let session;
    try {
      session = await requirePermission(req.headers, 'users.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = (await req.json()) as Record<string, unknown>;
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');

    if (body.action === 'setRole') {
      const { userId, roleId } = body as { userId: string; roleId: string };
      if (!userId || !roleId) {
        return Response.json(
          { success: false, code: 'MISSING_FIELDS', message: 'userId and roleId required' },
          { status: 400 },
        );
      }
      try {
        await setUserRole(pool, userId, roleId, session.userId);
      } catch (err) {
        if (err instanceof Error && err.message === 'Cannot change your own role assignment') {
          return Response.json(
            {
              success: false,
              code: 'SELF_DEMOTE_REFUSED',
              message: 'Cannot change your own role assignment',
            },
            { status: 400 },
          );
        }
        throw err;
      }
      return Response.json({ success: true });
    }

    if (body.action === 'setBanned') {
      const { userId, banned, reason } = body as {
        userId: string;
        banned: boolean;
        reason?: string;
      };
      if (!userId || typeof banned !== 'boolean') {
        return Response.json(
          { success: false, code: 'MISSING_FIELDS', message: 'userId and banned required' },
          { status: 400 },
        );
      }
      try {
        await setUserBanned(pool, userId, banned, reason, session.userId);
      } catch (err) {
        if (err instanceof Error && err.message === 'Cannot ban your own session') {
          return Response.json(
            { success: false, code: 'SELF_BAN_REFUSED', message: 'Cannot ban your own session' },
            { status: 400 },
          );
        }
        throw err;
      }
      return Response.json({ success: true });
    }

    return Response.json(
      { success: false, code: 'INVALID_ACTION', message: 'Unknown action' },
      { status: 400 },
    );
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
