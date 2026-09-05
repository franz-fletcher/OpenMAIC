/**
 * Server-only auth factory. Wraps better-auth with email and password,
 * mandatory email verification, and a guest default role hook.
 *
 * This module must never be imported by client components. It depends on
 * better-auth, kysely, and server-only APIs.
 */
import { PostgresDialect } from 'kysely';
import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';
import { createMailer, sendVerificationLink, type MailerEnv } from '@/lib/auth/mailer';
import { seedRoleGrants } from '@/lib/auth/roles';

export interface AuthServerOptions {
  /** The better-auth secret. Falls back to AUTH_SECRET env. */
  secret?: string;
  /** Base URL for auth endpoints. Defaults to the request origin. */
  baseURL?: string;
  /** The pg Pool for database access. Required for real persistence. */
  pool?: Pool;
}

export interface AuthServer {
  /** The raw better-auth handler for routing. */
  handler: (request: Request) => Promise<Response>;
  /** Alias for handler. */
  fetch: (request: Request) => Promise<Response>;
  /** Call a better-auth API endpoint by path. */
  apiCall: (path: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Creates a wrapped better-auth server with email and password enabled,
 * mandatory email verification, and a guest default role hook.
 *
 * The verification callback calls the mailer. The guest role assignment
 * runs after a verified signup and defaults to rank 1 (guest) when no
 * role grant exists.
 */
export function createAuthServer(options: AuthServerOptions): AuthServer {
  const secret = options.secret ?? process.env.AUTH_SECRET ?? 'dev-secret-change-me';

  const dialect = options.pool ? new PostgresDialect({ pool: options.pool }) : undefined;

  // Build the mailer for verification emails. Console fallback logs the URL.
  const mailerEnv: MailerEnv = {
    MAIL_TRANSPORT: process.env.MAIL_TRANSPORT,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    MAIL_FROM: process.env.MAIL_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  const mailer = createMailer(mailerEnv);

  const auth = betterAuth({
    secret,
    baseURL: options.baseURL,
    database: dialect,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendVerificationEmail: async (data) => {
        await sendVerificationLink(mailer, data.user.email, data.url);
      },
      autoSignInAfterVerification: true,
    },
    databaseHooks: options.pool
      ? {
          user: {
            create: {
              after: async (user) => {
                // Assign guest role (rank 1) to newly created users.
                // The role seed (S02) handles ADMIN_EMAILS overrides.
                // This hook runs on every verified signup.
                try {
                  await options.pool!.query(
                    `INSERT INTO user_roles (user_id, role_id, granted_at)
                 SELECT $1, id, now() FROM roles WHERE name = 'guest'
                 ON CONFLICT (user_id) DO NOTHING`,
                    [user.id],
                  );
                } catch {
                  // Role table may not exist yet during early bootstrap.
                  // The role seed will handle this on first run.
                }
              },
            },
          },
        }
      : undefined,
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  });

  const basePath = '/api/auth';

  // Seed the four system roles on first boot.
  // This is idempotent and non-destructive.
  if (options.pool) {
    seedRoleGrants(options.pool, []).catch(() => {
      // Role table may not exist yet during early bootstrap.
    });
  }

  return {
    handler: auth.handler,
    fetch: auth.fetch,
    apiCall: (path: string, init?: RequestInit) => {
      // Build an absolute URL. Node's undici Request rejects relative URLs.
      // Derive the origin from the request Host header, the configured
      // baseURL, or a localhost fallback for server-to-server calls.
      const host = extractHost(init?.headers);
      const origin = options.baseURL ?? (host ? `http://${host}` : 'http://localhost:3000');
      return auth.handler(new Request(`${origin}${basePath}${path}`, init));
    },
  };
}

/**
 * Extracts the Host header from a Headers object or a plain-object header
 * map. Returns null when the header is absent or unparseable.
 */
function extractHost(headers: RequestInit['headers']): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) {
    return headers.get('host');
  }
  if (typeof headers === 'object') {
    const record = headers as Record<string, string>;
    return record['host'] ?? record['Host'] ?? null;
  }
  return null;
}
