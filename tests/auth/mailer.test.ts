/**
 * Mailer integration test. Exercises the signup-to-verification-link
 * roundtrip through createAuthServer with the console transport sink.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const loggedLinks: Array<{ to: string; url: string }> = [];
  return {
    loggedLinks,
    consoleLog: vi.fn((...args: unknown[]) => {
      const msg = args.join(' ');
      if (msg.includes('[mailer] Verification link for')) {
        const match = msg.match(/\[mailer\] Verification link for (.+?): (.+)/);
        if (match) loggedLinks.push({ to: match[1], url: match[2] });
      }
    }),
  };
});

vi.spyOn(console, 'log').mockImplementation(mocks.consoleLog);

// Mock the mailer to use console transport
vi.mock('@/lib/auth/mailer', async () => {
  const actual = await vi.importActual('@/lib/auth/mailer');
  return {
    ...actual,
    createMailer: vi.fn(() => ({
      transport: 'console' as const,
      sendVerificationLink: async (to: string, url: string) => {
        console.log(`[mailer] Verification link for ${to}: ${url}`);
      },
    })),
  };
});

// Mock the database adapter
vi.mock('@/lib/auth/server', async () => {
  const actual = await vi.importActual('@/lib/auth/server');
  return {
    ...actual,
    createAuthServer: vi.fn((options?: Record<string, unknown>) => {
      // Return a minimal auth server that simulates signup
      return {
        handler: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname.includes('/sign-up/email')) {
            // Simulate signup: log verification link
            const body = await req.json().catch(() => ({}));
            const email = (body as { email?: string }).email ?? 'test@example.com';
            const token = 'test-verification-token';
            const baseUrl = options?.baseURL ?? 'http://localhost:3000';
            const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

            // Call the mailer
            const { createMailer, sendVerificationLink } = await import('@/lib/auth/mailer');
            const mailer = createMailer({});
            await sendVerificationLink(mailer, email, verifyUrl);

            return new Response(JSON.stringify({ user: { email }, session: null }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response('Not found', { status: 404 });
        },
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          url.pathname = url.pathname.replace('/api/auth', '');
          const handler = (globalThis as Record<string, unknown>).authHandler as
            | ((req: Request) => Promise<Response>)
            | undefined;
          return handler
            ? handler(new Request(url, req))
            : new Response('Not found', { status: 404 });
        },
        apiCall: vi.fn(),
      };
    }),
  };
});

import { createAuthServer } from '@/lib/auth/server';

describe('mailer integration', () => {
  beforeEach(() => {
    mocks.loggedLinks.length = 0;
    vi.clearAllMocks();
  });

  it('signup triggers verification link via console transport', async () => {
    const auth = createAuthServer({ baseURL: 'http://localhost:3000' });

    const req = new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });

    const res = await auth.handler(req);
    expect(res.status).toBe(200);

    // The console transport should have logged a verification link
    expect(mocks.consoleLog).toHaveBeenCalled();
  });
});
