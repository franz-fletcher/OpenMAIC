#!/usr/bin/env node
'use strict';

/**
 * Repair runbook for phantom compaction firstKeptEntryId values.
 *
 * Loads the durable entry tree for one session, finds compaction rows whose
 * firstKeptEntryId does not resolve in the branch prefix before that row,
 * recomputes the correct id via prepareCompaction from pi-agent-core, and
 * prints (or applies with --apply) the UPDATE statement.
 *
 * Database doctrine: DATABASE_URL is read from the process environment
 * only, never from .env.local. Without it the script prints
 * REPAIR_UNAVAILABLE and exits 2.
 *
 * Dry-run is the default. --apply additionally verifies the session has a
 * terminal status before executing the UPDATEs in one transaction.
 */

// ---------------------------------------------------------------------------
// Settings floor (inlined from lib/server/agent-runtime/compaction.ts
// resolveCompactionSettings to avoid a TS import from plain Node).
// Source of truth: resolveCompactionSettings in compaction.ts.
// ---------------------------------------------------------------------------

const DEFAULT_COMPACTION_SETTINGS = {
  reserveTokens: 16384,
  keepRecentTokens: 32000,
};

function resolveCompactionSettings(contextWindow) {
  const reserveTokens = Math.min(
    DEFAULT_COMPACTION_SETTINGS.reserveTokens,
    Math.max(2048, Math.floor(contextWindow * 0.2)),
  );
  const keepRecentTokens = Math.min(
    DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
    Math.max(2048, Math.floor(contextWindow * 0.25)),
  );
  return {
    enabled: true,
    reserveTokens,
    keepRecentTokens,
  };
}

// ---------------------------------------------------------------------------
// pi-agent-core dynamic import (ESM-only package, cached after first call)
// ---------------------------------------------------------------------------

let _piModule = null;

async function loadPi() {
  if (!_piModule) {
    _piModule = await import('@earendil-works/pi-agent-core');
  }
  return _piModule;
}

// ---------------------------------------------------------------------------
// Pure core: planRepairs (async, calls pi's prepareCompaction)
// ---------------------------------------------------------------------------

/**
 * Detect phantom compaction rows and plan UPDATE statements.
 *
 * A compaction row's firstKeptEntryId is phantom when it does not appear
 * in any earlier entry in the branch. For each phantom, pi's
 * prepareCompaction recomputes the correct kept id from the prefix.
 *
 * @param {Array<Record<string, unknown>>} branch - Durable branch entries
 *   ordered by seq. Each entry has at least { id, type } and compaction
 *   entries also have { firstKeptEntryId }.
 * @param {{ enabled: boolean, reserveTokens: number, keepRecentTokens: number }} settings
 * @returns {Promise<Array<{ entryId: string, oldId: string, newId: string, sql: string }>>}
 */
async function planRepairs(branch, settings) {
  const pi = await loadPi();
  const plans = [];
  const seenIds = new Set();

  for (const entry of branch) {
    if (entry.type !== 'compaction') {
      seenIds.add(entry.id);
      continue;
    }

    const firstKept = entry.firstKeptEntryId;
    if (firstKept && !seenIds.has(firstKept)) {
      // Phantom detected. Recompute from the branch prefix before this row.
      const prefix = branch.filter((e) => seenIds.has(e.id));
      const prep = pi.prepareCompaction(prefix, settings);
      let newId = firstKept;
      if (prep.ok && prep.value) {
        newId = prep.value.firstKeptEntryId;
      }
      const sql =
        `UPDATE agent_session_entries` +
        ` SET data = jsonb_set(data, '{firstKeptEntryId}', to_jsonb('${newId}'::text))` +
        ` WHERE session_id = $1 AND entry_id = '${entry.id}';`;
      plans.push({ entryId: entry.id, oldId: firstKept, newId, sql });
    }

    // Compaction entries are themselves part of the branch for subsequent
    // lookups. Add after processing so the row does not satisfy its own
    // firstKeptEntryId check.
    seenIds.add(entry.id);
  }

  return plans;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let sessionId = null;
  let apply = false;
  let databaseUrl = process.env.DATABASE_URL || null;
  let contextWindow = 128000;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--session' && i + 1 < argv.length) {
      sessionId = argv[i + 1];
      i++;
    } else if (argv[i] === '--apply') {
      apply = true;
    } else if (argv[i] === '--database-url' && i + 1 < argv.length) {
      databaseUrl = argv[i + 1];
      i++;
    } else if (argv[i] === '--context-window' && i + 1 < argv.length) {
      contextWindow = parseInt(argv[i + 1], 10);
      i++;
    }
  }

  return { sessionId, apply, databaseUrl, contextWindow };
}

