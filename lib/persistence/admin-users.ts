/**
 * Admin user management queries. Joins user, user_roles, and roles to
 * provide the user list, role assignment, and ban state. The ban columns
 * are app-owned on the user table (not the better-auth admin plugin).
 *
 * ID-space contract: user_roles.user_id stores raw better-auth IDs.
 * Owner references in stage_meta use the prefixed form user:<raw-id>.
 * This module works in the raw ID space.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

/** Shape returned by listUsers. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: string | null;
  rank: number;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
}

/**
 * Returns users with email, verified, role, rank, banned, and created.
 * Joins user, user_roles, and roles. Never returns password data.
 *
 * Supports optional search (matches email or name) and role filter.
 */
export async function listUsers(
  queryable: Queryable,
  filter?: { query?: string; roleName?: string; banned?: boolean },
): Promise<AdminUser[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filter?.query) {
    conditions.push(`(u.email ILIKE $${paramIdx} OR u.name ILIKE $${paramIdx})`);
    params.push(`%${filter.query}%`);
    paramIdx++;
  }
  if (filter?.roleName) {
    conditions.push(`r.name = $${paramIdx}`);
    params.push(filter.roleName);
    paramIdx++;
  }
  if (filter?.banned !== undefined) {
    conditions.push(`u."banned" = $${paramIdx}`);
    params.push(filter.banned);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await queryable.query<{
    id: string;
    email: string;
    name: string;
    email_verified: boolean;
    role_id: string | null;
    role_name: string | null;
    role_rank: number;
    banned: boolean;
    ban_reason: string | null;
    created_at: string | Date;
  }>(
    `SELECT u.id, u.email, u.name, u."emailVerified" as email_verified,
            r.id as role_id, r.name as role_name, r.rank as role_rank,
            u."banned", u."banReason" as ban_reason,
            u."createdAt" as created_at
       FROM "user" u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
      ${whereClause}
      ORDER BY u."createdAt" DESC`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.email_verified,
    role: row.role_name,
    rank: row.role_rank,
    banned: row.banned,
    banReason: row.ban_reason,
    createdAt: new Date(row.created_at),
  }));
}

/**
 * Upserts the single user_roles row for a user. One role per user
 * (user_roles.user_id is the primary key).
 *
 * The grantedBy parameter is the raw better-auth ID of the admin.
 */
export async function setUserRole(
  queryable: Queryable,
  userId: string,
  roleId: string,
  grantedBy: string,
): Promise<void> {
  // Self-demote refusal: mirror the self-ban refusal pattern.
  // An administrator cannot change their own role assignment.
  if (grantedBy === userId) {
    throw new Error('Cannot change your own role assignment');
  }

  await queryable.query(
    `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, granted_by = EXCLUDED.granted_by`,
    [userId, roleId, grantedBy],
  );
}

/**
 * Writes the ban columns and revokes every session for the user.
 * Self-ban is refused: if the caller's userId matches the target, throw.
 */
export async function setUserBanned(
  queryable: Queryable,
  userId: string,
  banned: boolean,
  reason?: string,
  callerUserId?: string,
): Promise<void> {
  if (banned && callerUserId && callerUserId === userId) {
    throw new Error('Cannot ban your own session');
  }

  await queryable.query(
    `UPDATE "user" SET "banned" = $1, "banReason" = $2, "updatedAt" = now() WHERE id = $3`,
    [String(banned), reason ?? null, userId],
  );

  // Revoke every session for the user when banning.
  if (banned) {
    await queryable.query(`DELETE FROM session WHERE "userId" = $1`, [userId]);
  }
}
