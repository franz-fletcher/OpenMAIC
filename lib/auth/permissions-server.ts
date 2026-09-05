/**
 * Server-only permission resolver and guard. Merges database
 * role_permissions overrides over rank-derived defaults. Per-request cache
 * only, never global.
 *
 * This module must never be imported by client components. It depends on
 * server-only APIs and database access.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { can, defaultPermissionsForRank, type Permission } from '@/lib/auth/permissions';
import { getSession, type Session } from '@/lib/auth/index';
import type { Role } from '@/lib/auth/roles';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

/** Immutable permission set returned by the resolver. */
export type PermissionSet = ReadonlySet<Permission>;

/** Per-request cache: keyed by (queryable, role.name). Never global. */
const requestCache = new WeakMap<object, Map<string, PermissionSet>>();

/**
 * Returns the session or throws a typed 403 refusal.
 *
 * Resolves the user's role rank from the database and checks the requested
 * permission against rank defaults via can(). Throws a Response with shape
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

  // Resolve the user's role rank from the database.
  const connectionString = process.env.DATABASE_URL ?? '';
  const { pool } = await getServerPersistenceProvider(connectionString);
  const result = await pool.query<{ rank: number }>(
    `SELECT r.rank FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
    [session.userId],
  );
  const rank = result.rows.length > 0 ? result.rows[0].rank : 0;

  const principal = { rank };
  if (!can(principal, permission)) {
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
  // eslint-disable-next-line no-restricted-globals -- runtime env access for server-only flag
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
 * - Cached per request (WeakMap keyed on queryable). Same queryable + role
 *   returns the same set within one request lifecycle.
 */
export async function resolvePermissionSet(
  queryable: Queryable,
  role: Role,
): Promise<PermissionSet> {
  // Per-request cache lookup.
  let roleMap = requestCache.get(queryable);
  if (!roleMap) {
    roleMap = new Map();
    requestCache.set(queryable, roleMap);
  }
  const cached = roleMap.get(role.name);
  if (cached) return cached;

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
  const frozen: PermissionSet = Object.freeze(new Set(allowed)) as PermissionSet;
  roleMap.set(role.name, frozen);
  return frozen;
}
