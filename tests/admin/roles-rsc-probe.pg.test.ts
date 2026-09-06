/**
 * ROLES_RSC_OK: real-cookie RSC wire probe for the roles section.
 *
 * Signs real sessions through better-auth's sign-in API, renders
 * AdminSettingsPage in-process with a real signed cookie in the
 * next/headers stub, and asserts:
 * 1. The roles title renders for a roles.manage holder
 * 2. The not-authorized state stays correct for a denied rank
 *
 * No server boots. The probe transport is pinned: renderToStaticMarkup
 * over the page function while stubbing next/headers to return the
 * REAL signed cookie bytes captured from the sign-in.
 *
 * Pattern from tests/admin/admin-page-gate.test.ts:170-208 and
 * tests/admin/cold-boot-owner.pg.test.ts:111-148.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Mocks -- vi.mock is hoisted before any import, so these run first.
// ---------------------------------------------------------------------------

let _realCookie = '';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    const h = new Headers();
    if (_realCookie) {
      h.set('cookie', `better-auth.session_token=${_realCookie}`);
    }
    return h;
  }),
  cookies: vi.fn(async () => ({
    get: (_name: string) => undefined,
  })),
}));

vi.mock('@/components/admin/users-section', () => ({
  default: () => 'USERS_SECTION',
}));

vi.mock('@/components/admin/invites-section', () => ({
  default: () => 'INVITES_SECTION',
}));

vi.mock('@/components/admin/courses-section', () => ({
  default: () => 'COURSES_SECTION',
}));

vi.mock('@/components/admin/roles-section', () => ({
  default: () => 'ROLES_SECTION',
}));

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en-US',
    setLocale: () => undefined,
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!contractUrl)('ROLES_RSC_OK: roles section RSC wire probes', () => {
  const CONTRACT_DB = `openmaic_roles_rsc_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  const origDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl(url, CONTRACT_DB);

    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

    // Ensure auth schema
    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    // Seed system roles
    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);
  });

  afterAll(async () => {
    if (origDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = origDatabaseUrl;
    }
    // Release server-provider and auth internal connections first
    try {
      const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
      await resetServerPersistenceProvider();
    } catch {
      // provider may never have been initialized
    }
    try {
      const { resetAuth } = await import('@/lib/auth');
      await resetAuth();
    } catch {
      // auth may never have been initialized
    }
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB} WITH (FORCE)`);
    await admin.end();
  });

  /**
   * Create a verified user through better-auth's sign-up API, then mark
   * emailVerified=true in the DB, and sign in to obtain a properly signed
   * session cookie.
   */
  async function createSignedSession(
    auth: { apiCall: (path: string, init?: RequestInit) => Promise<Response> },
    label: string,
  ): Promise<{ userId: string; signedCookie: string }> {
    const email = `${label}-${Date.now()}@test.com`;
    const password = 'TestPassword123!';

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

    // Simulate email verification
    await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [userId]);

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

  it('roles title renders for a roles.manage holder', async () => {
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');
    const { createAuthServer } = await import('@/lib/auth/server');

    await resetServerPersistenceProvider();
    await resetAuth();

    const auth = createAuthServer({ pool });
    const { userId, signedCookie } = await createSignedSession(auth, 'rsc-admin');

    // Grant the user the admin role (rank 4, has roles.manage)
    const roleResult = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'admin'`,
    );
    expect(roleResult.rows.length).toBe(1);
    const adminRoleId = roleResult.rows[0].id;

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId, adminRoleId],
    );

    // Reset so the new role assignment is picked up
    await resetServerPersistenceProvider();
    await resetAuth();

    // Set the real cookie for the next/headers mock
    _realCookie = signedCookie;

    try {
      const { default: AdminSettingsPage } = await import('@/app/admin/settings/page');
      const result = await AdminSettingsPage();
      const html = renderToStaticMarkup(result as React.ReactElement);

      // The admin role has users.manage, so the page should render sections
      expect(html).toContain('Admin Settings');
      expect(html).toContain('USERS_SECTION');
      expect(html).toContain('INVITES_SECTION');
      expect(html).toContain('COURSES_SECTION');
      expect(html).toContain('ROLES_SECTION');
    } finally {
      _realCookie = '';
    }
  }, 15_000);

  it('non-holder gets not-authorized state', async () => {
    const { resetServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { resetAuth } = await import('@/lib/auth');
    const { createAuthServer } = await import('@/lib/auth/server');

    await resetServerPersistenceProvider();
    await resetAuth();

    const auth = createAuthServer({ pool });
    // Create a guest user (rank 1, no roles.manage or users.manage)
    const { userId, signedCookie } = await createSignedSession(auth, 'rsc-guest');

    // Assign guest role (rank 1)
    const guestRoleResult = await pool.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'guest'`,
    );
    expect(guestRoleResult.rows.length).toBe(1);
    const guestRoleId = guestRoleResult.rows[0].id;

    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, granted_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
      [userId, guestRoleId],
    );

    // Reset so the new role assignment is picked up
    await resetServerPersistenceProvider();
    await resetAuth();

    // Set the real cookie for the next/headers mock
    _realCookie = signedCookie;

    try {
      const { default: AdminSettingsPage } = await import('@/app/admin/settings/page');
      const result = await AdminSettingsPage();
      const html = renderToStaticMarkup(result as React.ReactElement);

      // Guest has neither users.manage nor roles.manage
      expect(html).toContain('You do not have permission to access this page.');
      expect(html).not.toContain('USERS_SECTION');
      expect(html).not.toContain('INVITES_SECTION');
      expect(html).not.toContain('COURSES_SECTION');
      expect(html).not.toContain('ROLES_SECTION');
    } finally {
      _realCookie = '';
    }
  }, 15_000);
});
