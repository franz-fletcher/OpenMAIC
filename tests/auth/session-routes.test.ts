import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signupResult: { user: { id: 'u1', email: 'test@example.com', name: '' }, session: null },
  signInResult: {
    user: { id: 'u1', email: 'test@example.com', name: '' },
    session: { id: 's1', token: 'tok' },
  },
  verifyResult: {
    user: { id: 'u1', email: 'test@example.com', name: '' },
    session: { id: 's1', token: 'tok' },
  },
  resendResult: { status: 200 },
}));

vi.mock('@/lib/auth/server', () => ({
  createAuthServer: () => ({
    handler: vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/sign-up/email')) {
        return Response.json(mocks.signupResult);
      }
      if (url.pathname.endsWith('/sign-in/email')) {
        return Response.json(mocks.signInResult);
      }
      if (url.pathname.endsWith('/verify-email')) {
        return Response.json(mocks.verifyResult);
      }
      if (url.pathname.endsWith('/send-verification-email')) {
        return Response.json(mocks.resendResult);
      }
      return Response.json({ error: 'not found' }, { status: 404 });
    }),
    fetch: vi.fn(),
    apiCall: vi.fn(),
  }),
}));

import { POST as authSignup } from '@/app/api/auth/[...path]/route';
import { POST as authSignIn } from '@/app/api/auth/[...path]/route';

function makeRequest(path: string, body?: Record<string, unknown>) {
  return new Request(`http://localhost/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('auth session routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signup returns user data', async () => {
    const req = makeRequest('/sign-up/email', {
      email: 'test@example.com',
      password: 'password123',
    });
    const res = await authSignup(req);
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe('test@example.com');
  });

  it('sign-in returns session', async () => {
    const req = makeRequest('/sign-in/email', {
      email: 'test@example.com',
      password: 'password123',
    });
    const res = await authSignIn(req);
    const body = await res.json();
    expect(body.session).toBeDefined();
    expect(body.session.token).toBe('tok');
  });

  it('verify-email returns session on success', async () => {
    const req = makeRequest('/verify-email', { token: 'valid-token' });
    const res = await authSignup(req);
    const body = await res.json();
    expect(body.session).toBeDefined();
  });
});
