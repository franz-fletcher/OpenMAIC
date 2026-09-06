/**
 * PG contract integration test for the enforcement wiring.
 *
 * Proves against a real PostgreSQL that:
 * - resolvePermissionSet merges role_permissions overrides over rank defaults
 * - requirePermission respects the merged set through a real guard call
 * - Grant override flips deny to pass; revoke flips pass back to deny
 * - No cross-request cache: the same pool identity sees fresh merges
 *
 * Seeds real data in a scratch database. No getSession mocking.
 *
 * Gate: GUARD_WIRE_PG_OK
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('GUARD_WIRE_PG_OK: enforcement wiring PG contract', () => {
  const CONTRACT_DB = `openmaic_guard_wire_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  const origDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
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

    // Create a learner user and assign the learner role.
    await pool.query(
      `INSERT INTO "user" (id, email, name, "emailVerified") VALUES ($1, $2, $3, true)`,
      ['wire-learner', 'wire-learner@test.com', 'Wire Learner'],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES ($1, 'learner', 'system', now())`,
      ['wire-learner'],
    );
  });

  afterAll(async () => {
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    await resetServerPersistenceProvider();
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
    if (origDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = origDatabaseUrl;
    }
  });

  it('resolvePermissionSet returns rank defaults with no overrides', async () => {
    const { resolvePermissionSet } = await import('@/lib/auth/permissions-server');
    const role = {
      id: 'learner',
      name: 'learner',
      rank: 2,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const perms = await resolvePermissionSet(pool, role);
    // Learner rank 2 defaults: quiz.grade, classroom.chat, tts.use, asr.use
    expect(perms.has('quiz.grade')).toBe(true);
    expect(perms.has('classroom.chat')).toBe(true);
    expect(perms.has('course.create')).toBe(false);
  });

  it('resolvePermissionSet merges grant override', async () => {
    // Grant course.create to learner.
    await pool.query(
      `INSERT INTO role_permissions (role_name, permission, granted) VALUES ('learner', 'course.create', true) ON CONFLICT (role_name, permission) DO UPDATE SET granted = EXCLUDED.granted`,
    );

    const { resolvePermissionSet } = await import('@/lib/auth/permissions-server');
    const role = {
      id: 'learner',
      name: 'learner',
      rank: 2,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const perms = await resolvePermissionSet(pool, role);
    expect(perms.has('course.create')).toBe(true);
    // Rank defaults still present.
    expect(perms.has('quiz.grade')).toBe(true);
  });

  it('resolvePermissionSet merges deny override', async () => {
    // Deny classroom.chat for learner (removes a default).
    await pool.query(
      `INSERT INTO role_permissions (role_name, permission, granted) VALUES ('learner', 'classroom.chat', false) ON CONFLICT (role_name, permission) DO UPDATE SET granted = EXCLUDED.granted`,
    );

    const { resolvePermissionSet } = await import('@/lib/auth/permissions-server');
    const role = {
      id: 'learner',
      name: 'learner',
      rank: 2,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const perms = await resolvePermissionSet(pool, role);
    expect(perms.has('classroom.chat')).toBe(false);
    // Grant override still present.
    expect(perms.has('course.create')).toBe(true);
  });

  it('resolvePermissionSet sees fresh state after row delete (no cache)', async () => {
    // Remove the course.create grant.
    await pool.query(
      `DELETE FROM role_permissions WHERE role_name = 'learner' AND permission = 'course.create'`,
    );

    const { resolvePermissionSet } = await import('@/lib/auth/permissions-server');
    const role = {
      id: 'learner',
      name: 'learner',
      rank: 2,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const perms = await resolvePermissionSet(pool, role);
    expect(perms.has('course.create')).toBe(false);
    // Deny override still present.
    expect(perms.has('classroom.chat')).toBe(false);
  });

  it('requirePermission passes with grant override', async () => {
    // Re-grant course.create.
    await pool.query(
      `INSERT INTO role_permissions (role_name, permission, granted) VALUES ('learner', 'course.create', true) ON CONFLICT (role_name, permission) DO UPDATE SET granted = EXCLUDED.granted`,
    );

    // Create a session cookie for the learner via better-auth.
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const email = 'wire-learner-session@test.com';
    const password = 'testpass123';
    const signupRes = await auth.apiCall('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Wire Learner Session' }),
    });
    expect(signupRes.ok).toBe(true);
    const signupBody = (await signupRes.json()) as Record<string, unknown>;
    const userId = (signupBody.user as Record<string, unknown>)?.id as string;

    await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [userId]);
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES ($1, 'learner', 'system', now()) ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId],
    );

    const signinRes = await auth.apiCall('/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signinRes.ok).toBe(true);
    const setCookie = signinRes.headers.get('set-cookie') ?? '';
    const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
    expect(cookieMatch).not.toBeNull();

    const headers = new Headers();
    headers.set('cookie', `better-auth.session_token=${cookieMatch![1]}`);

    const { requirePermission } = await import('@/lib/auth/permissions-server');
    // course.create is granted via override. Should pass.
    const session = await requirePermission(headers, 'course.create');
    expect(session.userId).toBe(userId);
  });

  it('requirePermission denies with deny override', async () => {
    // classroom.chat is denied for learner (set in previous test).
    const { createAuthServer } = await import('@/lib/auth/server');
    const auth = createAuthServer({ pool });

    const email = 'wire-learner-deny@test.com';
    const password = 'testpass123';
    const signupRes = await auth.apiCall('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Wire Learner Deny' }),
    });
    expect(signupRes.ok).toBe(true);
    const signupBody = (await signupRes.json()) as Record<string, unknown>;
    const userId = (signupBody.user as Record<string, unknown>)?.id as string;

    await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [userId]);
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) VALUES ($1, 'learner', 'system', now()) ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId],
    );

    const signinRes = await auth.apiCall('/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signinRes.ok).toBe(true);
    const setCookie = signinRes.headers.get('set-cookie') ?? '';
    const cookieMatch = setCookie.match(/better-auth\.session_token=([^;]+)/);
    expect(cookieMatch).not.toBeNull();

    const headers = new Headers();
    headers.set('cookie', `better-auth.session_token=${cookieMatch![1]}`);

    const { requirePermission } = await import('@/lib/auth/permissions-server');
    try {
      await requirePermission(headers, 'classroom.chat');
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
  });
});
