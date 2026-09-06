import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resolveViewerRank } from '@/lib/persistence/audience';
import { listGalleryCourses } from '@/lib/persistence/gallery';

const { Pool } = pg;

const PG_URL = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!PG_URL)('publishing gallery (integration)', () => {
  let pool: pg.Pool;
  let scratchDbUrl: string;

  beforeAll(async () => {
    if (!PG_URL) throw new Error('PG_CONTRACT_URL is required for integration tests');

    // Provision scratch DB to avoid interference from parallel test files.
    const admin = new Pool({ connectionString: PG_URL, max: 2 });
    const dbName = `openmaic_gallery_${process.pid}`;
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    scratchDbUrl = databaseUrl(PG_URL, dbName);
    pool = new Pool({ connectionString: scratchDbUrl, max: 4 });

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

    await pool.query(`
      INSERT INTO roles (id, name, rank, "isSystem") VALUES
        ('role-anon', 'anon', 0, true),
        ('role-guest', 'guest', 1, true),
        ('role-learner', 'learner', 2, true),
        ('role-creator', 'creator', 3, true),
        ('role-admin', 'admin', 4, true)
      ON CONFLICT (name) DO NOTHING;
    `);

    // Use raw IDs (no prefix) because resolveViewerRank strips 'user:' prefix.
    await pool.query(`
      INSERT INTO "user" (id, name, email) VALUES
        ('anon', 'anon', 'anon@test.example'),
        ('guest', 'guest', 'guest@test.example'),
        ('learner', 'learner', 'learner@test.example'),
        ('creator', 'creator', 'creator@test.example')
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES
        ('guest', 'role-guest'),
        ('learner', 'role-learner'),
        ('creator', 'role-creator')
      ON CONFLICT (user_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new Pool({ connectionString: PG_URL, max: 2 });
    admin.on('error', () => {});
    try {
      await admin.query(`DROP DATABASE IF EXISTS openmaic_gallery_${process.pid} WITH (FORCE)`);
    } catch {
      // Silently ignore.
    }
    await admin.end();
  }, 60_000);

  it('lists only published courses visible to the viewer rank', async () => {
    const now = Date.now();

    // Create courses in every audience tier.
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name) VALUES
        ('gal-everyone', 'creator', 'Everyone Course'),
        ('gal-guest', 'creator', 'Guest Course'),
        ('gal-learner', 'creator', 'Learner Course')
      ON CONFLICT (id) DO NOTHING`,
    );

    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at) VALUES
        ('gal-everyone', 'creator', 'published', 0, true, $1, false, null),
        ('gal-guest', 'creator', 'published', 1, true, $1, false, null),
        ('gal-learner', 'creator', 'published', 2, true, $1, false, null)
      ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status, audience = EXCLUDED.audience`,
      [now],
    );

    // Anonymous viewer (rank 0) should see only everyone-audience courses.
    const anonRank = await resolveViewerRank(pool, 'user:anon');
    const anonCourses = await listGalleryCourses(pool, anonRank);
    expect(anonCourses.map((c) => c.stageId)).toContain('gal-everyone');
    expect(anonCourses.map((c) => c.stageId)).not.toContain('gal-guest');
    expect(anonCourses.map((c) => c.stageId)).not.toContain('gal-learner');

    // Guest (rank 1) should see everyone and guest courses.
    const guestRank = await resolveViewerRank(pool, 'user:guest');
    const guestCourses = await listGalleryCourses(pool, guestRank);
    expect(guestCourses.map((c) => c.stageId)).toContain('gal-everyone');
    expect(guestCourses.map((c) => c.stageId)).toContain('gal-guest');
    expect(guestCourses.map((c) => c.stageId)).not.toContain('gal-learner');

    // Learner (rank 2) should see all three.
    const learnerRank = await resolveViewerRank(pool, 'user:learner');
    const learnerCourses = await listGalleryCourses(pool, learnerRank);
    expect(learnerCourses.map((c) => c.stageId)).toContain('gal-everyone');
    expect(learnerCourses.map((c) => c.stageId)).toContain('gal-guest');
    expect(learnerCourses.map((c) => c.stageId)).toContain('gal-learner');

    // Cleanup.
    await pool.query('DELETE FROM stage_meta WHERE stage_id IN ($1, $2, $3)', [
      'gal-everyone',
      'gal-guest',
      'gal-learner',
    ]);
    await pool.query('DELETE FROM document_stages WHERE id IN ($1, $2, $3)', [
      'gal-everyone',
      'gal-guest',
      'gal-learner',
    ]);
  });

  it('excludes draft courses from the gallery', async () => {
    const now = Date.now();

    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name) VALUES ('gal-draft', 'creator', 'Draft Course') ON CONFLICT (id) DO NOTHING`,
    );

    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at) VALUES
        ('gal-draft', 'creator', 'draft', 0, false, null, false, null)
      ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status`,
    );

    const anonRank = await resolveViewerRank(pool, 'user:anon');
    const courses = await listGalleryCourses(pool, anonRank);
    expect(courses.map((c) => c.stageId)).not.toContain('gal-draft');

    // Cleanup.
    await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['gal-draft']);
    await pool.query('DELETE FROM document_stages WHERE id = $1', ['gal-draft']);
  });

  it('excludes tombstoned courses from the gallery', async () => {
    const now = Date.now();

    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name) VALUES ('gal-tomb', 'creator', 'Tombstoned Course') ON CONFLICT (id) DO NOTHING`,
    );

    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at) VALUES
        ('gal-tomb', 'creator', 'published', 0, true, $1, false, now())
      ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status`,
      [now],
    );

    const anonRank = await resolveViewerRank(pool, 'user:anon');
    const courses = await listGalleryCourses(pool, anonRank);
    expect(courses.map((c) => c.stageId)).not.toContain('gal-tomb');

    // Cleanup.
    await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['gal-tomb']);
    await pool.query('DELETE FROM document_stages WHERE id = $1', ['gal-tomb']);
  });

  it('orders results by published_at descending', async () => {
    const older = Date.now() - 100000;
    const newer = Date.now();

    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name) VALUES ('gal-oldest', 'creator', 'Oldest') ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name) VALUES ('gal-newest', 'creator', 'Newest') ON CONFLICT (id) DO NOTHING`,
    );

    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at) VALUES
        ('gal-oldest', 'creator', 'published', 0, true, $1, false, null),
        ('gal-newest', 'creator', 'published', 0, true, $2, false, null)
      ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status`,
      [older, newer],
    );

    const anonRank = await resolveViewerRank(pool, 'user:anon');
    const courses = await listGalleryCourses(pool, anonRank);
    const idxNewest = courses.findIndex((c) => c.stageId === 'gal-newest');
    const idxOldest = courses.findIndex((c) => c.stageId === 'gal-oldest');
    expect(idxNewest).toBeLessThan(idxOldest);

    // Cleanup.
    await pool.query('DELETE FROM stage_meta WHERE stage_id IN ($1, $2)', [
      'gal-oldest',
      'gal-newest',
    ]);
    await pool.query('DELETE FROM document_stages WHERE id IN ($1, $2)', [
      'gal-oldest',
      'gal-newest',
    ]);
  });
});
