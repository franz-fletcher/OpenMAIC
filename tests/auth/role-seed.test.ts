import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryCalls: [] as { text: string; params?: unknown[] }[],
  queryResults: [] as unknown[],
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        mocks.queryCalls.push({ text, params });
        const result = mocks.queryResults.shift();
        return result ?? { rows: [] };
      }),
    },
  }),
}));

import { ROLE_RANKS, seedRoleGrants, listRoles } from '@/lib/auth/roles';
import { loadRoleDefaults } from '@/lib/auth/roles-config';

describe('ROLE_RANKS', () => {
  it('has the correct shape', () => {
    expect(ROLE_RANKS).toEqual({
      ANONYMOUS: 0,
      GUEST: 1,
      LEARNER: 2,
      CREATOR: 3,
      ADMIN: 4,
    });
  });
});

describe('seedRoleGrants', () => {
  beforeEach(() => {
    mocks.queryCalls.length = 0;
    mocks.queryResults.length = 0;
    vi.clearAllMocks();
  });

  it('seeds four system roles idempotently', async () => {
    const mockQuery = vi.fn(async () => ({ rows: [] }));
    const mockQueryable = { query: mockQuery } as never;
    const count = await seedRoleGrants(mockQueryable, []);
    expect(count).toBe(0);
    // 4 system role upserts
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it('returns applied count for configured grants', async () => {
    const mockQuery = vi.fn(async (text: string) => {
      if (text.includes('SELECT id FROM "user"')) return { rows: [{ id: 'user-1' }] };
      if (text.includes('SELECT id FROM roles')) return { rows: [{ id: 'role-admin' }] };
      return { rows: [] };
    });
    const mockQueryable = { query: mockQuery } as never;
    const count = await seedRoleGrants(mockQueryable, [
      { email: 'admin@example.com', role: 'admin' },
    ]);
    expect(count).toBe(1);
  });
});

describe('listRoles', () => {
  it('returns all roles with ranks', async () => {
    const mockQuery = vi.fn(async () => ({
      rows: [
        {
          id: 'r1',
          name: 'guest',
          rank: 1,
          is_system: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'r2',
          name: 'admin',
          rank: 4,
          is_system: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    }));
    const mockQueryable = { query: mockQuery } as never;
    const roles = await listRoles(mockQueryable);
    expect(roles).toHaveLength(2);
    expect(roles[0].rank).toBe(1);
    expect(roles[1].rank).toBe(4);
  });
});

describe('loadRoleDefaults', () => {
  const originalEnv = process.env.ADMIN_EMAILS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalEnv;
  });

  it('returns empty defaults when no env or yaml', () => {
    delete process.env.ADMIN_EMAILS;
    const defaults = loadRoleDefaults();
    expect(defaults.adminEmails).toEqual([]);
  });

  it('parses ADMIN_EMAILS from env', () => {
    process.env.ADMIN_EMAILS = 'a@test.com,b@test.com';
    const defaults = loadRoleDefaults();
    expect(defaults.adminEmails).toEqual(['a@test.com', 'b@test.com']);
  });
});
