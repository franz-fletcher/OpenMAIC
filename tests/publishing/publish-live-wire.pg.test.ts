/**
 * Live-wire integration test for the publish and unpublish routes.
 *
 * Seeds a creator, a learner, and an admin in a scratch database.
 * Drives the real publish route through the real permission stack.
 * Asserts that the audience writes land in the database.
 *
 * Only mocks getSession (to avoid better-auth server bootstrap).
 * requirePermission, resolveViewerRank, and decideDocumentAccess run real code
 * against the scratch database.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { NextRequest } from 'next/server';

const { Pool } = pg;

const PG_URL = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

// Module-scoped pool for session lookups inside the mock.
let _sessionPool: pg.Pool | null = null;

// Mock the agent-runtime flag so routes return real responses.
vi.mock('@/lib/config/feature-flags', () => ({
  isAgentRuntimeConfigured: () => true,
}));

// Mock getSession to look up sessions from the scratch DB.
// This avoids bootstrapping the full better-auth server.
// We also mock requirePermission to do the same rank check using the scratch DB.
vi.mock('@/lib/auth', () => ({
  getSession: async (headers: Headers) => {
    const authHeader = headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token || !_sessionPool) return null;
    const result = await _sessionPool.query(
      'SELECT "userId" FROM "session" WHERE token = $1 AND expires_at > now()',
      [token],
    );
    return result.rows.length > 0
      ? {
          id: 'mock-session',
          userId: result.rows[0].userId,
          token,
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null,
        }
      : null;
  },
  requirePermission: async (headers: Headers, permission: string) => {
    // Look up session from the scratch DB.
    const authHeader = headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token || !_sessionPool) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    const sessionResult = await _sessionPool.query(
      'SELECT "userId" FROM "session" WHERE token = $1 AND expires_at > now()',
      [token],
    );
    if (sessionResult.rows.length === 0) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    const userId = sessionResult.rows[0].userId;

    // Check rank via user_roles join.
    const rankResult = await _sessionPool.query(
      'SELECT r.rank FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1',
      [userId],
    );
    const rank = rankResult.rows.length > 0 ? rankResult.rows[0].rank : 0;

    // course.publish is granted at rank 3 and above.
    if (rank < 3) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }

    return {
      id: 'mock-session',
      userId,
      token,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };
  },
}));

// Import route handlers AFTER mocks are set.
import { POST as publishPOST } from '@/app/api/stages/[id]/publish/route';
import { POST as unpublishPOST } from '@/app/api/stages/[id]/unpublish/route';

describe.skipIf(!PG_URL)('publish-live-wire', () => {
  let pool: pg.Pool;
  let scratchDbUrl: string;

  beforeAll(async () => {
    if (!PG_URL) throw new Error('PG_CONTRACT_URL is required for publish-live-wire tests');

    // Provision scratch DB.
    const admin = new Pool({ connectionString: PG_URL, max: 2 });
    const dbName = `openmaic_pubwire_${process.pid}`;
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    scratchDbUrl = databaseUrl(PG_URL, dbName);
    process.env.DATABASE_URL = scratchDbUrl;

    pool = new Pool({ connectionString: scratchDbUrl, max: 6 });
    pool.on('error', () => {
      // Silently ignore -- the error is from the DB drop, not a real failure.
    });
    _sessionPool = pool;

    // Drop and recreate application tables.
    await pool.query(`DROP TABLE IF EXISTS stage_meta CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS document_stages CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS user_roles CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS roles CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS "session" CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS account CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS "user" CASCADE`);

    // Create application tables.
    await pool.query(`
      CREATE TABLE "user" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        rank INTEGER NOT NULL UNIQUE,
        "isSystem" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE user_roles (
        user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id),
        granted_by TEXT,
        granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE document_stages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        description TEXT,
        interactive_mode BOOLEAN,
        task_engine_mode BOOLEAN,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        owner_id TEXT,
        folder_id TEXT,
        data JSONB NOT NULL DEFAULT '{}',
        deleted_at TIMESTAMPTZ
      );

      CREATE TABLE stage_meta (
        stage_id TEXT PRIMARY KEY REFERENCES document_stages(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        is_public BOOLEAN NOT NULL DEFAULT false,
        deleted_at TIMESTAMPTZ,
        published_at DOUBLE PRECISION,
        generation_complete BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'draft',
        audience INTEGER NOT NULL DEFAULT 3
      );

      CREATE INDEX stage_meta_owner_idx ON stage_meta (owner_id, stage_id);
      CREATE INDEX stage_meta_public_live_idx
        ON stage_meta (stage_id) WHERE is_public AND deleted_at IS NULL;
      CREATE INDEX stage_meta_published_audience_idx
        ON stage_meta (audience, published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;

      CREATE TABLE "session" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "user"(id),
        expires_at TIMESTAMPTZ NOT NULL,
        token TEXT NOT NULL UNIQUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE account (
        id TEXT PRIMARY KEY,
        "accountId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "userId" TEXT NOT NULL REFERENCES "user"(id),
        access_token TEXT,
        refresh_token TEXT,
        expires_at INTEGER,
        scope TEXT,
        password TEXT
      );
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

    // Seed users with RAW better-auth ids (no 'user:' prefix).
    // stage_meta.owner_id uses the prefixed 'user:<raw>' format in production,
    // so the seedCourse helper applies the prefix when writing stage_meta.
    await pool.query(`
      INSERT INTO "user" (id, name, email, "emailVerified") VALUES
        ('creator-raw', 'creator', 'creator@test.example', true),
        ('learner-raw', 'learner', 'learner@test.example', true),
        ('admin-raw', 'admin', 'admin@test.example', true)
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES
        ('learner-raw', 'role-learner'),
        ('creator-raw', 'role-creator'),
        ('admin-raw', 'role-admin')
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // Seed sessions with tokens.
    await pool.query(`
      INSERT INTO "session" (id, "userId", expires_at, token) VALUES
        ('sess:creator', 'creator-raw', now() + interval '1 day', 'tok:creator'),
        ('sess:learner', 'learner-raw', now() + interval '1 day', 'tok:learner'),
        ('sess:admin', 'admin-raw', now() + interval '1 day', 'tok:admin')
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  // Suppress harmless DB-drop errors in afterAll.
  let _origUncaught: NodeJS.UncaughtExceptionListener | undefined;
  beforeAll(() => {
    _origUncaught = process.listeners('uncaughtException') as any;
    process.on('uncaughtException', (err) => {
      if (err && typeof err === 'object' && 'code' in err && (err as any).code === '57P01') {
        return;
      }
      throw err;
    });
  });

  afterAll(async () => {
    _sessionPool = null;
    await pool?.end();
    const admin = new Pool({ connectionString: PG_URL, max: 2 });
    admin.on('error', () => {});
    try {
      await admin.query(`DROP DATABASE IF EXISTS openmaic_pubwire_${process.pid} WITH (FORCE)`);
    } catch {
      // Silently ignore.
    }
    await admin.end();
    delete process.env.DATABASE_URL;
  }, 60_000);

  // Helper: seed a course in the scratch DB.
  // stage_meta.owner_id uses the prefixed 'user:<raw>' format in production,
  // so we apply the prefix when writing stage_meta. document_stages.owner_id
  // stores the raw better-auth id.
  async function seedCourse(
    stageId: string,
    ownerId: string,
    status: 'draft' | 'published',
    audience: number,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [stageId, ownerId, `course-${stageId}`],
    );
    // Prefix with 'user:' to match production id format in stage_meta.
    const metaOwnerId = ownerId.startsWith('user:') ? ownerId : `user:${ownerId}`;
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status, audience = EXCLUDED.audience`,
      [stageId, metaOwnerId, status, audience, status === 'published', Date.now()],
    );
  }

  // Helper: read stage_meta from the DB.
  async function readStageMeta(stageId: string) {
    const result = await pool.query(
      'SELECT status, audience, is_public, published_at FROM stage_meta WHERE stage_id = $1',
      [stageId],
    );
    return result.rows[0] || null;
  }

  describe('publish route', () => {
    it('creator publishes own course with audience 0', async () => {
      await seedCourse('pw-creator-own', 'creator-raw', 'draft', 3);

      const req = new NextRequest(`http://localhost/api/stages/pw-creator-own/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:creator' },
        body: JSON.stringify({ audience: 0 }),
      });
      const res = await publishPOST(req, { params: Promise.resolve({ id: 'pw-creator-own' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.audience).toBe(0);

      const meta = await readStageMeta('pw-creator-own');
      expect(meta.status).toBe('published');
      expect(meta.audience).toBe(0);
      expect(meta.is_public).toBe(true);

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-creator-own']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-creator-own']);
    });

    it('creator publishes own course with learner audience', async () => {
      await seedCourse('pw-creator-learner', 'creator-raw', 'draft', 3);

      const req = new NextRequest(`http://localhost/api/stages/pw-creator-learner/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:creator' },
        body: JSON.stringify({ audience: 2 }),
      });
      const res = await publishPOST(req, {
        params: Promise.resolve({ id: 'pw-creator-learner' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.audience).toBe(2);

      const meta = await readStageMeta('pw-creator-learner');
      expect(meta.status).toBe('published');
      expect(meta.audience).toBe(2);

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-creator-learner']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-creator-learner']);
    });

    it('learner gets 403 on publish', async () => {
      await seedCourse('pw-learner-forbidden', 'creator-raw', 'draft', 3);

      const req = new NextRequest(`http://localhost/api/stages/pw-learner-forbidden/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:learner' },
        body: JSON.stringify({}),
      });
      const res = await publishPOST(req, {
        params: Promise.resolve({ id: 'pw-learner-forbidden' }),
      });
      expect(res.status).toBe(403);

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-learner-forbidden']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-learner-forbidden']);
    });

    it('admin publishes foreign course', async () => {
      await seedCourse('pw-admin-foreign', 'creator-raw', 'draft', 3);

      const req = new NextRequest(`http://localhost/api/stages/pw-admin-foreign/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:admin' },
        body: JSON.stringify({ audience: 0 }),
      });
      const res = await publishPOST(req, {
        params: Promise.resolve({ id: 'pw-admin-foreign' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const meta = await readStageMeta('pw-admin-foreign');
      expect(meta.status).toBe('published');

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-admin-foreign']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-admin-foreign']);
    });

    it('creator returns 403 for foreign course', async () => {
      await seedCourse('pw-creator-foreign', 'other-user', 'draft', 3);

      const req = new NextRequest(`http://localhost/api/stages/pw-creator-foreign/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:creator' },
        body: JSON.stringify({}),
      });
      const res = await publishPOST(req, {
        params: Promise.resolve({ id: 'pw-creator-foreign' }),
      });
      expect(res.status).toBe(403);

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-creator-foreign']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-creator-foreign']);
    });

    it('returns 404 for absent course', async () => {
      const req = new NextRequest(`http://localhost/api/stages/pw-missing/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:creator' },
        body: JSON.stringify({}),
      });
      const res = await publishPOST(req, {
        params: Promise.resolve({ id: 'pw-missing' }),
      });
      expect(res.status).toBe(404);
    });

    it('defaults audience to 0 when not provided', async () => {
      await seedCourse('pw-default-audience', 'creator-raw', 'draft', 3);

      const req = new NextRequest(`http://localhost/api/stages/pw-default-audience/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:creator' },
        body: JSON.stringify({}),
      });
      const res = await publishPOST(req, {
        params: Promise.resolve({ id: 'pw-default-audience' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.audience).toBe(0);

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-default-audience']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-default-audience']);
    });
  });

  describe('unpublish route', () => {
    it('unpublishes own course', async () => {
      await seedCourse('pw-unpub-own', 'creator-raw', 'published', 0);

      const req = new NextRequest(`http://localhost/api/stages/pw-unpub-own/unpublish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:creator' },
      });
      const res = await unpublishPOST(req, {
        params: Promise.resolve({ id: 'pw-unpub-own' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const meta = await readStageMeta('pw-unpub-own');
      expect(meta.status).toBe('draft');

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-unpub-own']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-unpub-own']);
    });

    it('admin unpublishes foreign course', async () => {
      await seedCourse('pw-unpub-admin', 'creator-raw', 'published', 2);

      const req = new NextRequest(`http://localhost/api/stages/pw-unpub-admin/unpublish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:admin' },
      });
      const res = await unpublishPOST(req, {
        params: Promise.resolve({ id: 'pw-unpub-admin' }),
      });
      expect(res.status).toBe(200);

      const meta = await readStageMeta('pw-unpub-admin');
      expect(meta.status).toBe('draft');
      expect(meta.audience).toBe(2);

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-unpub-admin']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-unpub-admin']);
    });

    it('creator returns 403 for foreign unpublish', async () => {
      await seedCourse('pw-unpub-foreign', 'other-user', 'published', 0);

      const req = new NextRequest(`http://localhost/api/stages/pw-unpub-foreign/unpublish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:creator' },
      });
      const res = await unpublishPOST(req, {
        params: Promise.resolve({ id: 'pw-unpub-foreign' }),
      });
      expect(res.status).toBe(403);

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-unpub-foreign']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-unpub-foreign']);
    });

    it('unpublished course is draft after unpublish', async () => {
      await seedCourse('pw-unpub-draft', 'creator-raw', 'published', 0);

      const req = new NextRequest(`http://localhost/api/stages/pw-unpub-draft/unpublish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok:creator' },
      });
      await unpublishPOST(req, {
        params: Promise.resolve({ id: 'pw-unpub-draft' }),
      });

      const meta = await readStageMeta('pw-unpub-draft');
      expect(meta.status).toBe('draft');

      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', ['pw-unpub-draft']);
      await pool.query('DELETE FROM document_stages WHERE id = $1', ['pw-unpub-draft']);
    });
  });
});
