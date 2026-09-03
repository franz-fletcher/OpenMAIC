#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Live completion gate for the ENGE503 stage-generation build.
 *
 * Reads DATABASE_URL from the environment at the CLI boundary only.
 * Counts scenes per stage for the pinned folder, compares against
 * the inventory (Stage 1 = 8, Stages 2-7 = 7 each, total 50),
 * and scans agent_session_events for the abort-fragment text.
 *
 * Modes:
 *   --session <id>   Scan abort rows for that specific session at/after
 *                    its first lifecycle event (session_start).
 *   (no --session)   Derive the most recent session from agent_session_events
 *                    (max first-event ts across all sessions), then scan
 *                    abort rows for that session at/after its marker.
 *
 * Exported functions are pure or take a db-access callback so the
 * integration test can exercise the logic without a live database.
 *
 * Exit codes:
 *   0 - pass (or --expect-incomplete with mismatch)
 *   1 - fail (or --expect-incomplete with full match)
 *   2 - missing DATABASE_URL
 */

'use strict';

// ---------------------------------------------------------------------------
// Pinned inventory
// ---------------------------------------------------------------------------

/** Per-stage pinned count from the approved plan tables. */
const PINNED_INVENTORY = [
  { stage: 1, count: 8, label: 'Stage 1' },
  { stage: 2, count: 7, label: 'Stage 2' },
  { stage: 3, count: 7, label: 'Stage 3' },
  { stage: 4, count: 7, label: 'Stage 4' },
  { stage: 5, count: 7, label: 'Stage 5' },
  { stage: 6, count: 7, label: 'Stage 6' },
  { stage: 7, count: 7, label: 'Stage 7' },
];

/** The ENGE503 folder id. */
const FOLDER_ID = 'folder-sEcSTrX-mp';

/** Stable text fragment that marks a budget abort at any ms value. */
const ABORT_FRAGMENT = 'execution budget and was aborted';

// ---------------------------------------------------------------------------
// Database query helpers
// ---------------------------------------------------------------------------

/**
 * Query stages and scene counts for the pinned folder.
 * Stage rows must have an id starting with 'stage-' and live in FOLDER_ID.
 * Only Stages 1 through 7 are relevant; others are ignored.
 *
 * @param {object} client - A pg-compatible client with query().
 * @returns {Promise<Array<{stage: number, label: string, sceneCount: number}>>}
 */
async function queryStageSummaries(client) {
  const result = await client.query(
    `SELECT
       ds.id,
       ds.name,
       COUNT(dsc.id)::int AS "sceneCount"
     FROM document_stages ds
     LEFT JOIN document_scenes dsc ON dsc.stage_id = ds.id
     WHERE ds.folder_id = $1
       AND ds.id LIKE 'stage-%'
     GROUP BY ds.id, ds.name
     ORDER BY ds.id`,
    [FOLDER_ID],
  );

  return result.rows.map((row) => {
    const match = row.name.match(/^Stage\s+(\d+)/i);
    const stageNum = match ? parseInt(match[1], 10) : 0;
    return {
      stage: stageNum,
      label: row.name,
      sceneCount: row.sceneCount,
    };
  });
}

/**
 * Derive the most recent session from agent_session_events.
 * "Most recent" means the session whose first lifecycle event (session_start)
 * has the highest ts across all sessions.
 *
 * @param {object} client - A pg-compatible client with query().
 * @returns {Promise<{sessionId: string, marker: number} | null>}
 */
async function deriveMostRecentSession(client) {
  const result = await client.query(
    `SELECT session_id, MIN(ts) AS marker
     FROM agent_session_events
     WHERE type = 'session_start'
     GROUP BY session_id
     ORDER BY marker DESC
     LIMIT 1`,
  );
  if (result.rows.length === 0 || result.rows[0].marker === null) {
    return null;
  }
  return {
    sessionId: result.rows[0].session_id,
    marker: Number(result.rows[0].marker),
  };
}

/**
 * Derive the marker for a specific session from its first lifecycle event.
 *
 * @param {object} client - A pg-compatible client with query().
 * @param {string} sessionId
 * @returns {Promise<number>}
 */
async function deriveSessionMarker(client, sessionId) {
  const result = await client.query(
    `SELECT MIN(ts) AS marker
     FROM agent_session_events
     WHERE session_id = $1
       AND type = 'session_start'`,
    [sessionId],
  );
  if (result.rows.length > 0 && result.rows[0].marker !== null) {
    return Number(result.rows[0].marker);
  }
  return 0;
}

/**
 * Scan agent_session_events for the abort-fragment text.
 *
 * Returns true when at least one row matching the session (when provided)
 * has ts >= marker and data::text contains the fragment.
 *
 * @param {object} client - A pg-compatible client with query().
 * @param {object} opts
 * @param {string} [opts.sessionId] - When present, filter by this session.
 * @param {number} opts.marker - ts of the first lifecycle event of the session.
 * @returns {Promise<boolean>}
 */
async function scanAbortFragmentDb(client, { sessionId, marker }) {
  let query;
  const params = [marker];

  if (sessionId) {
    query = `SELECT 1 FROM agent_session_events
             WHERE session_id = $1
               AND ts >= $2
               AND data::text LIKE '%${ABORT_FRAGMENT}%'
             LIMIT 1`;
    params.unshift(sessionId);
  } else {
    query = `SELECT 1 FROM agent_session_events
             WHERE ts >= $1
               AND data::text LIKE '%${ABORT_FRAGMENT}%'
             LIMIT 1`;
  }

  const result = await client.query(query, params);
  return result.rows.length > 0;
}

// ---------------------------------------------------------------------------
// Pure logic (no database access)
// ---------------------------------------------------------------------------

