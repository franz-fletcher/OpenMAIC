/**
 * Role model and rank constants. Anonymous rank 0 is virtual with no
 * database row. System roles ranks 1 through 4 are seeded as rows.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

export const ROLE_RANKS = {
  ANONYMOUS: 0,
  GUEST: 1,
  LEARNER: 2,
  CREATOR: 3,
  ADMIN: 4,
} as const;

/** A single email-to-role grant from env or yaml. */
export interface RoleGrantSeed {
  email: string;
  role: string;
}

/** Role row shape returned by listRoles. */
export interface Role {
  id: string;
  name: string;
  rank: number;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SYSTEM_ROLES = [
  { name: 'guest', rank: ROLE_RANKS.GUEST },
  { name: 'learner', rank: ROLE_RANKS.LEARNER },
  { name: 'creator', rank: ROLE_RANKS.CREATOR },
  { name: 'admin', rank: ROLE_RANKS.ADMIN },
];

/**
 * Seeds the four system roles and any configured email grants.
 *
 * Idempotent and non-destructive. The database owns truth after the
 * first seed. Returns the number of grants applied.
 */
export async function seedRoleGrants(
  queryable: Queryable,
  grants: RoleGrantSeed[],
): Promise<number> {
  // Upsert system roles (idempotent).
  for (const role of SYSTEM_ROLES) {
    await queryable.query(
      `INSERT INTO roles (id, name, rank, "isSystem")
       VALUES ($1, $2, $3, true)
       ON CONFLICT (name) DO UPDATE SET rank = EXCLUDED.rank`,
      [role.name, role.name, role.rank],
    );
  }

  // For each configured email grant, upsert the user_roles row.
  // The user must already exist (created by better-auth signup).
  // This seed runs after bootstrap, so newly signed-up users
  // get their grant on the next seed run or immediately if already
  // present.
  let applied = 0;
  for (const grant of grants) {
    const normalizedEmail = grant.email.trim().toLowerCase();
    if (!normalizedEmail) continue;

    // Look up the user by email.
    const userResult = await queryable.query<{ id: string }>(
      `SELECT id FROM "user" WHERE email = $1`,
      [normalizedEmail],
    );
    if (userResult.rows.length === 0) continue;

    const userId = userResult.rows[0].id;

    // Look up the role by name.
    const roleResult = await queryable.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = $1`,
      [grant.role],
    );
    if (roleResult.rows.length === 0) continue;

    const roleId = roleResult.rows[0].id;

    // Upsert user_roles (non-destructive: only sets if not present
    // or updates the role if the grant changes).
    await queryable.query(
      `INSERT INTO user_roles (user_id, role_id, granted_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId, roleId],
    );
    applied++;
  }

  return applied;
}

/**
 * Returns all roles ordered by rank ascending.
 */
export async function listRoles(queryable: Queryable): Promise<Role[]> {
  const result = await queryable.query<{
    id: string;
    name: string;
    rank: number;
    is_system: boolean;
    created_at: string | Date;
    updated_at: string | Date;
  }>(
    `SELECT id, name, rank, "isSystem" as is_system, "createdAt" as created_at, "updatedAt" as updated_at
       FROM roles
      ORDER BY rank ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    rank: row.rank,
    isSystem: row.is_system,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}
