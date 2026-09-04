/**
 * Better-auth catch-all route. Handles all /api/auth/* requests.
 * Server-only — depends on createAuthServer which imports better-auth.
 *
 * The incoming request URL already contains /api/auth/... from the
 * Next.js catch-all mount. We forward it unchanged to better-auth's
 * handler, which expects the full basePath prefix in its routing.
 */
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { createAuthServer } from '@/lib/auth/server';

let auth: ReturnType<typeof createAuthServer> | null = null;

async function getAuth() {
  if (!auth) {
    const connectionString = process.env.DATABASE_URL ?? '';
    const { pool } = await getServerPersistenceProvider(connectionString);
    auth = createAuthServer({ pool });
  }
  return auth;
}

export async function POST(request: Request) {
  const authServer = await getAuth();
  return authServer.handler(request);
}

export async function GET(request: Request) {
  const authServer = await getAuth();
  return authServer.handler(request);
}
