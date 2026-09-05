/**
 * Audience rank constants and viewer-rank resolver.
 *
 * Rank values are integers that map to role tiers. The gate compares
 * `viewerRank >= audience` so a rank rename in the roles table never
 * touches course rows.
 *
 * Anonymous rank 0 is virtual with no database row. System roles ranks
 * 1 through 4 are seeded as rows.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

/** Frozen audience rank constants shared by the picker and the gate. */
export const AUDIENCE_RANK = {
  EVERYONE: 0,
  GUEST: 1,
  LEARNER: 2,
} as const;

/**
 * Resolve the effective viewer rank for a given owner id.
 *
 * Returns `0` for `anon:` owners and unknown users. Returns the role rank
 * join for `user:` owners. The rank comes from the same database query that
 * `requirePermission` uses, so the value is consistent across the stack.
 */
export async function resolveViewerRank(queryable: Queryable, ownerId: string): Promise<number> {
  if (ownerId.startsWith('anon:')) {
    return 0;
  }

  const result = await queryable.query<{ rank: number }>(
    `SELECT r.rank FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
    [ownerId],
  );

  return result.rows.length > 0 ? result.rows[0].rank : 0;
}
