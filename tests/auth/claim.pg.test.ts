/**
 * Claim migration — PG contract.
 *
 * Proves the claim migration against a REAL PostgreSQL database.
 * Creates the necessary tables, runs the claim, and verifies the result.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

// Mock the persistence provider to use our test pool
const mocks = vi.hoisted(() => ({
  testPool: null as Pool | null,
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: mocks.testPool!,
  }),
}));

describe.skipIf(!contractUrl)('claim migration PG contract', () => {
  const CONTRACT_DB = `openmaic_claim_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });
    mocks.testPool = pool;

    // Create minimal table structures for the claim test
    await pool.query(`
      CREATE TABLE stage_meta (
        stage_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL
      );
      CREATE TABLE document_stages (
        id TEXT PRIMARY KEY,
        owner_id TEXT
      );
      CREATE TABLE document_folders (
        id TEXT,
        owner_id TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        PRIMARY KEY (owner_id, id),
        UNIQUE (owner_id, normalized_name)
      );
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        prompt TEXT,
        stage_id TEXT,
        skill_id TEXT,
        origin TEXT,
        existing_course TEXT,
        status TEXT,
        attempt INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE agent_owner_session_events (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seq BIGSERIAL,
        type TEXT NOT NULL,
        data JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE agent_owner_session_event_counters (
        id TEXT,
        owner_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        counter INTEGER DEFAULT 0,
        PRIMARY KEY (owner_id, id)
      );
      CREATE TABLE agent_user_skill (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE owner_material (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        kind TEXT,
        mime TEXT,
        bytes BYTEA,
        original_name TEXT,
        status TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
    `);

    // Insert test data under anon: ownership
    await pool.query(`
      INSERT INTO stage_meta (stage_id, owner_id) VALUES ('stage-1', 'anon:uuid-abc');
      INSERT INTO stage_meta (stage_id, owner_id) VALUES ('stage-2', 'anon:uuid-abc');
      INSERT INTO document_stages (id, owner_id) VALUES ('doc-1', 'anon:uuid-abc');
      INSERT INTO document_folders (id, owner_id, normalized_name) VALUES ('folder-1', 'anon:uuid-abc', 'My Folder');
      INSERT INTO agent_sessions (id, owner_id, prompt) VALUES ('session-1', 'anon:uuid-abc', 'test prompt');
      INSERT INTO agent_owner_session_events (id, owner_id, session_id, type, data) VALUES ('event-1', 'anon:uuid-abc', 'session-1', 'test', '{}');
      INSERT INTO agent_owner_session_event_counters (id, owner_id, session_id, counter) VALUES ('counter-1', 'anon:uuid-abc', 'session-1', 5);
      INSERT INTO agent_user_skill (id, owner_id, name) VALUES ('skill-1', 'anon:uuid-abc', 'test-skill');
      INSERT INTO owner_material (id, owner_id, kind, mime, status) VALUES ('mat-1', 'anon:uuid-abc', 'source', 'text/plain', 'ready');
    `);
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
  });

  it('claims all rows from anon: to user:', async () => {
    const { claimAnonOwnership } = await import('@/lib/auth/claim');

    const count = await claimAnonOwnership('uuid-abc', 'user-123');
    expect(count).toBeGreaterThan(0);

    // Verify no anon: rows remain in stage_meta
    const anonResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM stage_meta WHERE owner_id LIKE 'anon:%'`,
    );
    expect(anonResult.rows[0].cnt).toBe(0);

    // Verify user: rows exist in stage_meta
    const userResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM stage_meta WHERE owner_id = 'user:user-123'`,
    );
    expect(userResult.rows[0].cnt).toBe(2);
  });

  it('claim is idempotent', async () => {
    const { claimAnonOwnership } = await import('@/lib/auth/claim');

    // Second claim should change nothing
    const count = await claimAnonOwnership('uuid-abc', 'user-123');
    expect(count).toBe(0);
  });
});
