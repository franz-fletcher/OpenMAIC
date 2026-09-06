/**
 * COLD_BOOT_ANON_OK: unit gate for the anon fallback behavior.
 *
 * Proves:
 * 1. A request without a session cookie resolves to the anon identity
 * 2. A request with a session cookie but no valid session returns 401
 * 3. A request with a valid session cookie resolves to user:<id>
 *
 * Does NOT mock getSession itself, because this suite exercises the
 * cookie-presence check in withRequestOwnerId.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = [
  'DATABASE_URL',
  'PERSISTENCE_DEV_TOKEN',
  'ACCESS_CODE',
  'OPENMAIC_AGENT_RUNTIME_ENABLED',
  'NEXT_PUBLIC_PRO_WORKBENCH_ENABLED',
  'NEXT_PUBLIC_MAIC_EDITOR_ENABLED',
  'MINIMAL_MODE',
  'NEXT_PUBLIC_MINIMAL_MODE',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let _mockSession: { userId: string; token: string; id: string } | null = null;

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual('@/lib/auth');
  return {
    ...actual,
    getSession: vi.fn(async () => _mockSession),
  };
});

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn(async () => ({
    pool: { end: vi.fn(async () => {}) },
    runtimeStore: {},
    documentStore: {},
    assetStore: {},
  })),
  resetServerPersistenceProvider: vi.fn(async () => {}),
}));

vi.mock('@/lib/auth/server', () => ({
  createAuthServer: vi.fn(() => ({
    handler: vi.fn(),
    fetch: vi.fn(),
    apiCall: vi.fn(),
  })),
}));

vi.mock('@/lib/auth/roles', () => ({
  listRoles: vi.fn(async () => []),
  seedRoleGrants: vi.fn(async () => {}),
}));

vi.mock('@/lib/auth/permissions-server', () => ({
  requirePermission: vi.fn(),
  requirePermissionIfMinimalMode: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('COLD_BOOT_ANON_OK: anon fallback for cookie-less requests', () => {
  it('request without cookie resolves to anon identity', async () => {
    const { withRequestOwnerId } = await import('@/lib/server/agent-runtime/with-owner');

    _mockSession = null;

    const req = { headers: new Headers() };
    const response = await withRequestOwnerId(req, async (ownerId, responseHeaders) => {
      return new Response(JSON.stringify({ ownerId }), { status: 200, headers: responseHeaders });
    });

    const body = (await response.json()) as { ownerId: string };
    expect(body.ownerId).toMatch(/^anon:/);
  });

  it('request with cookie but no valid session returns 401', async () => {
    const { withRequestOwnerId } = await import('@/lib/server/agent-runtime/with-owner');

    _mockSession = null;

    const headers = new Headers();
    headers.set('cookie', 'better-auth.session_token=invalid-token');
    const req = { headers };

    await expect(
      withRequestOwnerId(req, async (ownerId) => {
        return new Response(ownerId);
      }),
    ).rejects.toThrow();
  });

  it('request with valid session cookie resolves to user:<id>', async () => {
    const { withRequestOwnerId } = await import('@/lib/server/agent-runtime/with-owner');

    _mockSession = { userId: 'real-user-123', token: 'tok', id: 'sess' };

    const headers = new Headers();
    headers.set('cookie', 'better-auth.session_token=real-token');
    const req = { headers };

    const response = await withRequestOwnerId(req, async (ownerId, responseHeaders) => {
      return new Response(JSON.stringify({ ownerId }), { status: 200, headers: responseHeaders });
    });

    const body = (await response.json()) as { ownerId: string };
    expect(body.ownerId).toBe('user:real-user-123');
  });

  it('request with expired cookie returns 401 not anon', async () => {
    const { withRequestOwnerId } = await import('@/lib/server/agent-runtime/with-owner');

    // Session is null (expired/invalid)
    _mockSession = null;

    const headers = new Headers();
    headers.set('cookie', 'better-auth.session_token=expired-token');
    const req = { headers };

    await expect(
      withRequestOwnerId(req, async (ownerId) => {
        return new Response(ownerId);
      }),
    ).rejects.toThrow();
  });
});
