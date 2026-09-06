/**
 * Admin role management queries. Provides defaults-and-overrides introspection,
 * custom role create, update, reset, and guarded delete.
 *
 * The defaults are always defaultPermissionsForRank(rank). The overrides
 * come from role_permissions. Each catalog key shows default state,
 * effective state, and an override badge when a row exists.
 *
 * Role names stay unique. System roles keep immutable names and ranks.
 * Custom roles may share a seeded rank after the rank uniqueness
 * constraint drop in ensureAuthSchema.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import {
  defaultPermissionsForRank,
  PERMISSION_CATALOG,
  type Permission,
} from '@/lib/auth/permissions';

/** Permission grant shape for create and update operations. */
export interface PermissionGrant {
  permission: string;
  granted: boolean;
}

/** Role row shape returned by the module. */
export interface Role {
  id: string;
  name: string;
  rank: number;
  isSystem: boolean;
}

/** Role with defaults and overrides merged per the spec shape. */
export interface AdminRoleWithPermissions {
  id: string;
  name: string;
  rank: number;
  isSystem: boolean;
  /** Rank-derived default permissions. */
  defaults: Permission[];
  /** Map of permission overrides from role_permissions table. */
  overrides: Map<Permission, boolean>;
  /** Effective permission set after merging defaults with overrides. */
  effective: Permission[];
}

/** System-reserved role names that cannot be created or deleted. */
const SYSTEM_NAMES = new Set(['guest', 'learner', 'creator', 'admin']);

/**
 * Lists every role with rank, system flag, the rank-derived default set,
 * and the role_permissions override map per role.
 */
export async function listRolesWithPermissions(
  queryable: Queryable,
): Promise<AdminRoleWithPermissions[]> {
  // Fetch all roles ordered by rank ascending.
  const rolesResult = await queryable.query<{
    id: string;
    name: string;
    rank: number;
    is_system: boolean;
  }>(
    `SELECT id, name, rank, "isSystem" as is_system
       FROM roles
      ORDER BY rank ASC, name ASC`,
  );

  const roles = rolesResult.rows;

  // Fetch all overrides in one query.
  const overridesResult = await queryable.query<{
    role_name: string;
    permission: string;
    granted: boolean;
  }>(`SELECT role_name, permission, granted FROM role_permissions`);

  // Group overrides by role name.
  const overridesByRole = new Map<string, Map<Permission, boolean>>();
  for (const row of overridesResult.rows) {
    let map = overridesByRole.get(row.role_name);
    if (!map) {
      map = new Map();
      overridesByRole.set(row.role_name, map);
    }
    map.set(row.permission as Permission, row.granted);
  }

  // Merge defaults with overrides for each role.
  return roles.map((role) => {
    const defaults = defaultPermissionsForRank(role.rank);
    const overrides = overridesByRole.get(role.name) ?? new Map<Permission, boolean>();

    // Build effective set: start from defaults, apply overrides.
    const effective = new Set<Permission>(defaults);
    for (const [perm, granted] of overrides) {
      if (granted) {
        effective.add(perm);
      } else {
        effective.delete(perm);
      }
    }

    return {
      id: role.id,
      name: role.name,
      rank: role.rank,
      isSystem: role.is_system,
      defaults,
      overrides,
      effective: [...effective],
    };
  });
}

/**
 * Inserts a custom role and its initial overrides.
 * Refuses system-reserved names.
 */
export async function createRole(
  queryable: Queryable,
  input: { name: string; rank: number; permissions: PermissionGrant[] },
): Promise<Role> {
  if (SYSTEM_NAMES.has(input.name)) {
    throw new Error(`Cannot create role with system-reserved name: ${input.name}`);
  }

  // Insert the role row.
  const result = await queryable.query<{
    id: string;
    name: string;
    rank: number;
    is_system: boolean;
  }>(
    `INSERT INTO roles (id, name, rank, "isSystem")
     VALUES (gen_random_uuid()::text, $1, $2, false)
     RETURNING id, name, rank, "isSystem" as is_system`,
    [input.name, input.rank],
  );

  const role = result.rows[0];

  // Insert initial overrides.
  for (const grant of input.permissions) {
    await queryable.query(
      `INSERT INTO role_permissions (role_name, permission, granted)
       VALUES ($1, $2, $3)`,
      [role.name, grant.permission, grant.granted],
    );
  }

  return {
    id: role.id,
    name: role.name,
    rank: role.rank,
    isSystem: role.is_system,
  };
}

