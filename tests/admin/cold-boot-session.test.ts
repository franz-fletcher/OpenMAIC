/**
 * COLD_BOOT_OK: unit gate for the cold-boot session hardening.
 *
 * Proves:
 * 1. resetAuth() clears the module-scope cachedAuth
 * 2. After resetAuth, the next getAuth() rebuilds from the current provider
 * 3. The getSession retry path works (clears cache, retries once)
 *
 * Does NOT mock getSession itself, because this suite exercises the
 * readiness hardening in the session resolution path.
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

let _mockPoolEnd = vi.fn(async () => {});
let _mockApiCall = vi.fn(async () => ({
  ok: true,
  json: async () => ({
    session: {
      id: 's1',
      userId: 'u1',
      token: 't1',
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }),
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn(async () => ({
    pool: { end: _mockPoolEnd },
    runtimeStore: {},
    documentStore: {},
    assetStore: {},
  })),
  resetServerPersistenceProvider: vi.fn(async () => {
    _mockPoolEnd.mockClear();
  }),
}));

vi.mock('@/lib/auth/server', () => ({
  createAuthServer: vi.fn(() => ({
    handler: vi.fn(),
    fetch: vi.fn(),
    apiCall: _mockApiCall,
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

describe('COLD_BOOT_OK: resetAuth clears cache and getAuth rebuilds', () => {
  it('resetAuth clears cachedAuth so next getAuth rebuilds', async () => {
    const { getSession, resetAuth } = await import('@/lib/auth');
    const { createAuthServer } = await import('@/lib/auth/server');

    // First call builds the auth server
    const headers1 = new Headers();
    const session1 = await getSession(headers1);
    expect(session1).toBeDefined();
    expect(session1!.userId).toBe('u1');
    expect(createAuthServer).toHaveBeenCalledTimes(1);

    // Second call reuses the cached server
    const headers2 = new Headers();
    await getSession(headers2);
    expect(createAuthServer).toHaveBeenCalledTimes(1);

    // Reset clears the cache
    await resetAuth();

    // Next call rebuilds
    const headers3 = new Headers();
    await getSession(headers3);
    expect(createAuthServer).toHaveBeenCalledTimes(2);
  });

  it('getSession retries after cache clear on catch', async () => {
    const { getSession, resetAuth } = await import('@/lib/auth');
    const { createAuthServer } = await import('@/lib/auth/server');

    // Clear cache to force rebuild
    await resetAuth();

    // Clear the mock call history
    (createAuthServer as any).mockClear();

    let apiCallCount = 0;
    _mockApiCall.mockImplementation(async () => {
      apiCallCount++;
      if (apiCallCount === 1) {
        // First call throws (simulates stale auth)
        throw new Error('pool is ended');
      }
      // Second call succeeds (fresh auth)
      return {
        ok: true,
        json: async () => ({
          session: {
            id: 's2',
            userId: 'u2',
            token: 't2',
            expiresAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      };
    });

    const headers = new Headers();
    const session = await getSession(headers);
    expect(session).toBeDefined();
    expect(session!.userId).toBe('u2');
    // First call threw, cache was cleared, getAuth rebuilt, retry succeeded
    // createAuthServer is called twice: once for initial attempt, once for retry
    expect(createAuthServer).toHaveBeenCalledTimes(2);
  });

  it('getSession returns null when both attempts fail', async () => {
    const { getSession, resetAuth } = await import('@/lib/auth');

    await resetAuth();

    _mockApiCall.mockImplementation(async () => {
      throw new Error('persistent failure');
    });

    const headers = new Headers();
    const session = await getSession(headers);
    expect(session).toBeNull();
  });
});
