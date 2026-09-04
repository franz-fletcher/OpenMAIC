/**
 * Public auth surface. The only module that re-exports better-auth types
 * and the session/role helpers. Nothing outside lib/auth imports better-auth.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { createAuthServer, type AuthServer } from '@/lib/auth/server';
import { listRoles as _listRoles, type Role } from '@/lib/auth/roles';

export type { Role } from '@/lib/auth/roles';

/** Minimal session shape for the public surface. */
export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

let cachedAuth: AuthServer | null = null;

async function getAuth(): Promise<AuthServer> {
  if (!cachedAuth) {
    const connectionString = process.env.DATABASE_URL ?? '';
    const { pool } = await getServerPersistenceProvider(connectionString);
    cachedAuth = createAuthServer({ pool });
  }
  return cachedAuth;
}

/**
 * Returns the session for valid cookies, null otherwise.
 *
 * Reads the session token from the cookie header in the provided Headers
 * object and looks it up through better-auth's session API.
 */
export async function getSession(headers: Headers): Promise<Session | null> {
  const auth = await getAuth();
  try {
    const response = await auth.apiCall('/get-session', { headers });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    const session = data.session as Record<string, unknown> | undefined;
    if (!session) return null;
    return {
      id: String(session.id),
      userId: String(session.userId),
      token: String(session.token),
      expiresAt: new Date(session.expiresAt as string | number),
      createdAt: new Date(session.createdAt as string | number),
      updatedAt: new Date(session.updatedAt as string | number),
      ipAddress: (session.ipAddress as string) ?? null,
      userAgent: (session.userAgent as string) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Returns the session or a 401-style refusal.
 *
 * Throws a Response object when no valid session exists. Callers should
 * catch and return the thrown Response.
 */
export async function requireSession(headers: Headers): Promise<Session> {
  const session = await getSession(headers);
  if (!session) {
    throw new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return session;
}

/**
 * Returns all roles ordered by rank ascending.
 */
export async function listRoles(queryable: Queryable): Promise<Role[]> {
  return _listRoles(queryable);
}
