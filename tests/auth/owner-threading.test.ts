import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth session module
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

// Mock the owner module
vi.mock('@/lib/server/agent-runtime/owner', () => ({
  resolveRequestOwnerId: vi.fn(),
}));

import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import { getSession } from '@/lib/auth';
import { resolveRequestOwnerId } from '@/lib/server/agent-runtime/owner';

const mockGetSession = vi.mocked(getSession);
const mockResolveRequestOwnerId = vi.mocked(resolveRequestOwnerId);

function makeHeaders(cookie?: string): Headers {
  const h = new Headers();
  if (cookie) h.set('cookie', cookie);
  return h;
}

describe('withRequestOwnerId threading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveRequestOwnerId.mockReturnValue('anon:test-uuid');
  });

  it('threads authenticatedOwnerId from session when signed in', async () => {
    mockGetSession.mockResolvedValue({
      id: 'session-1',
      userId: 'user-123',
      token: 'tok',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    });

    const handler = vi.fn(async (ownerId: string) => {
      return new Response(`owner:${ownerId}`);
    });

    const req = new Request('http://localhost/api/test', {
      headers: makeHeaders('better-auth.session_token=valid-token'),
    });

    const res = await withRequestOwnerId(req, handler);
    const body = await res.text();

    // Should pass 'user:user-123' to the handler
    expect(body).toBe('owner:user:user-123');
    expect(handler).toHaveBeenCalledWith('user:user-123', expect.any(Headers));
  });

  it('falls back to anon identity when no session exists', async () => {
    mockGetSession.mockResolvedValue(null);
    mockResolveRequestOwnerId.mockReturnValue('anon:fallback-uuid');

    const handler = vi.fn(async (ownerId: string) => {
      return new Response(`owner:${ownerId}`);
    });

    const req = new Request('http://localhost/api/test', {
      headers: makeHeaders(),
    });

    const res = await withRequestOwnerId(req, handler);
    const body = await res.text();

    expect(body).toBe('owner:anon:fallback-uuid');
    expect(handler).toHaveBeenCalledWith('anon:fallback-uuid', expect.any(Headers));
  });
});
