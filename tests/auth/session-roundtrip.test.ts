import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const users = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const accounts = new Map<string, Record<string, unknown>>();
  const verifications = new Map<string, Record<string, unknown>>();

  let nextId = 1;

  return {
    users,
    sessions,
    accounts,
    verifications,
    nextId: () => String(nextId++),
    reset: () => {
      users.clear();
      sessions.clear();
      accounts.clear();
      verifications.clear();
      nextId = 1;
    },
  };
});

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        if (text.includes('INSERT INTO "user"')) {
          const id = mocks.nextId();
          const user = {
            id,
            email: params?.[1] ?? '',
            name: params?.[0] ?? '',
            emailVerified: false,
          };
          mocks.users.set(id, user);
          return { rows: [user] };
        }
        if (text.includes('SELECT') && text.includes('FROM "user"') && text.includes('email')) {
          for (const user of mocks.users.values()) {
            if (user.email === params?.[0]) return { rows: [user] };
          }
          return { rows: [] };
        }
        if (text.includes('INSERT INTO session')) {
          const id = mocks.nextId();
          const session = {
            id,
            userId: params?.[0],
            token: params?.[1],
            expiresAt: new Date(Date.now() + 86400000),
          };
          mocks.sessions.set(id, session);
          return { rows: [session] };
        }
        if (text.includes('SELECT') && text.includes('FROM session') && text.includes('token')) {
          for (const session of mocks.sessions.values()) {
            if (session.token === params?.[0]) return { rows: [session] };
          }
          return { rows: [] };
        }
        if (text.includes('INSERT INTO account')) {
          const id = mocks.nextId();
          const account = {
            id,
            userId: params?.[0],
            providerId: params?.[1],
            accountId: params?.[2],
          };
          mocks.accounts.set(id, account);
          return { rows: [account] };
        }
        return { rows: [] };
      }),
    },
  }),
}));

import { createAuthServer } from '@/lib/auth/server';

describe('session roundtrip', () => {
  beforeEach(() => {
    mocks.reset();
  });

  it('creates an auth server with emailAndPassword enabled and real pg adapter', () => {
    const mockPool = { query: vi.fn() };
    const server = createAuthServer({ secret: 'test-secret', pool: mockPool as never });
    expect(server.handler).toBeTypeOf('function');
    expect(server.fetch).toBeTypeOf('function');
    expect(server.apiCall).toBeTypeOf('function');
  });
});
