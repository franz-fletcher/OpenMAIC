/**
 * PG contract adversarial test for the enforcement wiring.
 *
 * Drives the real image POST handler with a real learner session on a real
 * scratch database. The guard and the route are never mocked. The toggle
 * sequence proves that a database override changes a guarded route on the
 * very next request, and that revoking the override restores the denial.
 *
 * Toggle sequence on ONE pool identity:
 * 1. Baseline: learner POST /api/generate/image → 403 permission_denied
 * 2. Grant:    upsert role_permissions (course.create = true) → POST → 400 MISSING_PROVIDER
 * 3. Revoke:   delete role_permissions → POST → 403 permission_denied
 *
 * The 400 MISSING_PROVIDER proves the guard passed because the route handler
 * reached the provider-resolution check (app/api/generate/image/route.ts:67).
 *
 * Gate: GUARD_LIVE_OK
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('GUARD_LIVE_OK: enforcement wiring live-route (adversarial)', () => {
  const CONTRACT_DB = `openmaic_guard_live_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  const origDatabaseUrl = process.env.DATABASE_URL;
  const origMinimalMode = process.env.MINIMAL_MODE;

  let signedCookie = '';
  let learnerUserId = '';

  beforeAll(async () => {
    // Ensure MINIMAL_MODE is on for the guard to fire.
    process.env.MINIMAL_MODE = 'true';

    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

    process.env.DATABASE_URL = databaseUrl(url, CONTRACT_DB);

    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');
    await resetServerPersistenceProvider();
    await resetAuth();

    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);

    // Create a learner via better-auth signup.
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const email = `guard-live-learner-${process.pid}@test.com`;
    const password = 'testpass123';
    const signupRes = await auth.apiCall('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Guard Live Learner' }),
    });
    expect(signupRes.ok).toBe(true);
    const signupBody = (await signupRes.json()) as Record<string, unknown>;
    learnerUserId = (signupBody.user as Record<string, unknown>)?.id as string;
    expect(learnerUserId).toBeDefined();

    // Simulate email verification.
    await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [learnerUserId]);

    // Assign learner role.
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES ($1, 'learner', 'system', now()) ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [learnerUserId],
    );

    // Sign in to get a real session cookie.
    const signinRes = await auth.apiCall('/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signinRes.ok).toBe(true);
    const setCookie = signinRes.headers.get('set-cookie') ?? '';
    const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
    expect(cookieMatch).not.toBeNull();
    signedCookie = cookieMatch![1];
  });

  afterAll(async () => {
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');
    await resetServerPersistenceProvider();
    await resetAuth();
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
    // Restore env.
    if (origDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = origDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    if (origMinimalMode !== undefined) {
      process.env.MINIMAL_MODE = origMinimalMode;
    } else {
      delete process.env.MINIMAL_MODE;
    }
  });

  function makeLearnerRequest(): import('next/server').NextRequest {
    return new Request('http://localhost/api/generate/image', {
      method: 'POST',
      headers: {
        cookie: `better-auth.session_token=${signedCookie}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'test image prompt' }),
    }) as import('next/server').NextRequest;
  }

  it('baseline: learner POST returns 403 (no course.create default)', async () => {
    const { POST } = await import('@/app/api/generate/image/route');
    const res = await POST(makeLearnerRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('permission_denied');
  });

  it('grant: upsert course.create override → POST returns 400 MISSING_PROVIDER', async () => {
    // Grant course.create to the learner role.
    await pool.query(
      `INSERT INTO role_permissions (role_name, permission, granted) VALUES ('learner', 'course.create', true) ON CONFLICT (role_name, permission) DO UPDATE SET granted = EXCLUDED.granted`,
    );

    const { POST } = await import('@/app/api/generate/image/route');
    const res = await POST(makeLearnerRequest());
    // Guard passes → route reaches provider check → no provider configured → 400.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe('MISSING_PROVIDER');
  });

  it('revoke: delete override → POST returns 403 again', async () => {
    // Remove the course.create grant.
    await pool.query(
      `DELETE FROM role_permissions WHERE role_name = 'learner' AND permission = 'course.create'`,
    );

    const { POST } = await import('@/app/api/generate/image/route');
    const res = await POST(makeLearnerRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('permission_denied');
  });

  it('stability: re-grant → 400, re-revoke → 403 (second toggle cycle)', async () => {
    // Re-grant.
    await pool.query(
      `INSERT INTO role_permissions (role_name, permission, granted) VALUES ('learner', 'course.create', true) ON CONFLICT (role_name, permission) DO UPDATE SET granted = EXCLUDED.granted`,
    );
    const { POST } = await import('@/app/api/generate/image/route');
    const res1 = await POST(makeLearnerRequest());
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.errorCode).toBe('MISSING_PROVIDER');

    // Re-revoke.
    await pool.query(
      `DELETE FROM role_permissions WHERE role_name = 'learner' AND permission = 'course.create'`,
    );
    const res2 = await POST(makeLearnerRequest());
    expect(res2.status).toBe(403);
    const body2 = await res2.json();
    expect(body2.code).toBe('permission_denied');
  });
});
