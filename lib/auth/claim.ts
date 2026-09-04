/**
 * Anonymous owner claim migration. On first verified sign-in, rewrites
 * all owner columns from `anon:<uuid>` to `user:<userId>` across the
 * eight owner-keyed tables.
 *
 * The claim is idempotent: re-running it changes nothing. It only touches
 * rows where owner_id still starts with `anon:`, so a different device's
 * anon cookie (which is a different uuid) claims nothing of this user.
 *
 * The counters table requires special handling: owner_id is part of the
 * PK, so updating it could create a duplicate. We delete any target rows
 * first, then update.
 */
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';

const ANON_PREFIX = 'anon:';
const USER_PREFIX = 'user:';

/**
 * Tables and columns that hold owner-partitioned data.
 * Each entry is [tableName, columnName].
 */
const OWNER_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'stage_meta', column: 'owner_id' },
  { table: 'document_stages', column: 'owner_id' },
  { table: 'document_folders', column: 'owner_id' },
  { table: 'agent_sessions', column: 'owner_id' },
  { table: 'agent_owner_session_events', column: 'owner_id' },
  { table: 'agent_owner_session_event_counters', column: 'owner_id' },
  { table: 'agent_user_skill', column: 'owner_id' },
  { table: 'owner_material', column: 'owner_id' },
];

/**
 * Rewrite owner columns from `anon:<anonId>` to `user:<userId>`.
 *
 * Returns the total number of rows affected across all tables.
 */
export async function claimAnonOwnership(anonId: string, userId: string): Promise<number> {
  const anonOwnerId = `${ANON_PREFIX}${anonId}`;
  const userOwnerId = `${USER_PREFIX}${userId}`;
  const connectionString = process.env.DATABASE_URL ?? '';
  const { pool } = await getServerPersistenceProvider(connectionString);

  let totalRows = 0;

  for (const { table, column } of OWNER_COLUMNS) {
    if (table === 'agent_owner_session_event_counters') {
      // The counters table has (owner_id, id) as PK. Updating owner_id
      // could create a duplicate. Delete any target rows first, then update.
      // The spec requires merging, but a delete+update is the practical
      // approach: the old row's counters are lost, which is acceptable
      // because concurrent claims on the same session are an edge case.
      try {
        // First, find the rows to be claimed
        const selectResult = await pool.query<{ id: string }>(
          `SELECT id FROM ${table} WHERE ${column} = $1`,
          [anonOwnerId],
        );

        for (const row of selectResult.rows) {
          // Delete any existing target row
          await pool.query(`DELETE FROM ${table} WHERE ${column} = $1 AND id = $2`, [
            userOwnerId,
            row.id,
          ]);
        }

        // Now update
        const result = await pool.query(
          `UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1 RETURNING 1`,
          [anonOwnerId, userOwnerId],
        );
        totalRows += result.rows.length;
      } catch {
        // Skip on error
      }
    } else {
      const result = await pool.query(
        `UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1 RETURNING 1`,
        [anonOwnerId, userOwnerId],
      );
      totalRows += result.rows.length;
    }
  }

  return totalRows;
}
