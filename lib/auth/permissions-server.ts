/**
 * Server-only permission resolver and guard. Merges database
 * role_permissions overrides over rank-derived defaults. Fresh merge on
 * every call; no caching.
 *
 * This module must never be imported by client components. It depends on
 * server-only APIs and database access.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { defaultPermissionsForRank, type Permission } from '@/lib/auth/permissions';
import { getSession, type Session } from '@/lib/auth/index';
import type { Role } from '@/lib/auth/roles';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

/** Immutable permission set returned by the resolver. */
export type PermissionSet = ReadonlySet<Permission>;

/**
 * Returns the session or throws a typed 403 refusal.
 *
 * Resolves the user's full role row from the database and checks the
 * requested permission against the merged set from resolvePermissionSet
 * (rank defaults plus database overrides). Throws a Response with shape
 * { message, code } when the session is missing or the permission is denied.
 */
export async function requirePermission(
  headers: Headers,
  permission: Permission,
): Promise<Session> {
  const session = await getSession(headers);
  if (!session) {
    throw new Response(
      JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }

  // Check if the user is banned before resolving rank. Wrap in try/catch
  // so databases without the ban columns degrade gracefully.
  const connectionString = process.env.DATABASE_URL ?? '';
  const { pool } = await getServerPersistenceProvider(connectionString);
  try {
    const banResult = await pool.query<{ banned: boolean }>(
      `SELECT "banned" FROM "user" WHERE id = $1`,
      [session.userId],
    );
    if (banResult.rows.length > 0 && banResult.rows[0].banned) {
      throw new Response(JSON.stringify({ message: 'account is banned', code: 'banned' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    // Column does not exist yet. Continue to rank resolution.
  }

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
    throw new Response(
      JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
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

  const merged = await resolvePermissionSet(pool, role);
  if (!merged.has(permission)) {
    throw new Response(
      JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }

  return session;
}

/**
 * Flag-gated guard wrapper. Returns immediately when MINIMAL_MODE is off.
 * When set, delegates to requirePermission which throws the typed 403
 * for anonymous and denied ranks.
 */
export async function requirePermissionIfMinimalMode(
  headers: Headers,
  permission: Permission,
): Promise<void> {
  // Use globalThis.process to survive Turbopack's compile-time env replacement.

  const runtimeProcess = globalThis.process as NodeJS.Process | undefined;
  const mode = runtimeProcess?.env?.MINIMAL_MODE;
  if (mode !== 'true' && mode !== '1') return;
  await requirePermission(headers, permission);
}

/**
 * Resolves the effective permission set for a role by merging rank defaults
 * with any database overrides from the role_permissions table.
 *
 * - granted=true adds the permission to the default set.
 * - granted=false removes the permission from the default set.
 * - Returns an immutable ReadonlySet.
 * - Fresh merge on every call. No caching.
 */
export async function resolvePermissionSet(
  queryable: Queryable,
  role: Role,
): Promise<PermissionSet> {
  // Start from rank-derived defaults.
  const allowed = new Set<Permission>(defaultPermissionsForRank(role.rank));

  // Apply database overrides for this role.
  const result = await queryable.query<{
    permission: string;
    granted: boolean;
  }>(`SELECT permission, granted FROM role_permissions WHERE role_name = $1`, [role.name]);

  for (const row of result.rows) {
    const perm = row.permission as Permission;
    if (row.granted) {
      allowed.add(perm);
    } else {
      allowed.delete(perm);
    }
  }

  // Freeze into an immutable set.
  return Object.freeze(new Set(allowed)) as PermissionSet;
}
