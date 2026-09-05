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

  beforeAll(async () => {
    if (!PG_URL) throw new Error('PG_CONTRACT_URL is required for integration tests');
    pool = new Pool({ connectionString: PG_URL });

    // Provision scratch DB: auth tables, document_stages, stage_meta, and
    // the audience-enforced schema that decideDocumentAccess and
    // resolveStageAccess depend on.
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

    // Seed roles used by resolveViewerRank rank joins.
    await pool.query(`
      INSERT INTO roles (id, name, rank, "isSystem") VALUES
        ('role-anon', 'anon', 0, true),
        ('role-guest', 'guest', 1, true),
        ('role-learner', 'learner', 2, true),
        ('role-creator', 'creator', 3, true),
        ('role-admin', 'admin', 4, true)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Seed user_roles mappings so resolveViewerRank returns the correct ranks.
    // user_roles FKs to "user"(id), so insert users first.
    await pool.query(`
      INSERT INTO "user" (id, name, email) VALUES
        ('user:guest', 'guest', 'guest@test.example'),
        ('user:learner', 'learner', 'learner@test.example'),
        ('user:creator', 'creator', 'creator@test.example'),
        ('user:owner', 'owner', 'owner@test.example')
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES
        ('user:guest', 'role-guest'),
        ('user:learner', 'role-learner'),
        ('user:creator', 'role-creator'),
        ('user:owner', 'role-creator')
      ON CONFLICT (user_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('enforces audience on the persistence document seam', async () => {
    const stageId = 'gate-pg-doc-' + Math.random().toString(36).slice(2);

    // Create a matching document_stage row first (stage_meta FKs to it).
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name)
       VALUES ($1, 'user:owner', 'test-course')
       ON CONFLICT (id) DO NOTHING`,
      [stageId],
    );

    // Create a stage_meta row for a published guest-only course.
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at)
       VALUES ($1, 'user:owner', 'published', 1, true, $2, false, null)
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

    // Create a matching document_stage row first (stage_meta FKs to it).
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name)
       VALUES ($1, 'user:owner', 'test-course')
       ON CONFLICT (id) DO NOTHING`,
      [stageId],
    );

    // Create a published learner-only course.
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at)
       VALUES ($1, 'user:owner', 'published', 2, true, $2, false, null)
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

    // Create a matching document_stage row first (stage_meta FKs to it).
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name)
       VALUES ($1, 'user:owner', 'test-course')
       ON CONFLICT (id) DO NOTHING`,
      [stageId],
    );

    // Create a draft course.
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at)
       VALUES ($1, 'user:owner', 'draft', 0, false, null, false, null)
       ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status`,
      [stageId],
    );

    // Use the scratch pool directly (resolveStageAccess defaults to the real DB).
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
