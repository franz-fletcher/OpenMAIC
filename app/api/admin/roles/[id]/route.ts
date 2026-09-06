/**
 * Admin role management routes (by ID). Gated by roles.manage.
 *
 * PATCH: applies rename, rank change, permission overrides, or override reset.
 *   Refuses mutation of the acting session's own role (self-lockout guard).
 * DELETE: deletes a custom role with no attached users.
 *   Refuses the acting session's own role (self-lockout guard).
 *
 * The guard call is wrapped in the nested Response-rethrow catch so the
 * typed 403 survives both outer catch layers.
 */
import { NextRequest } from 'next/server';
import { requirePermission, getSession } from '@/lib/auth';
import { updateRole, resetRoleOverrides, deleteRole } from '@/lib/persistence/admin-roles';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

type Params = { params: Promise<{ id: string }> };

/**
 * Resolves the acting session's current role name from the database.
 * Joins user_roles and roles to get the role name for the session user.
 */
async function resolveSessionRoleName(
  pool: { query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }> },
  userId: string,
): Promise<string | null> {
  const result = await pool.query<{ role_name: string }>(
    `SELECT r.name as role_name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
    [userId],
  );
  return result.rows.length > 0 ? result.rows[0].role_name : null;
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  try {
    // Permission guard: roles.manage required.
    let session;
    try {
      session = await requirePermission(req.headers, 'roles.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const { id: roleId } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const { name, rank, permissions, reset } = body as {
      name?: string;
      rank?: number;
      permissions?: Array<{ permission: string; granted: boolean }>;
      reset?: boolean;
    };

    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');

    // Self-lockout guard: refuse mutation of the acting session's own role.
    const sessionRoleName = await resolveSessionRoleName(pool, session.userId);
    if (sessionRoleName) {
      // Fetch the target role's name to compare.
      const targetResult = await pool.query<{ name: string }>(
        `SELECT name FROM roles WHERE id = $1`,
        [roleId],
      );
      if (targetResult.rows.length > 0 && targetResult.rows[0].name === sessionRoleName) {
        // Additionally, refuse if the update would strip roles.manage from
        // the acting session's own role.
        if (permissions !== undefined) {
          const hasManageGrant = permissions.some(
            (p) => p.permission === 'roles.manage' && p.granted === false,
          );
          if (hasManageGrant) {
            return Response.json(
              {
                success: false,
                code: 'SELF_LOCKOUT_REFUSED',
                message: 'Cannot strip roles.manage from your own role',
              },
              { status: 400 },
            );
          }
        }
        return Response.json(
          {
            success: false,
            code: 'SELF_LOCKOUT_REFUSED',
            message: 'Cannot mutate your own role',
          },
          { status: 400 },
        );
      }
    }

    try {
      if (reset) {
        const targetResult = await pool.query<{ name: string }>(
          `SELECT name FROM roles WHERE id = $1`,
          [roleId],
        );
        if (targetResult.rows.length === 0) {
          return Response.json(
            { success: false, code: 'NOT_FOUND', message: 'Role not found' },
            { status: 404 },
          );
        }
        await resetRoleOverrides(pool, targetResult.rows[0].name);
      } else {
        await updateRole(pool, roleId, { name, rank, permissions });
      }
      return Response.json({ success: true });
    } catch (err) {
      if (err instanceof Error) {
        return Response.json(
          { success: false, code: 'UPDATE_FAILED', message: err.message },
          { status: 400 },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: Params): Promise<Response> {
  try {
    // Permission guard: roles.manage required.
    let session;
    try {
      session = await requirePermission(req.headers, 'roles.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const { id: roleId } = await params;
    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');

    // Self-lockout guard: refuse deletion of the acting session's own role.
    const sessionRoleName = await resolveSessionRoleName(pool, session.userId);
    if (sessionRoleName) {
      const targetResult = await pool.query<{ name: string }>(
        `SELECT name FROM roles WHERE id = $1`,
        [roleId],
      );
      if (targetResult.rows.length > 0 && targetResult.rows[0].name === sessionRoleName) {
        return Response.json(
          {
            success: false,
            code: 'SELF_LOCKOUT_REFUSED',
            message: 'Cannot delete your own role',
          },
          { status: 400 },
        );
      }
    }

    try {
      await deleteRole(pool, roleId);
      return Response.json({ success: true });
    } catch (err) {
      if (err instanceof Error) {
        return Response.json(
          { success: false, code: 'DELETE_FAILED', message: err.message },
          { status: 400 },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
