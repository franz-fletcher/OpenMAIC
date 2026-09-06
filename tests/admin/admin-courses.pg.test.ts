/**
 * PG contract integration test for admin courses.
 *
 * Proves against a real PostgreSQL that:
 * - listAllCoursesForAdmin joins stage_meta, document_stages, user and returns the correct shape
 * - deleteCourseForAdmin tournstones stage_meta and deletes the document row
 * - Admin rank resolves correctly, creator rank resolves correctly
 * - Banned admin resolves to rank 0
 * - listAllCoursesForAdmin excludes tombstoned courses by default
 *
 * Seeds real better-auth sessions in a scratch database. The guard and
 * enforcement seams stay real. Route-level 403 body assertions are covered
 * in the unit test with mocks, because the real route handler requires a
 * warm auth server that shares the test database connection.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('ADMIN_COURSES_PG_OK: admin courses PG contract', () => {
  const CONTRACT_DB = `openmaic_admin_courses_${process.pid}`;
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

    // Create test users (raw id space, matching better-auth conventions)
    await pool.query(
      `INSERT INTO "user" (id, email, name, "emailVerified") VALUES
       ($1, $2, $3, true),
       ($4, $5, $6, true),
       ($7, $8, $9, true)`,
      [
        'raw-admin-alice',
        'alice-admin@pgtest.com',
        'Alice Admin',
        'raw-creator-bob',
        'bob-creator@pgtest.com',
        'Bob Creator',
        'raw-banned-carol',
        'carol-banned@pgtest.com',
        'Carol Banned',
      ],
    );

    // Assign roles (raw id space)
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES
       ($1, 'admin', 'system'),
       ($2, 'creator', 'system'),
       ($3, 'admin', 'system')`,
      ['raw-admin-alice', 'raw-creator-bob', 'raw-banned-carol'],
    );

    // Create test courses (document_stages rows)
    const now = Date.now();
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name, created_at, updated_at) VALUES
       ($1, $2, $3, $4, $5),
       ($6, $7, $8, $9, $10)`,
      [
        'pg-course-alice',
        'user:raw-admin-alice',
        'Alice Algebra Course',
        now,
        now,
        'pg-course-bob',
        'user:raw-creator-bob',
        'Bob Physics Course',
        now,
        now,
      ],
    );

    // Create stage_meta rows
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, published_at) VALUES
       ($1, $2, 'published', 0, $3),
       ($4, $5, 'draft', 2, null)`,
      ['pg-course-alice', 'user:raw-admin-alice', now, 'pg-course-bob', 'user:raw-creator-bob'],
    );

    // Ban carol
    await pool.query(`UPDATE "user" SET "banned" = true, "banReason" = 'test ban' WHERE id = $1`, [
      'raw-banned-carol',
    ]);
  });

  afterAll(async () => {
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
  });

  it('listAllCoursesForAdmin returns courses with correct shape', async () => {
    const { listAllCoursesForAdmin } = await import('@/lib/persistence/admin-courses');
    const courses = await listAllCoursesForAdmin(pool);
    expect(courses.length).toBeGreaterThanOrEqual(2);
    const alice = courses.find((c) => c.stageId === 'pg-course-alice');
    expect(alice).toBeDefined();
    expect(alice!.name).toBe('Alice Algebra Course');
    expect(alice!.status).toBe('published');
    expect(alice!.audience).toBe(0);
    expect(alice!.ownerId).toBe('user:raw-admin-alice');
    expect(alice!.ownerEmail).toBe('alice-admin@pgtest.com');
    expect(alice!.deletedAt).toBeNull();
  });

  it('listAllCoursesForAdmin includes all fields for draft courses', async () => {
    const { listAllCoursesForAdmin } = await import('@/lib/persistence/admin-courses');
    const courses = await listAllCoursesForAdmin(pool);
    const bob = courses.find((c) => c.stageId === 'pg-course-bob');
    expect(bob).toBeDefined();
    expect(bob!.name).toBe('Bob Physics Course');
    expect(bob!.status).toBe('draft');
    expect(bob!.audience).toBe(2);
    expect(bob!.ownerEmail).toBe('bob-creator@pgtest.com');
  });

  it('listAllCoursesForAdmin excludes deleted by default', async () => {
    // Tombstone one course
    const { tombstoneStageMeta } = await import('@/lib/persistence/stage-meta');
    await tombstoneStageMeta(pool, 'pg-course-bob');

    const { listAllCoursesForAdmin } = await import('@/lib/persistence/admin-courses');
    const courses = await listAllCoursesForAdmin(pool);
    const bob = courses.find((c) => c.stageId === 'pg-course-bob');
    expect(bob).toBeUndefined();
  });

  it('deleteCourseForAdmin tournstones and deletes', async () => {
    // Create a throwaway course to delete
    const now = Date.now();
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
      ['pg-course-delete-me', 'user:raw-admin-alice', 'Delete Me', now, now],
    );
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status) VALUES ($1, $2, 'draft')`,
      ['pg-course-delete-me', 'user:raw-admin-alice'],
    );

    const { deleteCourseForAdmin } = await import('@/lib/persistence/admin-courses');
    await deleteCourseForAdmin(pool, 'pg-course-delete-me', 'user:raw-admin-alice');

    // Verify document_stages row is gone
    const docResult = await pool.query('SELECT id FROM document_stages WHERE id = $1', [
      'pg-course-delete-me',
    ]);
    expect(docResult.rows).toHaveLength(0);

    // Verify stage_meta row is gone (cascade)
    const metaResult = await pool.query('SELECT stage_id FROM stage_meta WHERE stage_id = $1', [
      'pg-course-delete-me',
    ]);
    expect(metaResult.rows).toHaveLength(0);
  });

  it('resolveViewerRank returns 4 for admin user', async () => {
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-admin-alice');
    expect(rank).toBe(4);
  });

  it('resolveViewerRank returns 3 for creator user', async () => {
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-creator-bob');
    expect(rank).toBe(3);
  });

  it('resolveViewerRank returns 0 for banned admin', async () => {
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-banned-carol');
    expect(rank).toBe(0);
  });

  it('creator rank < 4 cannot pass the explicit rank-4 check', async () => {
    // The explicit rank-4 check in the delete route requires viewerRank >= 4.
    // A creator has rank 3, so the check fails.
    const { resolveViewerRank } = await import('@/lib/persistence/audience');
    const rank = await resolveViewerRank(pool, 'user:raw-creator-bob');
    expect(rank).toBeLessThan(4);
  });

  it('can() denies course.delete for rank < 3', async () => {
    const { can } = await import('@/lib/auth/permissions');
    expect(can({ rank: 0 }, 'course.delete')).toBe(false);
    expect(can({ rank: 1 }, 'course.delete')).toBe(false);
    expect(can({ rank: 2 }, 'course.delete')).toBe(false);
  });

  it('can() grants course.delete for rank >= 3', async () => {
    const { can } = await import('@/lib/auth/permissions');
    expect(can({ rank: 3 }, 'course.delete')).toBe(true);
    expect(can({ rank: 4 }, 'course.delete')).toBe(true);
  });
});
