import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/lib/auth/index';
import { resolvePermissionSet } from '@/lib/auth/permissions-server';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

/**
 * GET /api/auth/permissions
 *
 * Returns the resolved permission list for the session.
 * Defaults-deny: anonymous clients receive an empty list.
 * The ACCESS_CODE curtain still applies at middleware level.
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await getSession(_req.headers);

  if (!session) {
    return NextResponse.json({ permissions: [] });
  }

  const connectionString = process.env.DATABASE_URL ?? '';
  const { pool } = await getServerPersistenceProvider(connectionString);

  // Resolve the user's full role row from the database.
  const result = await pool.query<{
    id: string;
    name: string;
    rank: number;
    is_system: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT r.id, r.name, r.rank, r."isSystem" as is_system, r."createdAt" as created_at, r."updatedAt" as updated_at FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
    [session.userId],
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ permissions: [] });
  }

  const row = result.rows[0];
  const role = {
    id: row.id,
    name: row.name,
    rank: row.rank,
    isSystem: row.is_system,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  const permissions = await resolvePermissionSet(pool, role);

  return NextResponse.json({ permissions: [...permissions] });
}
