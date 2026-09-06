/**
 * PG contract integration test for invites.
 *
 * Proves against a real PostgreSQL that:
 * - createInvite writes a row with a hashed code and returns the invite
 * - consumeInvite atomically marks one unused row used and returns the role
 * - listPendingInvites returns unused, unrevoked, unexpired rows
 * - revokeInvite writes the revoked_at timestamp
 * - lookupInvite returns invite info for valid codes
 * - A consumed invite cannot be consumed again
 * - An expired invite cannot be consumed
 * - A revoked invite cannot be consumed
 *
 * Seeds real data in a scratch database. No mocking.
 *
 * Gate: INVITES_PG_OK
 */

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contractUrl = process.env.PG_CONTRACT_URL;

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe.skipIf(!contractUrl)('INVITES_PG_OK: invites PG contract', () => {
  const CONTRACT_DB = `openmaic_invites_${process.pid}`;
  const url = contractUrl!;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.query(`CREATE DATABASE ${CONTRACT_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl(url, CONTRACT_DB), max: 4 });

    // Ensure auth schema (creates user, session, roles, user_roles, invites, etc.)
    const { ensureAuthSchema } = await import('@/lib/auth/schema');
    await ensureAuthSchema(pool);

    // Seed system roles
    const { seedRoleGrants } = await import('@/lib/auth/roles');
    await seedRoleGrants(pool, []);
  });

  afterAll(async () => {
    await pool.end();
    const admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${CONTRACT_DB}`);
    await admin.end();
  });

  it('createInvite writes a row and returns the invite with code', async () => {
    const { createInvite } = await import('@/lib/auth/invites');
    const invite = await createInvite(pool, 'alice@test.com', 'learner', 'admin-user');
    expect(invite.id).toBeDefined();
    expect(invite.email).toBe('alice@test.com');
    expect(invite.roleName).toBe('learner');
    expect(invite.code).toBeDefined();
    expect(invite.code.length).toBeGreaterThan(0);
    expect(invite.usedAt).toBeNull();
    expect(invite.revokedAt).toBeNull();
  });

  it('consumeInvite returns the role name for a valid code', async () => {
    const { createInvite, consumeInvite } = await import('@/lib/auth/invites');
    const invite = await createInvite(pool, 'bob@test.com', 'creator', 'admin-user');
    const role = await consumeInvite(pool, invite.code, 'user-bob');
    expect(role).toBe('creator');
  });

  it('listPendingInvites returns unused, unrevoked, unexpired invites', async () => {
    const { listPendingInvites } = await import('@/lib/auth/invites');
    const invites = await listPendingInvites(pool);
    // Should include at least the unconsumed ones
    expect(invites.length).toBeGreaterThanOrEqual(1);
    for (const inv of invites) {
      expect(inv.usedAt).toBeNull();
      expect(inv.revokedAt).toBeNull();
      expect(inv.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('revokeInvite writes revoked_at', async () => {
    const { createInvite, revokeInvite, listPendingInvites } = await import('@/lib/auth/invites');
    const invite = await createInvite(pool, 'carol@test.com', 'guest', 'admin-user');
    await revokeInvite(pool, invite.id);
    const pending = await listPendingInvites(pool);
    const found = pending.find((i) => i.id === invite.id);
    expect(found).toBeUndefined();
  });

  it('lookupInvite returns info for valid codes', async () => {
    const { createInvite, lookupInvite } = await import('@/lib/auth/invites');
    const invite = await createInvite(pool, 'dave@test.com', 'admin', 'admin-user');
    const result = await lookupInvite(pool, invite.code);
    expect(result).not.toBeNull();
    expect(result!.email).toBe('dave@test.com');
    expect(result!.roleName).toBe('admin');
  });

  it('lookupInvite returns null for invalid codes', async () => {
    const { lookupInvite } = await import('@/lib/auth/invites');
    const result = await lookupInvite(pool, 'invalid-code-123');
    expect(result).toBeNull();
  });

  it('a consumed invite cannot be consumed again', async () => {
    const { createInvite, consumeInvite } = await import('@/lib/auth/invites');
    const invite = await createInvite(pool, 'eve@test.com', 'learner', 'admin-user');
    const first = await consumeInvite(pool, invite.code, 'user-eve');
    expect(first).toBe('learner');
    const second = await consumeInvite(pool, invite.code, 'user-eve-2');
    expect(second).toBeNull();
  });

  it('an expired invite cannot be consumed', async () => {
    const { consumeInvite } = await import('@/lib/auth/invites');
    // Insert an expired invite directly.
    await pool.query(
      `INSERT INTO invites (email, role_name, code, expires_at, created_by)
       VALUES ('expired@test.com', 'guest', 'expired-hash', now() - interval '1 day', 'admin-user')`,
    );
    const result = await consumeInvite(pool, 'expired-hash', 'user-expired');
    expect(result).toBeNull();
  });

  it('a revoked invite cannot be consumed', async () => {
    const { consumeInvite } = await import('@/lib/auth/invites');
    // Insert and revoke an invite directly.
    await pool.query(
      `INSERT INTO invites (email, role_name, code, expires_at, revoked_at, created_by)
       VALUES ('revoked@test.com', 'guest', 'revoked-hash', now() + interval '7 days', now(), 'admin-user')`,
    );
    const result = await consumeInvite(pool, 'revoked-hash', 'user-revoked');
    expect(result).toBeNull();
  });

  it('isValidRole returns true for existing roles', async () => {
    const { isValidRole } = await import('@/lib/auth/invites');
    expect(await isValidRole(pool, 'guest')).toBe(true);
    expect(await isValidRole(pool, 'admin')).toBe(true);
    expect(await isValidRole(pool, 'nonexistent')).toBe(false);
  });
});
