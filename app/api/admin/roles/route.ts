/**
 * Admin role management routes. Gated by roles.manage.
 *
 * GET: returns the role list with defaults and overrides.
 * POST: creates a custom role with initial permissions.
 *
 * The guard call is wrapped in the nested Response-rethrow catch so the
 * typed 403 survives both outer catch layers (the route catch and the
 * withRequestOwnerId callback catch).
 */
import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { listRolesWithPermissions, createRole } from '@/lib/persistence/admin-roles';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

export async function GET(req: NextRequest): Promise<Response> {
  try {
    // Permission guard: roles.manage required.
    let session;
    try {
      session = await requirePermission(req.headers, 'roles.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const roles = await listRolesWithPermissions(pool);

    // Serialize overrides Map to a plain object for JSON.
    const serialized = roles.map((role) => ({
      id: role.id,
      name: role.name,
      rank: role.rank,
      isSystem: role.isSystem,
      defaults: role.defaults,
      overrides: Object.fromEntries(role.overrides),
      effective: role.effective,
    }));

    return Response.json({ success: true, roles: serialized });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    // Permission guard: roles.manage required.
    let session;
    try {
      session = await requirePermission(req.headers, 'roles.manage');
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = (await req.json()) as Record<string, unknown>;
    const { name, rank, permissions } = body as {
      name?: string;
      rank?: number;
      permissions?: Array<{ permission: string; granted: boolean }>;
    };

    if (!name || rank === undefined) {
      return Response.json(
        { success: false, code: 'MISSING_FIELDS', message: 'name and rank required' },
        { status: 400 },
      );
    }

    const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    try {
      const role = await createRole(pool, {
        name,
        rank,
        permissions: permissions ?? [],
      });
      return Response.json({ success: true, role });
    } catch (err) {
      if (err instanceof Error) {
        return Response.json(
          { success: false, code: 'CREATE_FAILED', message: err.message },
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