// ---------------------------------------------------------------------------
// Database helpers (pg CJS require, matching check-stage-completion.js)
// ---------------------------------------------------------------------------

async function loadEntries(client, sessionId) {
  const result = await client.query(
    `SELECT entry_id, parent_id, type, data` +
      ` FROM agent_session_entries` +
      ` WHERE session_id = $1 ORDER BY seq`,
    [sessionId],
  );
  return result.rows.map((row) => ({
    id: row.entry_id,
    parentId: row.parent_id,
    type: row.type,
    ...row.data,
  }));
}

async function checkTerminalStatus(client, sessionId) {
  const result = await client.query(`SELECT status FROM agent_sessions WHERE id = $1`, [sessionId]);
  if (result.rows.length === 0) return false;
  return ['succeeded', 'failed', 'cancelled'].includes(result.rows[0].status);
}

async function applyPlans(client, sessionId, plans) {
  await client.query('BEGIN');
  try {
    for (const plan of plans) {
      const sql = plan.sql.replace('$1', `'${sessionId}'`);
      await client.query(sql);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * CLI entry point. Reads DATABASE_URL from the environment only.
 *
 * @param {string[]} argv
 * @returns {Promise<number>} Exit code.
 */
async function main(argv) {
  const args = parseArgs(argv);

  if (!args.databaseUrl) {
    console.log('REPAIR_UNAVAILABLE');
    return 2;
  }

  if (!args.sessionId) {
    console.error('ERROR: --session <uuid> is required.');
    return 1;
  }

  const pg = require('pg');
  const pool = new pg.Pool({ connectionString: args.databaseUrl });
  const client = await pool.connect();

  try {
    const branch = await loadEntries(client, args.sessionId);
    if (branch.length === 0) {
      console.log(`SESSION_EMPTY: no entries found for session ${args.sessionId}`);
      return 1;
    }

    const settings = resolveCompactionSettings(args.contextWindow);
    const plans = await planRepairs(branch, settings);

    if (plans.length === 0) {
      console.log('TREE_VALID');
      return 0;
    }

    for (const plan of plans) {
      console.log(
        `PLAN: entry_id=${plan.entryId}` +
          ` old_firstKeptEntryId=${plan.oldId}` +
          ` new_firstKeptEntryId=${plan.newId}`,
      );
      console.log(plan.sql);
    }

    if (!args.apply) {
      return 0;
    }

    const terminal = await checkTerminalStatus(client, args.sessionId);
    if (!terminal) {
      console.log('SESSION_NOT_TERMINAL');
      return 3;
    }

    await applyPlans(client, args.sessionId, plans);
    console.log(`REPAIR_APPLIED ${plans.length}`);

    const branchAfter = await loadEntries(client, args.sessionId);
    const settingsAfter = resolveCompactionSettings(args.contextWindow);
    const plansAfter = await planRepairs(branchAfter, settingsAfter);

    if (plansAfter.length === 0) {
      console.log('TREE_VALID');
      return 0;
    }
    console.log('TREE_STILL_BROKEN');
    return 4;
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

if (require.main === module) {
  main(process.argv).catch((err) => {
    console.error('FATAL:', err.message || err);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Exports for testing.
// ---------------------------------------------------------------------------

module.exports = {
  planRepairs,
  main,
  resolveCompactionSettings,
  loadPi,
};
