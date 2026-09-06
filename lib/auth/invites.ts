/**
 * Invite service. Creates, consumes, lists, and revokes single-use
 * invite codes for email-based role grants.
 *
 * The code is a random string stored hashed (SHA-256). The consumer
 * atomically marks one unused, unexpired row used and returns the
 * invited role in one client transaction with the role grant.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { createHash, randomBytes } from 'node:crypto';

/** Invite row shape returned by listPendingInvites. */
export interface Invite {
  id: string;
  email: string;
  roleName: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  usedBy: string | null;
  createdBy: string;
  createdAt: Date;
}

/** Default invite expiry: 7 days. */
const INVITE_EXPIRY_DAYS = 7;

/**
 * Hashes a plaintext code with SHA-256.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Generates a random invite code and returns both the plaintext
 * (for the URL) and the hash (for storage).
 */
function generateCode(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(24).toString('base64url');
  return { plaintext, hash: hashCode(plaintext) };
}

/**
 * Creates an invite for an email and role with a default 7-day expiry.
 *
 * Returns the invite with the plaintext code (for the URL). The hash
 * is stored in the database. The caller sends the accept link through
 * the mailer.
 */
export async function createInvite(
  queryable: Queryable,
  email: string,
  roleName: string,
  createdBy: string,
  expiresAt?: Date,
): Promise<Invite & { code: string }> {
  const { plaintext, hash } = generateCode();
  const expiry = expiresAt ?? new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const result = await queryable.query<{
    id: string;
    email: string;
    role_name: string;
    expires_at: Date;
    created_by: string;
    created_at: Date;
  }>(
    `INSERT INTO invites (email, role_name, code, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, role_name, expires_at, created_by, created_at`,
    [email.toLowerCase(), roleName, hash, expiry.toISOString(), createdBy],
  );

  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    roleName: row.role_name,
    expiresAt: new Date(row.expires_at),
    usedAt: null,
    revokedAt: null,
    usedBy: null,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    code: plaintext,
  };
}

/**
 * Atomically consumes an invite code for a user.
 *
 * Uses `UPDATE ... WHERE used_at IS NULL AND revoked_at IS NULL
 * AND expires_at > now() RETURNING` to mark one unused row used.
 * Returns the invited role name on success, null otherwise.
 *
 * The caller must insert the role grant in the same client
 * transaction. This function does NOT manage transactions.
 */
export async function consumeInvite(
  queryable: Queryable,
  code: string,
  userId: string,
): Promise<string | null> {
  const hash = hashCode(code);

  const result = await queryable.query<{
    role_name: string;
  }>(
    `UPDATE invites
     SET used_at = now(), used_by = $2
     WHERE code = $1
       AND used_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()
     RETURNING role_name`,
    [hash, userId],
  );

  return result.rows.length > 0 ? result.rows[0].role_name : null;
}

/**
 * Lists all pending invites: unused, unrevoked, and unexpired.
 */
export async function listPendingInvites(queryable: Queryable): Promise<Invite[]> {
  const result = await queryable.query<{
    id: string;
    email: string;
    role_name: string;
    expires_at: Date;
    used_at: Date | null;
    revoked_at: Date | null;
    used_by: string | null;
    created_by: string;
    created_at: Date;
  }>(
    `SELECT id, email, role_name, expires_at, used_at, revoked_at, used_by, created_by, created_at
     FROM invites
     WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    roleName: row.role_name,
    expiresAt: new Date(row.expires_at),
    usedAt: row.used_at ? new Date(row.used_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    usedBy: row.used_by,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  }));
}

/**
 * Revokes an invite by id so the accept link stops working.
 */
export async function revokeInvite(queryable: Queryable, id: string): Promise<void> {
  await queryable.query(
    `UPDATE invites SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
}

/**
 * Looks up an invite by code for read-only validation on the accept page.
 * Returns null if the code is invalid, used, revoked, or expired.
 */
export async function lookupInvite(
  queryable: Queryable,
  code: string,
): Promise<{ email: string; roleName: string; expiresAt: Date } | null> {
  const hash = hashCode(code);

  const result = await queryable.query<{
    email: string;
    role_name: string;
    expires_at: Date;
  }>(
    `SELECT email, role_name, expires_at
     FROM invites
     WHERE code = $1
       AND used_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()`,
    [hash],
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    email: row.email,
    roleName: row.role_name,
    expiresAt: new Date(row.expires_at),
  };
}

/**
 * Validates that a role name exists in the roles table.
 */
export async function isValidRole(queryable: Queryable, roleName: string): Promise<boolean> {
  const result = await queryable.query<{ id: string }>(`SELECT id FROM roles WHERE name = $1`, [
    roleName,
  ]);
  return result.rows.length > 0;
}
