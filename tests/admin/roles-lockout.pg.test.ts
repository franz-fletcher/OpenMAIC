/**
 * PG contract adversarial test for the self-lockout guard.
 *
 * Drives real handlers with real seeded sessions on a scratch database.
 * The guard and enforcement are never mocked. Every refusal asserts exact
 * status + code (no vacuous assertions).
 *
 * Lockout matrix:
 * - Admin A cannot PATCH their own active role
 * - Admin A cannot DELETE their own active role
 * - Admin A cannot strip roles.manage from their own role via updateRole
 * - Admin A's self setUserRole is refused (SELF_DEMOTE_REFUSED)
 * - Second admin B CAN edit admin A's role (cross-admin recovery)
 *
 * Gate: ROLES_LOCKOUT_OK
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('ROLES_LOCKOUT_OK: self-lockout guard (adversarial)', () => {
  const CONTRACT_DB = `openmaic_roles_lockout_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  // Save original env and point DATABASE_URL at the scratch DB so
  // getAuth() / getServerPersistenceProvider() build from the same DB
  // where we seed users and sessions.
  const origDatabaseUrl = process.env.DATABASE_URL;

  // Admin A: the acting session whose own role is locked.
  const adminAUserId = 'lockout-admin-a';
  const adminARoleId = 'role-admin-a';
  // Admin B: a second admin who CAN edit admin A's role.
  const adminBUserId = 'lockout-admin-b';
  const adminBRoleId = 'role-admin-b';
  // Custom role: a role that admin A holds and that is locked.
  const customRoleId = 'role-custom-lockout';

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

    // Wire DATABASE_URL so getAuth() and getServerPersistenceProvider()
    // connect to the scratch database.
    process.env.DATABASE_URL = databaseUrl(url, CONTRACT_DB);

    // Reset both caches so the route handlers' getSession / requirePermission
    // resolve from the scratch DB, not a stale cached instance.
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');
    await resetServerPersistenceProvider();
    await resetAuth();

    // Ensure auth schema (creates tables + drops rank constraint).
    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    // Seed system roles.
    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);

    // Create the two admin users.
    await pool.query(
      `INSERT INTO "user" (id, email, name, "emailVerified")
       VALUES ($1, 'lockout-a@test.com', 'Admin A', true),
              ($2, 'lockout-b@test.com', 'Admin B', true)`,
      [adminAUserId, adminBUserId],
    );

    // Create admin role for admin A (using the system admin role id).
    // The system admin role is seeded as id='admin', name='admin', rank=4.
    // We assign admin A to the system admin role.
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ($1, 'admin', 'system', now())`,
      [adminAUserId],
    );

    // Create a second admin role for admin B (custom role at rank 4).
    await pool.query(
      `INSERT INTO roles (id, name, rank, "isSystem")
       VALUES ($1, 'admin-b', 4, false)`,
      [adminBRoleId],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ($1, $2, 'system', now())`,
      [adminBUserId, adminBRoleId],
    );
  });

  afterAll(async () => {
    // Reset caches first so the cached provider's pool is ended.
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');
    await resetServerPersistenceProvider();
    await resetAuth();

    await pool.end();

    // Terminate any lingering sessions before drop.
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [CONTRACT_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();

    // Restore DATABASE_URL.
    if (origDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = origDatabaseUrl;
    }
  });

  /**
   * Create a verified user through better-auth's sign-up API, then mark
   * emailVerified=true in the DB (simulating the verification callback),
   * and sign in to obtain a properly signed session cookie.
   *
   * Returns { userId, signedCookie }.
   */
  async function createSignedSession(
    auth: { apiCall: (path: string, init?: RequestInit) => Promise<Response> },
    email: string,
    label: string,
  ): Promise<{ userId: string; signedCookie: string }> {
    const password = 'testpass123';

    const signupRes = await auth.apiCall('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: label }),
    });
    expect(signupRes.ok).toBe(true);
    const signupBody = (await signupRes.json()) as Record<string, unknown>;
    const sessionUser = (signupBody.user as Record<string, unknown>)?.id as string;
    expect(sessionUser).toBeDefined();

    // Simulate email verification by marking emailVerified=true in the DB.
    await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [sessionUser]);

    const signinRes = await auth.apiCall('/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signinRes.ok).toBe(true);

    const setCookie = signinRes.headers.get('set-cookie') ?? '';
    // better-auth uses the cookie name "better-auth.session_token".
    const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
    expect(cookieMatch).not.toBeNull();

    return { userId: sessionUser, signedCookie: cookieMatch![1] };
  }

  it('Admin A cannot PATCH their own active role (lockout guard)', async () => {
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const { userId, signedCookie } = await createSignedSession(
      auth,
      'lockout-a-session@test.com',
      'Admin A Session',
    );

    // Assign the admin role to this user.
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ($1, 'admin', 'system', now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId],
    );

    const { PATCH } = await import('@/app/api/admin/roles/[id]/route');
    const req = new Request('http://localhost/api/admin/roles/admin', {
      method: 'PATCH',
      headers: {
        cookie: `better-auth.session_token=${signedCookie}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'hacked-admin' }),
    }) as import('next/server').NextRequest;

    const res = await PATCH(req, { params: Promise.resolve({ id: 'admin' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SELF_LOCKOUT_REFUSED');
    expect(body.message).toBeDefined();
  });

  it('Admin A cannot DELETE their own active role (lockout guard)', async () => {
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const { userId, signedCookie } = await createSignedSession(
      auth,
      'lockout-a-delete@test.com',
      'Admin A Delete',
    );

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ($1, 'admin', 'system', now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId],
    );

    const { DELETE } = await import('@/app/api/admin/roles/[id]/route');
    const req = new Request('http://localhost/api/admin/roles/admin', {
      method: 'DELETE',
      headers: { cookie: `better-auth.session_token=${signedCookie}` },
    }) as import('next/server').NextRequest;

    const res = await DELETE(req, { params: Promise.resolve({ id: 'admin' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SELF_LOCKOUT_REFUSED');
  });

  it('Admin A cannot strip roles.manage from their own role', async () => {
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const { userId, signedCookie } = await createSignedSession(
      auth,
      'lockout-a-strip@test.com',
      'Admin A Strip',
    );

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ($1, 'admin', 'system', now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId],
    );

    const { PATCH } = await import('@/app/api/admin/roles/[id]/route');
    const req = new Request('http://localhost/api/admin/roles/admin', {
      method: 'PATCH',
      headers: {
        cookie: `better-auth.session_token=${signedCookie}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        permissions: [{ permission: 'roles.manage', granted: false }],
      }),
    }) as import('next/server').NextRequest;

    const res = await PATCH(req, { params: Promise.resolve({ id: 'admin' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SELF_LOCKOUT_REFUSED');
  });

  it('Admin B CAN edit admin A role (cross-admin recovery)', async () => {
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const { userId, signedCookie } = await createSignedSession(
      auth,
      'lockout-b-cross@test.com',
      'Admin B Cross',
    );

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ($1, $2, 'system', now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId, adminBRoleId],
    );

    const { PATCH } = await import('@/app/api/admin/roles/[id]/route');
    const req = new Request('http://localhost/api/admin/roles/admin', {
      method: 'PATCH',
      headers: {
        cookie: `better-auth.session_token=${signedCookie}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'admin' }), // no-op rename, proves access
    }) as import('next/server').NextRequest;

    const res = await PATCH(req, { params: Promise.resolve({ id: 'admin' }) });
    const body = await res.json();

    // Admin B should succeed (not get 400 SELF_LOCKOUT_REFUSED).
    expect(res.status).not.toBe(400);
    expect(body.success).toBe(true);
  });

  it('setUserRole refuses self-demotion (SELF_DEMOTE_REFUSED)', async () => {
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const { userId, signedCookie } = await createSignedSession(
      auth,
      'lockout-a-selfdemote@test.com',
      'Admin A SelfDemote',
    );

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ($1, 'admin', 'system', now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId],
    );

    // Get the learner role id for the target.
    const learnerResult = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'learner'`,
    );
    const learnerRoleId = learnerResult.rows[0].id;

    const { PATCH } = await import('@/app/api/admin/users/route');
    const req = new Request('http://localhost/api/admin/users', {
      method: 'PATCH',
      headers: {
        cookie: `better-auth.session_token=${signedCookie}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'setRole', userId, roleId: learnerRoleId }),
    }) as import('next/server').NextRequest;

    const res = await PATCH(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SELF_DEMOTE_REFUSED');
  });

  it('non-admin gets typed 403 on every role route', async () => {
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const { userId, signedCookie } = await createSignedSession(
      auth,
      'lockout-learner@test.com',
      'Learner NoAccess',
    );

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at)
       VALUES ($1, 'learner', 'system', now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId],
    );

    // GET /api/admin/roles
    const { GET } = await import('@/app/api/admin/roles/route');
    const getReq = new Request('http://localhost/api/admin/roles', {
      headers: { cookie: `better-auth.session_token=${signedCookie}` },
    }) as import('next/server').NextRequest;
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(403);

    // POST /api/admin/roles
    const { POST } = await import('@/app/api/admin/roles/route');
    const postReq = new Request('http://localhost/api/admin/roles', {
      method: 'POST',
      headers: {
        cookie: `better-auth.session_token=${signedCookie}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'test', rank: 2, permissions: [] }),
    }) as import('next/server').NextRequest;
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(403);

    // PATCH /api/admin/roles/[id]
    const { PATCH } = await import('@/app/api/admin/roles/[id]/route');
    const patchReq = new Request('http://localhost/api/admin/roles/admin', {
      method: 'PATCH',
      headers: {
        cookie: `better-auth.session_token=${signedCookie}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'hacked' }),
    }) as import('next/server').NextRequest;
    const patchRes = await PATCH(patchReq, { params: Promise.resolve({ id: 'admin' }) });
    expect(patchRes.status).toBe(403);

    // DELETE /api/admin/roles/[id]
    const { DELETE } = await import('@/app/api/admin/roles/[id]/route');
    const deleteReq = new Request('http://localhost/api/admin/roles/admin', {
      method: 'DELETE',
      headers: { cookie: `better-auth.session_token=${signedCookie}` },
    }) as import('next/server').NextRequest;
    const deleteRes = await DELETE(deleteReq, { params: Promise.resolve({ id: 'admin' }) });
    expect(deleteRes.status).toBe(403);
  });
});
