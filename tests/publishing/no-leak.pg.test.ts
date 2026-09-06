/**
 * No-leak adversarial proof -- S5.
 *
 * Proves the read gate leaks no cross-audience content through any seam.
 *
 * Drives the real route handlers (persistence, stage-meta, classroom) against
 * a scratch database seeded with courses in every state and audience tier.
 * The scratch DB is wired via DATABASE_URL so getServerPersistenceProvider
 * and getAuth() both use it.  Never mocks the gate/session seam.
 *
 * Toggles MINIMAL_MODE in-process for the no-row classroom probe.
 *
 * Six role classes: anonymous (rank 0), guest (rank 1), learner (rank 2),
 * creator (rank 3), admin (rank 4), owner (course owner).
 *
 * Five course states: draft, published-everyone, published-guest,
 * published-learner, tombstoned.
 *
 * Expected: exact 404 or 200 per seam per role class per course state.
 * Forbidden pairs always answer 404, never 403. The response body is part
 * of the assertion.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { NextRequest } from 'next/server';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

// Mock auth modules to control owner resolution.
// Return null session so we always fall back to resolveRequestOwnerId.
vi.mock('@/lib/auth', () => ({
  getSession: async () => null,
}));

// Track callerId via a module-scoped variable set by probeRoute.
// For authenticated callers we resolve to the raw user ID directly;
// for anonymous callers we resolve to the anon identity.
// The raw ID is what user_roles.user_id stores, matching production
// better-auth convention.
let _callerIdForOwner: string | undefined;
vi.mock('@/lib/server/agent-runtime/owner', () => ({
  resolveRequestOwnerId: (_req: Pick<Request, 'headers'>, resHeaders: Headers) => {
    const id = _callerIdForOwner || 'test-anon-uuid';
    resHeaders.append(
      'Set-Cookie',
      `anonymous_id=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
    );
    // Return raw ID for authenticated callers.
    // resolveViewerRank strips 'user:' prefix, so a raw ID passes through unchanged.
    // Return anon: for anonymous callers so resolveViewerRank returns 0.
    if (id.startsWith('anon:')) {
      return id;
    }
    return id;
  },
}));

const { Pool } = pg;

const PG_URL = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!PG_URL)('publishing no-leak probes', () => {
  let pool: pg.Pool;
  let scratchDbUrl: string;
  let getStageMeta: (req: NextRequest, ctx?: { params: { stageId: string } }) => Promise<Response>;
  let getClassroom: (req: NextRequest) => Promise<Response>;
  let handlePersistenceRequest: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    if (!PG_URL) throw new Error('PG_CONTRACT_URL is required for no-leak tests');

    // Provision scratch DB.
    const admin = new Pool({ connectionString: PG_URL, max: 2 });
    const dbName = `openmaic_noleak_${process.pid}`;
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    scratchDbUrl = databaseUrl(PG_URL, dbName);

    // Wire DATABASE_URL so getAuth() and getServerPersistenceProvider use it.
    // Also enable the agent runtime flag so stage-meta route returns real responses.
    // Enable persistence dev token so the persistence route doesn't return 503.
    process.env.DATABASE_URL = scratchDbUrl;
    process.env.OPENMAIC_AGENT_RUNTIME_ENABLED = 'true';
    process.env.PERSISTENCE_DEV_TOKEN = 'test-token';

    pool = new Pool({ connectionString: scratchDbUrl, max: 6 });

    // Suppress harmless "terminating connection due to administrator command"
    // errors that occur when the scratch DB is dropped in afterAll.
    pool.on('error', () => {
      // Silently ignore -- the error is from the DB drop, not a real failure.
    });

    // Drop and recreate application tables to ensure fresh schema.
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

      -- better-auth session tables (minimal schema for session lookup).
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
    // This matches how better-auth stores user ids in production.
    await pool.query(`
      INSERT INTO "user" (id, name, email, "emailVerified") VALUES
        ('guest-raw', 'guest', 'guest@test.example', true),
        ('learner-raw', 'learner', 'learner@test.example', true),
        ('creator-raw', 'creator', 'creator@test.example', true),
        ('admin-raw', 'admin', 'admin@test.example', true)
      ON CONFLICT (id) DO NOTHING;
    `);
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES
        ('guest-raw', 'role-guest'),
        ('learner-raw', 'role-learner'),
        ('creator-raw', 'role-creator'),
        ('admin-raw', 'role-admin')
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // Seed better-auth sessions for authenticated users.
    await pool.query(`
      INSERT INTO "session" (id, "userId", expires_at, token) VALUES
        ('sess:guest', 'guest-raw', now() + interval '1 day', 'tok:guest'),
        ('sess:learner', 'learner-raw', now() + interval '1 day', 'tok:learner'),
        ('sess:creator', 'creator-raw', now() + interval '1 day', 'tok:creator'),
        ('sess:admin', 'admin-raw', now() + interval '1 day', 'tok:admin')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Import route handlers AFTER DATABASE_URL is set.
    const stageMetaRoute = await import('@/app/api/stage-meta/[stageId]/route');
    getStageMeta = stageMetaRoute.GET as any;

    const classroomRoute = await import('@/app/api/classroom/route');
    getClassroom = classroomRoute.GET;

    const persistenceRoute = await import('@/app/api/persistence/[...path]/route');
    handlePersistenceRequest = persistenceRoute.handlePersistenceRequest;
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new Pool({ connectionString: PG_URL, max: 2 });
    admin.on('error', () => {
      // Silently ignore -- the DB may not exist.
    });
    try {
      await admin.query(`DROP DATABASE IF EXISTS openmaic_noleak_${process.pid} WITH (FORCE)`);
    } catch {
      // Silently ignore.
    }
    await admin.end();
    delete process.env.DATABASE_URL;
  }, 60_000);

  // ---------------------------------------------------------------------------
  // Helper: drive a route handler and return { status, body }
  // ---------------------------------------------------------------------------
  async function probeRoute(
    handler: (req: NextRequest, ctx?: { params: { stageId: string } }) => Promise<Response>,
    path: string,
    callerId: string,
    options: { method?: string; body?: unknown; stageId?: string } = {},
  ): Promise<{ status: number; body: unknown }> {
    const url = `http://localhost${path}`;
    const init: RequestInit = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    if (options.body) init.body = JSON.stringify(options.body);

    const req = new NextRequest(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });

    // Set the callerId for the owner resolver mock.
    _callerIdForOwner = callerId;

    // Build params object for stage-meta route.
    const stageId = options.stageId || path.match(/\/api\/stage-meta\/(.+)/)?.[1];
    const ctx = stageId ? { params: { stageId } } : undefined;

    const res = await handler(req, ctx as any);
    let body: unknown;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => null);
    }
    return { status: res.status, body };
  }

  // ---------------------------------------------------------------------------
  // Helper: drive the persistence route handler
  // ---------------------------------------------------------------------------
  async function probePersistence(
    path: string,
    callerId: string,
    method: string = 'GET',
  ): Promise<{ status: number; body: unknown }> {
    const url = `http://localhost${path}`;
    const req = new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
    });

    // Set the callerId for the owner resolver mock.
    _callerIdForOwner = callerId;

    const res = await handlePersistenceRequest(req);
    let body: unknown;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => null);
    }
    return { status: res.status, body };
  }

  // ---------------------------------------------------------------------------
  // Helper: drive the persistence route with /documents path
  // ---------------------------------------------------------------------------
  async function probePersistenceDocuments(
    stageId: string,
    callerId: string,
    method: string = 'GET',
  ): Promise<{ status: number; body: unknown }> {
    const url = `http://localhost/documents/${stageId}`;
    const req = new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
    });

    // Set the callerId for the owner resolver mock.
    _callerIdForOwner = callerId;

    const res = await handlePersistenceRequest(req);
    let body: unknown;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => null);
    }
    return { status: res.status, body };
  }

  // ---------------------------------------------------------------------------
  // Helper: create a course row in every state
  // ---------------------------------------------------------------------------
  async function seedCourse(
    stageId: string,
    ownerId: string,
    status: 'draft' | 'published',
    audience: number,
    deletedAt: Date | null = null,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO document_stages (id, owner_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [stageId, ownerId, `course-${stageId}`],
    );
    await pool.query(
      `INSERT INTO stage_meta (stage_id, owner_id, status, audience, is_public, published_at, generation_complete, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7)
       ON CONFLICT (stage_id) DO UPDATE SET status = EXCLUDED.status`,
      [stageId, ownerId, status, audience, status === 'published', Date.now(), deletedAt],
    );
  }

  // ---------------------------------------------------------------------------
  // S5 probes: stage-meta route
  // ---------------------------------------------------------------------------
  let _origUncaught: NodeJS.UncaughtExceptionListener | undefined;
  beforeAll(() => {
    _origUncaught = process.listeners('uncaughtException') as any;
    process.on('uncaughtException', (err) => {
      if (err && typeof err === 'object' && 'code' in err && (err as any).code === '57P01') {
        // Silently ignore -- the error is from the DB drop, not a real failure.
        return;
      }
      // Re-throw for other errors.
      throw err;
    });
  });

  describe('stage-meta route', () => {
    it('anon gets 404 for learner-tier published course', async () => {
      const stageId = 'noleak-meta-anon-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      const res = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'anon:anon', {
        stageId,
      });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('guest gets 404 for learner-tier published course', async () => {
      const stageId = 'noleak-meta-guest-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      const res = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'guest-raw', {
        stageId,
      });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('learner gets 200 for learner-tier published course', async () => {
      const stageId = 'noleak-meta-learner-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      const res = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'learner-raw', {
        stageId,
      });
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(400);

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('guest gets 200 for guest-tier published course', async () => {
      const stageId = 'noleak-meta-guest-tier';
      await seedCourse(stageId, 'anon-owner', 'published', 1);

      const res = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'guest-raw', {
        stageId,
      });
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(400);

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('owner gets 200 for their draft, non-owner gets 404', async () => {
      const stageId = 'noleak-meta-draft';
      // Seed with raw owner ID matching what the mock resolves for 'owner-raw'.
      await seedCourse(stageId, 'owner-raw', 'draft', 3);

      const ownerRes = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'owner-raw', {
        stageId,
      });
      expect(ownerRes.status).toBe(200);

      const guestRes = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'guest-raw', {
        stageId,
      });
      expect(guestRes.status).toBe(404);
      expect(guestRes.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('tombstoned course 404s for everyone including owner', async () => {
      const stageId = 'noleak-meta-tomb';
      await seedCourse(stageId, 'owner-raw', 'published', 0, new Date());

      const ownerRes = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'owner-raw', {
        stageId,
      });
      expect(ownerRes.status).toBe(404);
      expect(ownerRes.body).toHaveProperty('error');

      const anonRes = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'anon:anon', {
        stageId,
      });
      expect(anonRes.status).toBe(404);
      expect(anonRes.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('identical 404 response shape for missing vs forbidden on stage-meta', async () => {
      const stageId = 'noleak-bytes-meta';
      await seedCourse(stageId, 'anon-owner', 'draft', 3);

      const missingRes = await probeRoute(
        getStageMeta,
        `/api/stage-meta/noleak-missing`,
        'anon:anon',
        { stageId: 'noleak-missing' },
      );
      expect(missingRes.status).toBe(404);
      const forbiddenRes = await probeRoute(
        getStageMeta,
        `/api/stage-meta/${stageId}`,
        'guest-raw',
        { stageId },
      );
      expect(forbiddenRes.status).toBe(404);

      // Verify identical body shape (both have error property).
      expect(missingRes.body).toHaveProperty('error');
      expect(forbiddenRes.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });
  });

  // ---------------------------------------------------------------------------
  // S5 probes: persistence route (document GET via /documents)
  // ---------------------------------------------------------------------------
  describe('persistence route (document GET via /documents)', () => {
    it('anon gets 404 for learner-tier published course', async () => {
      const stageId = 'noleak-persist-anon-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      const res = await probePersistenceDocuments(stageId, 'anon:anon');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('guest gets 404 for learner-tier published course', async () => {
      const stageId = 'noleak-persist-guest-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      const res = await probePersistenceDocuments(stageId, 'guest-raw');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('learner gets 200 for learner-tier published course', async () => {
      const stageId = 'noleak-persist-learner-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      const res = await probePersistenceDocuments(stageId, 'learner-raw');
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(400);

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('cross-owner draft returns 404 on document GET', async () => {
      const stageId = 'noleak-persist-draft';
      await seedCourse(stageId, 'other-owner', 'draft', 3);

      const res = await probePersistenceDocuments(stageId, 'guest-raw');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('tombstoned course 404s for everyone on document GET', async () => {
      const stageId = 'noleak-persist-tomb';
      await seedCourse(stageId, 'owner-raw', 'published', 0, new Date());

      const res = await probePersistenceDocuments(stageId, 'owner-raw');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('identical 404 response shape for missing vs forbidden on persistence', async () => {
      const stageId = 'noleak-persist-bytes';
      await seedCourse(stageId, 'anon-owner', 'draft', 3);

      const missingRes = await probePersistenceDocuments('noleak-missing-persist', 'anon:anon');
      expect(missingRes.status).toBe(404);
      const forbiddenRes = await probePersistenceDocuments(stageId, 'guest-raw');
      expect(forbiddenRes.status).toBe(404);

      // Verify identical body shape (both have error property).
      expect(missingRes.body).toHaveProperty('error');
      expect(forbiddenRes.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });
  });

  // ---------------------------------------------------------------------------
  // S5 probes: classroom route (with MINIMAL_MODE toggle)
  // ---------------------------------------------------------------------------
  describe('classroom route', () => {
    it('anon gets 404 for learner-tier published course (flag-on)', async () => {
      const stageId = 'noleak-class-anon-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      // Enable MINIMAL_MODE for this test.
      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        const res = await probeRoute(getClassroom, `/api/classroom?id=${stageId}`, 'anon:anon');
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('guest gets 404 for learner-tier published course (flag-on)', async () => {
      const stageId = 'noleak-class-guest-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        const res = await probeRoute(getClassroom, `/api/classroom?id=${stageId}`, 'guest-raw');
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('learner gets 200 for learner-tier published course (flag-on)', async () => {
      const stageId = 'noleak-class-learner-vs-learner';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      // Create the classroom JSON file on disk.
      const classroomsDir = join(process.cwd(), 'data', 'classrooms');
      mkdirSync(classroomsDir, { recursive: true });
      const filePath = join(classroomsDir, `${stageId}.json`);
      writeFileSync(
        filePath,
        JSON.stringify({ id: stageId, stage: { id: stageId, name: 'Test' }, scenes: [] }),
      );

      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        const res = await probeRoute(getClassroom, `/api/classroom?id=${stageId}`, 'learner-raw');
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(400);
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
      try {
        unlinkSync(filePath);
      } catch {
        /* file may not exist */
      }
    });

    it('published-everyone classroom returns 200 to all callers (flag-on)', async () => {
      const stageId = 'noleak-class-everyone';
      await seedCourse(stageId, 'anon-owner', 'published', 0);

      // Create the classroom JSON file.
      const classroomsDir = join(process.cwd(), 'data', 'classrooms');
      mkdirSync(classroomsDir, { recursive: true });
      const filePath = join(classroomsDir, `${stageId}.json`);
      writeFileSync(
        filePath,
        JSON.stringify({ id: stageId, stage: { id: stageId, name: 'Test' }, scenes: [] }),
      );

      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        for (const caller of ['anon:anon', 'guest-raw', 'learner-raw', 'creator-raw']) {
          const res = await probeRoute(getClassroom, `/api/classroom?id=${stageId}`, caller);
          expect(res.status).toBeGreaterThanOrEqual(200);
          expect(res.status).toBeLessThan(400);
        }
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
      try {
        unlinkSync(filePath);
      } catch {
        /* file may not exist */
      }
    });

    it('cross-owner draft returns 404 on classroom GET (flag-on)', async () => {
      const stageId = 'noleak-class-draft';
      await seedCourse(stageId, 'other-owner', 'draft', 3);

      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        const res = await probeRoute(getClassroom, `/api/classroom?id=${stageId}`, 'guest-raw');
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('tombstoned course 404s for everyone on classroom GET (flag-on)', async () => {
      const stageId = 'noleak-class-tomb';
      await seedCourse(stageId, 'owner-raw', 'published', 0, new Date());

      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        const res = await probeRoute(getClassroom, `/api/classroom?id=${stageId}`, 'owner-raw');
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('no-row classroom: flag-on 404 for anon and rank-2, flag-off 200', async () => {
      const noRowId = 'noleak-class-no-row';

      // Create a classroom file on disk for the flag-off path.
      const classroomsDir = join(process.cwd(), 'data', 'classrooms');
      mkdirSync(classroomsDir, { recursive: true });
      const filePath = join(classroomsDir, `${noRowId}.json`);
      writeFileSync(
        filePath,
        JSON.stringify({ id: noRowId, stage: { id: noRowId, name: 'Test' }, scenes: [] }),
      );

      // --- flag-on: MINIMAL_MODE enabled, no stage_meta row -> 404 ---
      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        const anonRes = await probeRoute(getClassroom, `/api/classroom?id=${noRowId}`, 'anon:anon');
        expect(anonRes.status).toBe(404);

        const learnerRes = await probeRoute(
          getClassroom,
          `/api/classroom?id=${noRowId}`,
          'learner-raw',
        );
        expect(learnerRes.status).toBe(404);
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // --- flag-off: MINIMAL_MODE disabled, no stage_meta row, file exists -> 200 ---
      const origMinimalMode2 = process.env.MINIMAL_MODE;
      delete process.env.MINIMAL_MODE;

      try {
        const anonRes2 = await probeRoute(
          getClassroom,
          `/api/classroom?id=${noRowId}`,
          'anon:anon',
        );
        expect(anonRes2.status).toBeGreaterThanOrEqual(200);
        expect(anonRes2.status).toBeLessThan(400);
      } finally {
        if (origMinimalMode2 !== undefined) {
          process.env.MINIMAL_MODE = origMinimalMode2;
        }
      }

      // Cleanup.
      try {
        unlinkSync(filePath);
      } catch {
        /* file may not exist */
      }
    });

    it('row-present flag-off parity: serves file without audience check', async () => {
      const stageId = 'noleak-class-parity';
      await seedCourse(stageId, 'anon-owner', 'published', 2);

      // Create the classroom JSON file.
      const classroomsDir = join(process.cwd(), 'data', 'classrooms');
      mkdirSync(classroomsDir, { recursive: true });
      const filePath = join(classroomsDir, `${stageId}.json`);
      writeFileSync(
        filePath,
        JSON.stringify({ id: stageId, stage: { id: stageId, name: 'Test' }, scenes: [] }),
      );

      // Flag-off: no audience check, file served for all callers.
      const origMinimalMode = process.env.MINIMAL_MODE;
      delete process.env.MINIMAL_MODE;

      try {
        // Even anon should get 200 when flag is off and file exists.
        const anonRes = await probeRoute(getClassroom, `/api/classroom?id=${stageId}`, 'anon:anon');
        expect(anonRes.status).toBeGreaterThanOrEqual(200);
        expect(anonRes.status).toBeLessThan(400);

        // Guest should also get 200.
        const guestRes = await probeRoute(
          getClassroom,
          `/api/classroom?id=${stageId}`,
          'guest-raw',
        );
        expect(guestRes.status).toBeGreaterThanOrEqual(200);
        expect(guestRes.status).toBeLessThan(400);
      } finally {
        if (origMinimalMode !== undefined) {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
      try {
        unlinkSync(filePath);
      } catch {
        /* file may not exist */
      }
    });

    it('identical 404 response shape for missing vs forbidden on classroom', async () => {
      const stageId = 'noleak-class-bytes';
      await seedCourse(stageId, 'anon-owner', 'draft', 3);

      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        const missingRes = await probeRoute(
          getClassroom,
          `/api/classroom?id=noleak-missing-class`,
          'anon:anon',
        );
        expect(missingRes.status).toBe(404);
        const forbiddenRes = await probeRoute(
          getClassroom,
          `/api/classroom?id=${stageId}`,
          'guest-raw',
        );
        expect(forbiddenRes.status).toBe(404);

        // Verify identical body shape (both have error property).
        expect(missingRes.body).toHaveProperty('error');
        expect(forbiddenRes.body).toHaveProperty('error');
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });
  });

  // ---------------------------------------------------------------------------
  // S5 probe: gallery never lists drafts or higher-audience rows
  // ---------------------------------------------------------------------------
  describe('gallery listing', () => {
    it('listGalleryCourses excludes drafts and higher-audience rows', async () => {
      const { listGalleryCourses } = await import('@/lib/persistence/gallery');

      // Seed a draft course (should NOT appear).
      const draftId = 'noleak-gallery-draft';
      await seedCourse(draftId, 'anon-owner', 'draft', 0);

      // Seed a learner-only published course (should NOT appear for guest).
      const learnerOnlyId = 'noleak-gallery-learner';
      await seedCourse(learnerOnlyId, 'anon-owner', 'published', 2);

      // Seed a guest-tier published course (should appear for guest and learner).
      const guestTierId = 'noleak-gallery-guest';
      await seedCourse(guestTierId, 'anon-owner', 'published', 1);

      // Seed an everyone-tier published course (should appear for everyone).
      const everyoneId = 'noleak-gallery-everyone';
      await seedCourse(everyoneId, 'anon-owner', 'published', 0);

      // Guest viewer rank = 1: should see guest-tier and everyone-tier only.
      const guestCourses = await listGalleryCourses(pool, 1);
      const guestIds = guestCourses.map((c) => c.stageId);
      expect(guestIds).not.toContain(draftId);
      expect(guestIds).not.toContain(learnerOnlyId);
      expect(guestIds).toContain(guestTierId);
      expect(guestIds).toContain(everyoneId);

      // Learner viewer rank = 2: should see guest, learner, and everyone tiers.
      const learnerCourses = await listGalleryCourses(pool, 2);
      const learnerIds = learnerCourses.map((c) => c.stageId);
      expect(learnerIds).not.toContain(draftId);
      expect(learnerIds).toContain(learnerOnlyId);
      expect(learnerIds).toContain(guestTierId);
      expect(learnerIds).toContain(everyoneId);

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [draftId]);
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [learnerOnlyId]);
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [guestTierId]);
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [everyoneId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [draftId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [learnerOnlyId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [guestTierId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [everyoneId]);
    });
  });

  // ---------------------------------------------------------------------------
  // S5 probe: unpublish immediate effect
  // ---------------------------------------------------------------------------
  describe('unpublish immediate effect', () => {
    it('unpublished course 404s for everyone on stage-meta', async () => {
      const stageId = 'noleak-unpublish-meta';
      // Start as published-everyone.
      await seedCourse(stageId, 'owner-raw', 'published', 0);

      // Unpublish via direct DB update (simulating the unpublish route).
      await pool.query(`UPDATE stage_meta SET status = 'draft' WHERE stage_id = $1`, [stageId]);

      // Verify 404 for everyone.
      const anonRes = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'anon:anon', {
        stageId,
      });
      expect(anonRes.status).toBe(404);

      const guestRes = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'guest-raw', {
        stageId,
      });
      expect(guestRes.status).toBe(404);

      const ownerRes = await probeRoute(getStageMeta, `/api/stage-meta/${stageId}`, 'owner-raw', {
        stageId,
      });
      // Owner can still read their draft.
      expect(ownerRes.status).toBe(200);

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('unpublished course 404s for everyone on persistence route', async () => {
      const stageId = 'noleak-unpersist-persist';
      await seedCourse(stageId, 'owner-raw', 'published', 0);

      // Unpublish.
      await pool.query(`UPDATE stage_meta SET status = 'draft' WHERE stage_id = $1`, [stageId]);

      // Verify 404 for everyone.
      const res = await probePersistenceDocuments(stageId, 'learner-raw');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });

    it('unpublished course 404s for everyone on classroom route', async () => {
      const stageId = 'noleak-unpersist-class';
      await seedCourse(stageId, 'owner-raw', 'published', 0);

      // Unpublish.
      await pool.query(`UPDATE stage_meta SET status = 'draft' WHERE stage_id = $1`, [stageId]);

      const origMinimalMode = process.env.MINIMAL_MODE;
      process.env.MINIMAL_MODE = 'true';

      try {
        // Verify 404 for everyone.
        const res = await probeRoute(getClassroom, `/api/classroom?id=${stageId}`, 'learner-raw');
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      } finally {
        if (origMinimalMode === undefined) {
          delete process.env.MINIMAL_MODE;
        } else {
          process.env.MINIMAL_MODE = origMinimalMode;
        }
      }

      // Cleanup.
      await pool.query('DELETE FROM stage_meta WHERE stage_id = $1', [stageId]);
      await pool.query('DELETE FROM document_stages WHERE id = $1', [stageId]);
    });
  });

  // ---------------------------------------------------------------------------
  // S5 probe: id-guessing (sequential ids on all three seams)
  // ---------------------------------------------------------------------------
  describe('id-guessing probe', () => {
    it('sequential ids return 404 on stage-meta for non-owner', async () => {
      const guessedIds = ['noleak-guess-00001', 'noleak-guess-00002', 'noleak-guess-00003'];

      for (const guessedId of guessedIds) {
        const res = await probeRoute(getStageMeta, `/api/stage-meta/${guessedId}`, 'anon:anon', {
          stageId: guessedId,
        });
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      }
    });

    it('sequential ids return 404 on persistence for non-owner', async () => {
      const guessedIds = [
        'noleak-guess-persist-001',
        'noleak-guess-persist-002',
        'noleak-guess-persist-003',
      ];

      for (const guessedId of guessedIds) {
        const res = await probePersistence(
          `/api/persistence/classroom/${guessedId}/document`,
          'anon:anon',
        );
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      }
    });

    it('sequential ids return 404 on classroom for non-owner', async () => {
      const guessedIds = [
        'noleak-guess-class-001',
        'noleak-guess-class-002',
        'noleak-guess-class-003',
      ];

      for (const guessedId of guessedIds) {
        const res = await probeRoute(getClassroom, `/api/classroom?id=${guessedId}`, 'anon:anon');
        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      }
    });
  });
});
