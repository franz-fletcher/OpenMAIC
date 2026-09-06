/**
 * PG contract integration test for custom role audience rank probes.
 *
 * Proves against a real PostgreSQL that:
 * - A custom rank-2 role user resolves to rank 2 through resolveViewerRank
 * - A rank-2 viewer opens a learner-audience published course through
 *   decideDocumentAccess
 * - A rank-2 viewer is denied a creator-audience course (audience 3)
 * - A rank-1 custom role user resolves to rank 1 and is denied a
 *   learner-audience course (audience 2 > rank 1)
 *
 * Seeds real data in a scratch database. No mocking.
 *
 * Gate: ROLE_AUDIENCE_PG_OK
 */

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)(
  'ROLE_AUDIENCE_PG_OK: custom role audience rank probes PG contract',
  () => {
    const CONTRACT_DB = `openmaic_role_audience_${process.pid}`;
    const url = contractUrl!;
    let pool: Pool;

    beforeAll(async () => {
      const admin = new Pool({ connectionString: url, max: 2 });
      await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
      await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
      await admin.end();
      pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

      // Ensure auth schema (creates user, session, roles, user_roles, etc.)
      const { ensureAuthSchema } = await import('@/lib/auth/schema');
      await ensureAuthSchema(pool);

      // Seed system roles.
      const { seedRoleGrants } = await import('@/lib/auth/roles');
      await seedRoleGrants(pool, []);

      // Create document_stages table (required by stage_meta FK).
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

      // Ensure stage_meta schema (references document_stages).
      const { ensureStageMetaSchema } = await import('@/lib/persistence/stage-meta');
      await ensureStageMetaSchema(pool);

      // Create a custom rank-2 role.
      await pool.query(
        `INSERT INTO roles (id, name, rank, "isSystem")
       VALUES ('custom-rank2', 'audience-probe-r2', 2, false)`,
      );

      // Create a custom rank-1 role.
      await pool.query(
        `INSERT INTO roles (id, name, rank, "isSystem")
       VALUES ('custom-rank1', 'audience-probe-r1', 1, false)`,
      );

      // Create users: one with rank-2 custom role, one with rank-1 custom role.
      await pool.query(
        `INSERT INTO "user" (id, email, name, "emailVerified", "createdAt", "updatedAt")
       VALUES
         ('rank2-user', 'rank2@pgtest.com', 'Rank Two User', true, now(), now()),
         ('rank1-user', 'rank1@pgtest.com', 'Rank One User', true, now(), now()),
         ('other-owner', 'owner@pgtest.com', 'Course Owner', true, now(), now())`,
      );

      // Assign roles.
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES
         ('rank2-user', 'custom-rank2', 'admin', now()),
         ('rank1-user', 'custom-rank1', 'admin', now())`,
      );

      // Create document_stages rows for courses.
      const now = Date.now();
      await pool.query(
        `INSERT INTO document_stages (id, owner_id, name, created_at, updated_at)
       VALUES
         ('learner-course', 'user:other-owner', 'Learner Course', $1, $1),
         ('creator-course', 'user:other-owner', 'Creator Course', $1, $1),
         ('guest-course', 'user:other-owner', 'Guest Course', $1, $1)`,
        [now],
      );

      // Create stage_meta rows: learner=2, creator=3, guest=1.
      await pool.query(
        `INSERT INTO stage_meta (stage_id, owner_id, status, audience, published_at)
       VALUES
         ('learner-course', 'user:other-owner', 'published', 2, $1),
         ('creator-course', 'user:other-owner', 'published', 3, $1),
         ('guest-course', 'user:other-owner', 'published', 1, $1)`,
        [now],
      );
    });

    afterAll(async () => {
      await pool.end();

      // Terminate any lingering sessions before drop.
      const admin = new Pool({ connectionString: url, max: 2 });
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [CONTRACT_DB],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
      await admin.end();
    });

    it('resolveViewerRank returns 2 for the rank-2 custom role user', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const rank = await resolveViewerRank(pool, 'user:rank2-user');
      expect(rank).toBe(2);
    });

    it('resolveViewerRank returns 1 for the rank-1 custom role user', async () => {
      const { resolveViewerRank } = await import('@/lib/persistence/audience');
      const rank = await resolveViewerRank(pool, 'user:rank1-user');
      expect(rank).toBe(1);
    });

    it('rank-2 viewer opens a published learner-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const { readStageMeta } = await import('@/lib/persistence/stage-meta');

      const meta = await readStageMeta(pool, 'learner-course');
      expect(meta).not.toBeNull();
      expect(meta!.status).toBe('published');
      expect(meta!.audience).toBe(2);

      const result = await decideDocumentAccess(
        { kind: 'read', stageId: 'learner-course' },
        'user:rank2-viewer',
        (stageId) => readStageMeta(pool, stageId),
        async () => true,
        (stageId) => readStageMeta(pool, stageId),
        2,
      );
      expect(result).toBe('allow');
    });

    it('rank-2 viewer is denied a published creator-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const { readStageMeta } = await import('@/lib/persistence/stage-meta');

      const meta = await readStageMeta(pool, 'creator-course');
      expect(meta).not.toBeNull();
      expect(meta!.audience).toBe(3);

      const result = await decideDocumentAccess(
        { kind: 'read', stageId: 'creator-course' },
        'user:rank2-viewer',
        (stageId) => readStageMeta(pool, stageId),
        async () => true,
        (stageId) => readStageMeta(pool, stageId),
        2,
      );
      expect(result).toBe('not-found');
    });

    it('rank-1 viewer is denied a published learner-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const { readStageMeta } = await import('@/lib/persistence/stage-meta');

      const meta = await readStageMeta(pool, 'learner-course');
      expect(meta).not.toBeNull();
      expect(meta!.audience).toBe(2);

      const result = await decideDocumentAccess(
        { kind: 'read', stageId: 'learner-course' },
        'user:rank1-viewer',
        (stageId) => readStageMeta(pool, stageId),
        async () => true,
        (stageId) => readStageMeta(pool, stageId),
        1,
      );
      expect(result).toBe('not-found');
    });

    it('rank-2 viewer opens a published guest-audience course', async () => {
      const { decideDocumentAccess } = await import('@/lib/persistence/document-access');
      const { readStageMeta } = await import('@/lib/persistence/stage-meta');

      const meta = await readStageMeta(pool, 'guest-course');
      expect(meta).not.toBeNull();
      expect(meta!.audience).toBe(1);

      const result = await decideDocumentAccess(
        { kind: 'read', stageId: 'guest-course' },
        'user:rank2-viewer',
        (stageId) => readStageMeta(pool, stageId),
        async () => true,
        (stageId) => readStageMeta(pool, stageId),
        2,
      );
      // rank 2 >= audience 1 => allow
      expect(result).toBe('allow');
    });
  },
);
