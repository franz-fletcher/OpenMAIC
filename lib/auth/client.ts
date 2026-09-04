/**
 * Browser-safe auth client. Wraps better-auth's client-side helpers
 * for signup, sign in, sign out, and verification resend.
 *
 * This module must never be imported by server components. The import
 * graph stays client-only (no node: imports).
 */

export interface AuthClientOptions {
  /** Base URL for auth endpoints. Defaults to /api/auth. */
  baseURL?: string;
}

export interface AuthClient {
  /** Sign up with email and password. */
  signUp: (data: {
    email: string;
    password: string;
    name?: string;
  }) => Promise<{ user?: { id: string; email: string }; error?: string }>;
  /** Sign in with email and password. */
  signIn: (data: { email: string; password: string }) => Promise<{
    user?: { id: string; email: string };
    session?: { token: string };
    error?: string;
    code?: string;
  }>;
  /** Sign out the current user. */
  signOut: () => Promise<void>;
  /** Resend the verification email. */
  resendVerification: (data: { email: string }) => Promise<{ error?: string }>;
}

/**
 * Creates a client-side auth helper that talks to the better-auth
 * catch-all route at /api/auth/*.
 */
export function createAuthClient(opts: AuthClientOptions): AuthClient {
  const baseURL = opts.baseURL ?? '/api/auth';

  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${baseURL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data.message ?? 'Request failed' } as T;
    }
    return data as T;
  }

  return {
    signUp: (data) => post('/sign-up/email', data),
    signIn: (data) => post('/sign-in/email', data),
    signOut: () => fetch(`${baseURL}/sign-out`, { method: 'POST' }).then(() => {}),
    resendVerification: (data) => post('/send-verification-email', data),
  };
}
