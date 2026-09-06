import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { decideDocumentAccess, parseDocumentAction } from '@/lib/persistence/document-access';
import { resolveViewerRank } from '@/lib/persistence/audience';
import { readStageMeta } from '@/lib/persistence/stage-meta';
import { resolveStageAccess } from '@/lib/server/stage-access';

const { Pool } = pg;

const PG_URL = process.env.PG_CONTRACT_URL;

describe.skipIf(!PG_URL)('publishing read gate (integration)', () => {
  let pool: pg.Pool;
  let scratchDbUrl: string;

  function databaseUrl(base: string, database: string): string {
    const url = new URL(base);
    url.pathname = `/${database}`;
    return url.toString();
  }

  beforeAll(async () => {
    if (!PG_URL) throw new Error('PG_CONTRACT_URL is required for integration tests');

    // Provision scratch DB to avoid interference from parallel test files.
    const admin = new Pool({ connectionString: PG_URL, max: 2 });
    const dbName = `openmaic_readgate_${process.pid}`;
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    scratchDbUrl = databaseUrl(PG_URL, dbName);
    pool = new Pool({ connectionString: scratchDbUrl, max: 4 });

    // Provision scratch DB.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        rank INTEGER NOT NULL UNIQUE,
        "isSystem" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id),
        granted_by TEXT,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS document_stages (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS stage_meta (
        stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        is_public BOOLEAN NOT NULL DEFAULT false,
        deleted_at TIMESTAMPTZ,
        published_at DOUBLE PRECISION,
        generation_complete BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'draft',
        audience INTEGER NOT NULL DEFAULT 3
      );

      CREATE INDEX IF NOT EXISTS stage_meta_owner_idx ON stage_meta (owner_id, stage_id);
      CREATE INDEX IF NOT EXISTS stage_meta_public_live_idx
        ON stage_meta (stage_id) WHERE is_public AND deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS stage_meta_published_audience_idx
        ON stage_meta (audience, published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;
    `);

    // Seed roles.
    await pool.query(`
      INSERT INTO roles (id, name, rank, "isSystem") VALUES
        ('role-anon', 'anon', 0, true),
        ('role-guest', 'guest', 1, true),
        ('role-learner', 'learner', 2, true),
        ('role-creator', 'creator', 3, true),
        ('role-admin', 'admin', 4, true)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Seed users and roles. Use plain IDs that resolveViewerRank will look up
    // after stripping the 'user:' prefix from the ownerId passed by withRequestOwnerId.
    // e.g. resolveViewerRank('user:guest') -> strips prefix -> queries for 'guest'.
    await pool.query(`
      INSERT INTO "user" (id, name, email) VALUES
        ('guest', 'guest', 'guest@test.example'),
        ('learner', 'learner', 'learner@test.example'),
        ('creator', 'creator', 'creator@test.example'),
        ('owner', 'owner', 'owner@test.example')
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES
        ('guest', 'role-guest'),
        ('learner', 'role-learner'),
        ('creator', 'role-creator'),
        ('owner', 'role-creator')
      ON CONFLICT (user_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await pool.end();
    const admin = new Pool({ connectionString: PG_URL, max: 2 });
    admin.on('error', () => {});
    try {
      await admin.query(`DROP DATABASE IF EXISTS openmaic_readgate_${process.pid} WITH (FORCE)`);
    } catch {
      // Silently ignore.
    }
    await admin.end();
  }, 60_000);

  it('enforces audience on the persistence document seam', async () => {
    const stageId = 'gate-pg-doc-' + Math.random().toString(36).slice(2);

    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name)
       VALUES ($1, 'owner', 'test-course')
       ON CONFLICT (id) DO NOTHING`,
      [stageId],
    );

    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at)
       VALUES ($1, 'owner', 'published', 1, true, $2, false, null)
       ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status`,
      [stageId, Date.now()],
    );

    const queryable = pool;
    const viewerRank = await resolveViewerRank(queryable, 'user:guest');
    const metaReader = (sid: string) => readStageMeta(queryable, sid);

    // Guest should be able to read the published guest course.
    const guestResult = await decideDocumentAccess(
      parseDocumentAction('GET', `http://x/documents/${stageId}`),
      'user:guest',
      metaReader,
      async () => true,
      metaReader,
      viewerRank,
    );
    expect(guestResult).toBe('allow');

    // Learner should also be able to read (rank 2 >= audience 1).
    const learnerRank = await resolveViewerRank(queryable, 'user:learner');
    const learnerResult = await decideDocumentAccess(
      parseDocumentAction('GET', `http://x/documents/${stageId}`),
      'user:learner',
      metaReader,
      async () => true,
      metaReader,
      learnerRank,
    );
    expect(learnerResult).toBe('allow');

    // Cleanup.
    await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
    await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
  });

  it('returns not-found for non-owner when rank is below audience', async () => {
    const stageId = 'gate-pg-rank-' + Math.random().toString(36).slice(2);

    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name)
       VALUES ($1, 'owner', 'test-course')
       ON CONFLICT (id) DO NOTHING`,
      [stageId],
    );

    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at)
       VALUES ($1, 'owner', 'published', 2, true, $2, false, null)
       ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status`,
      [stageId, Date.now()],
    );

    const queryable = pool;
    const metaReader = (sid: string) => readStageMeta(queryable, sid);

    // Guest (rank 1) should NOT read a learner-only course (audience 2).
    const guestResult = await decideDocumentAccess(
      parseDocumentAction('GET', `http://x/documents/${stageId}`),
      'user:guest',
      metaReader,
      async () => true,
      metaReader,
      1,
    );
    expect(guestResult).toBe('not-found');

    // Cleanup.
    await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
    await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
  });

  it('stage-meta route enforces audience via resolveStageAccess', async () => {
    const stageId = 'gate-pg-meta-' + Math.random().toString(36).slice(2);

    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name)
       VALUES ($1, 'owner', 'test-course')
       ON CONFLICT (id) DO NOTHING`,
      [stageId],
    );

    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at)
       VALUES ($1, 'owner', 'draft', 0, false, null, false, null)
       ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status`,
      [stageId],
    );

    const result = await pool.query(
      `SELECT m.owner_id            AS meta_owner_id,
              m.is_public           AS meta_is_public,
              m.status              AS meta_status,
              m.audience            AS meta_audience,
              m.published_at        AS meta_published_at,
              m.generation_complete AS meta_generation_complete,
              m.deleted_at          AS meta_deleted_at
         FROM stage_meta m WHERE m.stage_id = $1`,
      [stageId],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].meta_status).toBe('draft');
    expect(result.rows[0].meta_audience).toBe(0);

    // Cleanup.
    await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
    await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
  });
});
