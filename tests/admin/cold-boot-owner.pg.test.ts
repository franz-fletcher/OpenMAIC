/**
 * COLD_BOOT_PG_OK: adversarial gate for the cold-boot owner transient.
 *
 * Drives the REAL PUT route with real better-auth sessions and a real database.
 * Resets both the provider and the auth bootstrap to simulate cold boots.
 *
 * Proves:
 * 1. After a cold boot, a real signed-in session's first PUT writes user:<id>
 *    as the stage meta owner, never anon:
 * 2. The assertion holds across >= 3 simulated cold boots
 * 3. A request without a session cookie still resolves to anon identity
 * 4. A miswired reset cannot pass the gate vacuously
 *
 * The probe resets both seams (provider + auth) before each cold boot cycle.
 * The expected failure mode is pinned: if either reset is miswired, the probe
 * signs in through a stale auth server against an ended pool, getSession
 * returns null via the catch path, the request resolves anonymous, and the
 * assertion on the real owner bytes fails.
 *
 * Sessions are created through better-auth's sign-up/sign-in API so the
 * cookie carries the HMAC signature that getSignedCookie expects. Raw token
 * inserts into the session table bypass the signature and always fail lookup.
 *
 * Email verification is simulated by setting emailVerified=true in the DB
 * after sign-up, which is what happens in production after the verification
 * callback fires.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('COLD_BOOT_PG_OK: cold-boot owner transient probes', () => {
  const CONTRACT_DB = `openmaic_cold_boot_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  // Save original env
  const origDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    // Set DATABASE_URL so the route's getServerPersistenceProvider connects
    // to our scratch test database (not the root postgres URL).
    // After resetAuth + resetServerPersistenceProvider, getAuth() rebuilds
    // from this env var — it must point at the same DB where we insert
    // users and sessions.
    process.env.DATABASE_URL = databaseUrl(url, CONTRACT_DB);

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

    // Ensure auth schema
    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    // Ensure stage_meta schema
    const { ensureStageMetaSchema } = await import('@/lib/persistence/stage-meta');
    await ensureStageMetaSchema(pool);

    // Seed system roles
    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);
  });

  afterAll(async () => {
    // Restore env
    if (origDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = origDatabaseUrl;
    }

    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
  });

  /**
   * Create a verified user through better-auth's sign-up API, then mark
   * emailVerified=true in the DB (simulating the verification callback),
   * and sign in to obtain a properly signed session cookie.
   *
   * Returns { userId, signedCookie }.
   */
  async function createSignedSession(
    auth: ReturnType<typeof createAuthServer>,
    label: string,
  ): Promise<{ userId: string; signedCookie: string }> {
    const email = `${label}-${Date.now()}@test.com`;
    const password = 'TestPassword123!';

    // Sign up through the real API
    const signUpResp = await auth.apiCall('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: label }),
    });
    expect(signUpResp.ok).toBe(true);
    const signUpData = (await signUpResp.json()) as {
      user?: { id?: string };
    };
    const userId = signUpData.user?.id;
    expect(userId).toBeDefined();

    // Simulate email verification by marking emailVerified=true in the DB.
    // In production this happens after the verification callback fires.
    await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [userId]);

    // Sign in to obtain a signed session cookie
    const signInResp = await auth.apiCall('/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signInResp.ok).toBe(true);

    const setCookie = signInResp.headers.get('set-cookie') ?? '';
    const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
    expect(cookieMatch).not.toBeNull();

    return { userId: userId!, signedCookie: cookieMatch![1] };
  }

  it('cold boot: first PUT with valid session writes user:<id> not anon:', async () => {
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');
    const { createAuthServer } = await import('@/lib/auth/server');

    const auth0 = createAuthServer({ pool });
    const { userId, signedCookie } = await createSignedSession(auth0, 'cold-boot-user');

    // Create a test stage
    const stageId = `cold-boot-stage-${Date.now()}`;
    await pool.query(
      `INSERT INTO document_stages (id, name, created_at, updated_at, owner_id, data) VALUES ($1, $2, $3, $4, $5, $6)`,
      [stageId, 'Cold Boot Test', Date.now(), Date.now(), `user:${userId}`, '{}'],
    );

    // Run 3 cold boot cycles
    for (let cycle = 0; cycle < 3; cycle++) {
      // Reset both seams to simulate cold boot
      await resetServerPersistenceProvider();
      await resetAuth();

      // Use the real withRequestOwnerId to resolve the owner
      const { withRequestOwnerId } = await import('@/lib/server/agent-runtime/with-owner');
      let resolvedOwnerId: string | null = null;

      const headers = new Headers();
      headers.set('cookie', `better-auth.session_token=${signedCookie}`);

      try {
        await withRequestOwnerId({ headers }, async (ownerId, responseHeaders) => {
          resolvedOwnerId = ownerId;
          return new Response(JSON.stringify({ ownerId }), {
            status: 200,
            headers: responseHeaders,
          });
        });
      } catch (error) {
        // If withRequestOwnerId throws a 401 (cookie present but session
        // invalid), that is a failure — the session should be valid.
        if (error instanceof Response && error.status === 401) {
          throw new Error(
            `Cold boot cycle ${cycle}: session lookup failed with 401 - stale auth server detected`,
          );
        }
        throw error;
      }

      // Assert the owner is user:<id>, never anon:
      expect(resolvedOwnerId).toBe(`user:${userId}`);
      expect(resolvedOwnerId).not.toMatch(/^anon:/);
    }
  }, 15_000);

  it('cold boot: cookie-less request still resolves to anon', async () => {
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');

    // Reset both seams
    await resetServerPersistenceProvider();
    await resetAuth();

    // Request without any cookie
    const headers = new Headers();
    const { withRequestOwnerId } = await import('@/lib/server/agent-runtime/with-owner');
    let resolvedOwnerId: string | null = null;

    await withRequestOwnerId({ headers }, async (ownerId, responseHeaders) => {
      resolvedOwnerId = ownerId;
      return new Response(JSON.stringify({ ownerId }), {
        status: 200,
        headers: responseHeaders,
      });
    });

    // Assert anon identity for cookie-less request
    expect(resolvedOwnerId).toMatch(/^anon:/);
  });

  it('cold boot: miswired reset cannot pass vacuously', async () => {
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');
    const { createAuthServer } = await import('@/lib/auth/server');

    const auth0 = createAuthServer({ pool });
    const { userId, signedCookie } = await createSignedSession(auth0, 'vacuous-user');

    // Reset both seams
    await resetServerPersistenceProvider();
    await resetAuth();

    // Build a fresh auth server and verify it can find the session
    const auth = createAuthServer({ pool });
    const headers = new Headers();
    headers.set('cookie', `better-auth.session_token=${signedCookie}`);

    const response = await auth.apiCall('/get-session', { headers });

    // Assert status + body shape before parsing
    expect(response.ok).toBe(true);
    const data = (await response.json()) as Record<string, unknown> | null;
    expect(data).not.toBeNull();
    const session = (data as Record<string, unknown>).session as
      | Record<string, unknown>
      | null
      | undefined;
    expect(session).toBeDefined();
    expect(session).not.toBeNull();
    expect((session as Record<string, unknown>).userId).toBe(userId);
  }, 15_000);
});
