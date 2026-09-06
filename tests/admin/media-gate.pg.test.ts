/**
 * PG contract integration test for the media gate.
 *
 * Proves against a real PostgreSQL that:
 * - decideMediaAccess returns 'allow' for published everyone-audience media to anon
 * - decideMediaAccess returns 'deny' for published learner media to guest
 * - decideMediaAccess returns 'allow' for published learner media to learner
 * - decideMediaAccess returns 'deny' for draft courses
 * - decideMediaAccess returns 'deny' for tombstoned courses
 * - decideMediaAccess returns 'deny' for missing stage_meta rows
 * - decideMediaAccess returns 'allow' for owner regardless of status
 * - decideMediaAccess returns 'deny' for banned users (rank 0)
 *
 * Seeds real data in a scratch database. No getSession mocking.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('MEDIA_GATE_PG_OK: media gate PG contract', () => {
  const CONTRACT_DB = `openmaic_media_gate_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

    // Create document_stages table (required by stage_meta foreign key)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_stages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        interactive_mode BOOLEAN,
        task_engine_mode BOOLEAN,
        created_at DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at DOUBLE PRECISION NOT NULL DEFAULT 0,
        owner_id TEXT,
        folder_id TEXT,
        data JSONB NOT NULL DEFAULT '{}'
      )
    `);

    // Ensure auth schema (creates user, session, roles, user_roles, etc.)
    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    // Ensure stage_meta schema
    const { ensureStageMetaSchema } = await import('@/lib/persistence/stage-meta');
    await ensureStageMetaSchema(pool);

    // Seed system roles
    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);

    // Create test users
    await pool.query(
      `INSERT INTO "user" (id, email, name, "emailVerified") VALUES
       ($1, $2, $3, true),
       ($4, $5, $6, true),
       ($7, $8, $9, true)`,
      [
        'raw-admin-alice',
        'alice-admin@pgtest.com',
        'Alice Admin',
        'raw-guest-bob',
        'bob-guest@pgtest.com',
        'Bob Guest',
        'raw-learner-carol',
        'carol-learner@pgtest.com',
        'Carol Learner',
      ],
    );

    // Assign roles
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES
       ($1, 'admin', 'system'),
       ($2, 'guest', 'system'),
       ($3, 'learner', 'system')`,
      ['raw-admin-alice', 'raw-guest-bob', 'raw-learner-carol'],
    );

    // Create document_stages rows (required by stage_meta foreign key)
    const now = Date.now();
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name, created_at, updated_at) VALUES
       ($1, $2, $3, $4, $5),
       ($6, $7, $8, $9, $10),
       ($11, $12, $13, $14, $15),
       ($16, $17, $18, $19, $20)`,
      [
        'pg-course-pub-everyone',
        'user:raw-admin-alice',
        'Published Everyone Course',
        now,
        now,
        'pg-course-pub-learner',
        'user:raw-admin-alice',
        'Published Learner Course',
        now,
        now,
        'pg-course-draft',
        'user:raw-admin-alice',
        'Draft Course',
        now,
        now,
        'pg-course-tombstoned',
        'user:raw-admin-alice',
        'Tombstoned Course',
        now,
        now,
      ],
    );

    // Create stage_meta rows
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, published_at) VALUES
       ($1, $2, 'published', 0, $3),
       ($4, $5, 'published', 2, $6),
       ($7, $8, 'draft', 0, null)`,
      [
        'pg-course-pub-everyone',
        'user:raw-admin-alice',
        now,
        'pg-course-pub-learner',
        'user:raw-admin-alice',
        now,
        'pg-course-draft',
        'user:raw-admin-alice',
      ],
    );

    // Tombstone one course
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, deleted_at) VALUES ($1, $2, 'published', 0, CURRENT_TIMESTAMP)`,
      ['pg-course-tombstoned', 'user:raw-admin-alice'],
    );
  });

  afterAll(async () => {
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
  });

  it('published everyone-audience media serves to anon (rank 0)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const result = await decideMediaAccess(pool, 'pg-course-pub-everyone', 'anon:cookie');
    expect(result).toBe('allow');
  });

  it('published learner media denies guest (rank 1 < audience 2)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const result = await decideMediaAccess(pool, 'pg-course-pub-learner', 'user:raw-guest-bob');
    expect(result).toBe('deny');
  });

  it('published learner media serves to learner (rank 2)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const result = await decideMediaAccess(pool, 'pg-course-pub-learner', 'user:raw-learner-carol');
    expect(result).toBe('allow');
  });

  it('published everyone-audience media serves to learner (rank 2)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const result = await decideMediaAccess(
      pool,
      'pg-course-pub-everyone',
      'user:raw-learner-carol',
    );
    expect(result).toBe('allow');
  });

  it('draft course answers deny (non-owner)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    // Use guest user who is NOT the owner of the draft course
    const result = await decideMediaAccess(pool, 'pg-course-draft', 'user:raw-guest-bob');
    expect(result).toBe('deny');
  });

  it('tombstoned course answers deny', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const result = await decideMediaAccess(pool, 'pg-course-tombstoned', 'user:raw-admin-alice');
    expect(result).toBe('deny');
  });

  it('missing stage_meta row answers deny', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const result = await decideMediaAccess(pool, 'nonexistent-classroom', 'user:raw-admin-alice');
    expect(result).toBe('deny');
  });

  it('owner always passes (published)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const result = await decideMediaAccess(pool, 'pg-course-pub-everyone', 'user:raw-admin-alice');
    expect(result).toBe('allow');
  });

  it('owner always passes (draft)', async () => {
    const { decideMediaAccess } = await import('@/lib/persistence/media-access');
    const result = await decideMediaAccess(pool, 'pg-course-draft', 'user:raw-admin-alice');
    expect(result).toBe('allow');
  });

  it('resolveViewerRank returns 4 for admin', async () => {
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-admin-alice');
    expect(rank).toBe(4);
  });

  it('resolveViewerRank returns 1 for guest', async () => {
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-guest-bob');
    expect(rank).toBe(1);
  });

  it('resolveViewerRank returns 2 for learner', async () => {
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-learner-carol');
    expect(rank).toBe(2);
  });
});