/**
 * Renames through role_permissions.role_name in one transaction,
 * changes rank, and replaces the override set.
 */
export async function updateRole(
  queryable: Queryable,
  roleId: string,
  input: { name?: string; rank?: number; permissions?: PermissionGrant[] },
): Promise<void> {
  // Fetch current role to get the name for role_permissions updates.
  const currentResult = await queryable.query<{ name: string; is_system: boolean }>(
    `SELECT name, "isSystem" as is_system FROM roles WHERE id = $1`,
    [roleId],
  );

  if (currentResult.rows.length === 0) {
    throw new Error(`Role not found: ${roleId}`);
  }

  const currentName = currentResult.rows[0].name;
  const newName = input.name ?? currentName;

  // Rename the role if a new name is provided.
  if (input.name !== undefined && input.name !== currentName) {
    // Update role_permissions.role_name to reflect the new name.
    await queryable.query(`UPDATE role_permissions SET role_name = $1 WHERE role_name = $2`, [
      newName,
      currentName,
    ]);
  }

  // Update rank if provided.
  if (input.rank !== undefined) {
    await queryable.query(`UPDATE roles SET rank = $1, "updatedAt" = now() WHERE id = $2`, [
      input.rank,
      roleId,
    ]);
  }

  // Rename the role itself.
  if (input.name !== undefined) {
    await queryable.query(`UPDATE roles SET name = $1, "updatedAt" = now() WHERE id = $2`, [
      newName,
      roleId,
    ]);
  }

  // Replace override set if provided.
  if (input.permissions !== undefined) {
    // Delete existing overrides.
    await queryable.query(`DELETE FROM role_permissions WHERE role_name = $1`, [newName]);

    // Insert new overrides.
    for (const grant of input.permissions) {
      await queryable.query(
        `INSERT INTO role_permissions (role_name, permission, granted)
         VALUES ($1, $2, $3)`,
        [newName, grant.permission, grant.granted],
      );
    }
  }
}

/**
 * Deletes every role_permissions row for the role name.
 * Returns the role to pure rank defaults.
 */
export async function resetRoleOverrides(queryable: Queryable, roleName: string): Promise<void> {
  await queryable.query(`DELETE FROM role_permissions WHERE role_name = $1`, [roleName]);
}

/**
 * Deletes a custom role. Refuses system roles, roles with attached
 * user_roles rows, and roles that a pending invite references by name.
 * Cleans override rows for the deleted role.
 *
 * Pending invite predicate: unused_at IS NULL AND revoked_at IS NULL
 * AND expires_at > now().
 */
export async function deleteRole(queryable: Queryable, roleId: string): Promise<void> {
  // Check if the role exists and is a system role.
  const roleResult = await queryable.query<{ name: string; is_system: boolean }>(
    `SELECT name, "isSystem" as is_system FROM roles WHERE id = $1`,
    [roleId],
  );

  if (roleResult.rows.length === 0) {
    throw new Error(`Role not found: ${roleId}`);
  }

  const { name: roleName, is_system: isSystem } = roleResult.rows[0];

  if (isSystem) {
    throw new Error(`Cannot delete system role: ${roleName}`);
  }

  // Check for attached users.
  const usersResult = await queryable.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM user_roles WHERE role_id = $1`,
    [roleId],
  );

  if (Number(usersResult.rows[0].count) > 0) {
    throw new Error(`Cannot delete role with attached users: ${roleName}`);
  }

  // Check for pending invites referencing this role name.
  const invitesResult = await queryable.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM invites
     WHERE role_name = $1
       AND used_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()`,
    [roleName],
  );

  if (Number(invitesResult.rows[0].count) > 0) {
    throw new Error(`Cannot delete role with pending invites: ${roleName}`);
  }

  // Clean override rows.
  await queryable.query(`DELETE FROM role_permissions WHERE role_name = $1`, [roleName]);

  // Delete the role.
  await queryable.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
}