/**
 * Build per-stage diff lines from the actual stage summaries.
 *
 * @param {Array<{stage: number, label: string, sceneCount: number}>} stages
 * @returns {string[]}
 */
function buildDiffLines(stages) {
  const lines = [];
  for (const pin of PINNED_INVENTORY) {
    const actual = stages.find((s) => s.stage === pin.stage);
    const count = actual ? actual.sceneCount : 0;
    const marker = count === pin.count ? 'ok' : 'MISMATCH';
    lines.push(`  ${pin.label}: ${count}/${pin.count} ${marker}`);
  }
  return lines;
}

/**
 * Scan event rows for the abort-fragment text.
 * Rows before the marker are skipped.
 *
 * @param {Array<{session_id: string, ts: number, type: string, data: string}>} rows
 * @param {number} marker - ts of the first lifecycle event.
 * @returns {boolean}
 */
function scanAbortFragment(rows, marker) {
  for (const row of rows) {
    if (row.ts >= marker && row.data.includes(ABORT_FRAGMENT)) {
      return true;
    }
  }
  return false;
}

/**
 * Core completion check. Returns pass/fail and diff lines.
 *
 * @param {Array<{stage: number, label: string, sceneCount: number}>} stages
 * @param {Array<{session_id: string, ts: number, type: string, data: string}>} eventRows
 * @param {number} [marker=0]
 * @returns {{pass: boolean, diffLines: string[], abortFound: boolean}}
 */
function checkStageCompletion(stages, eventRows, marker = 0) {
  const diffLines = buildDiffLines(stages);
  const allMatch = diffLines.every((l) => l.includes('ok'));
  const abortFound = scanAbortFragment(eventRows, marker);
  return {
    pass: allMatch && !abortFound,
    diffLines,
    abortFound,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Main entry point. Accepts argv and an optional db-access override for testing.
 *
 * When override is provided (test mode), skip the pg pool entirely.
 * When override is null (CLI mode), read DATABASE_URL from env, connect via pg.
 *
 * @param {string[]} argv
 * @param {{stages: Array, events: Array, marker?: number, session?: string}} [override]
 */
async function main(argv, override) {
  // Parse arguments.
  let sessionId = null;
  let expectIncomplete = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--session' && i + 1 < argv.length) {
      sessionId = argv[i + 1];
      i++;
    } else if (argv[i] === '--expect-incomplete') {
      expectIncomplete = true;
    }
  }

  let stages, eventRows, marker, mode;

  if (override) {
    // Test mode: use injected fixtures.
    stages = override.stages || [];
    eventRows = override.events || [];
    marker = override.marker || 0;
    mode = override.session
      ? `session=${override.session} marker=${marker}`
      : `most-recent-session marker=${marker}`;
  } else {
    // CLI mode: read DATABASE_URL and connect.
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.error('ERROR: DATABASE_URL environment variable is not set.');
      process.exit(2);
    }

    const pg = require('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const client = await pool.connect();

    try {
      stages = await queryStageSummaries(client);

      if (sessionId) {
        // Explicit --session: derive marker from that session.
        marker = await deriveSessionMarker(client, sessionId);
        mode = `session=${sessionId} marker=${marker}`;
      } else {
        // No --session: derive the most recent session.
        const recent = await deriveMostRecentSession(client);
        if (recent) {
          sessionId = recent.sessionId;
          marker = recent.marker;
          mode = `most-recent-session=${sessionId} marker=${marker}`;
        } else {
          marker = 0;
          mode = 'no-sessions-found marker=0';
        }
      }

      // Scan abort fragments for the resolved session.
      const abortFound = await scanAbortFragmentDb(client, {
        sessionId: sessionId || undefined,
        marker,
      });

      if (abortFound) {
        eventRows = [
          {
            session_id: sessionId || '',
            ts: marker,
            type: 'abort_scan',
            data: `{"found": true, "fragment": "${ABORT_FRAGMENT}"}`,
          },
        ];
      } else {
        eventRows = [];
      }
    } finally {
      client.release();
      await pool.end();
    }
  }

  // Compute result.
  const result = checkStageCompletion(stages, eventRows, marker);

  // Print output.
  const total = stages.reduce((s, r) => s + r.sceneCount, 0);
  const pinTotal = PINNED_INVENTORY.reduce((s, e) => s + e.count, 0);

  console.log(`mode: ${mode}`);
  if (result.pass) {
    console.log('COMPLETION_GATE_PASS');
    console.log(`All ${PINNED_INVENTORY.length} stages match the pinned inventory.`);
    console.log(`Total scenes: ${total} (pinned: ${pinTotal})`);
  } else {
    console.log('COMPLETION_GATE_FAIL');
    if (result.diffLines.length > 0) {
      console.log('Per-stage diff:');
      for (const line of result.diffLines) {
        console.log(line);
      }
      console.log(`Total scenes: ${total} (pinned: ${pinTotal}, diff: ${total - pinTotal})`);
    }
    if (result.abortFound) {
      console.log(
        'ABORT DETECTED: agent_session_events contains the abort-fragment text after the marker.',
      );
    }
  }

  // Exit code: --expect-incomplete inverts the outcome.
  const exitCode = expectIncomplete ? (result.pass ? 1 : 0) : result.pass ? 0 : 1;
  process.exit(exitCode);
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
  main,
  scanAbortFragment,
  buildDiffLines,
  checkStageCompletion,
  PINNED_INVENTORY,
  FOLDER_ID,
  ABORT_FRAGMENT,
  queryStageSummaries,
  scanAbortFragmentDb,
  deriveMostRecentSession,
  deriveSessionMarker,
};
