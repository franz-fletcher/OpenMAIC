import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryResults: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: {
      query: vi.fn(async () => ({ rows: mocks.queryResults })),
    },
  }),
}));

import { ensureAuthSchema } from '@/lib/auth/schema';
import { listRoles } from '@/lib/auth/index';

describe('ensureAuthSchema', () => {
  const executedStatements: string[] = [];
  const mockQueryable = {
    query: vi.fn(async (text: string) => {
      executedStatements.push(text);
      return { rows: [] };
    }),
  };

  beforeEach(() => {
    executedStatements.length = 0;
    vi.clearAllMocks();
  });

  it('creates tables idempotently', async () => {
    await ensureAuthSchema(mockQueryable as never);

    const statements = executedStatements.filter((s) => s.includes('CREATE TABLE'));
    expect(statements.length).toBeGreaterThanOrEqual(6);

    const tableNames = statements.map((s) => {
      const match = s.match(/CREATE TABLE IF NOT EXISTS "?(\w+)"?\s*\(/i);
      return match?.[1]?.toLowerCase();
    });
    expect(tableNames).toContain('user');
    expect(tableNames).toContain('session');
    expect(tableNames).toContain('account');
    expect(tableNames).toContain('verification');
    expect(tableNames).toContain('roles');
    expect(tableNames).toContain('user_roles');
  });

  it('creates indexes', async () => {
    await ensureAuthSchema(mockQueryable as never);

    const indexStatements = executedStatements.filter((s) => s.includes('CREATE INDEX'));
    expect(indexStatements.length).toBeGreaterThanOrEqual(4);
  });
});

describe('listRoles', () => {
  beforeEach(() => {
    mocks.queryResults = [
      {
        id: 'role-1',
        name: 'guest',
        rank: 1,
        is_system: true,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
      {
        id: 'role-2',
        name: 'admin',
        rank: 4,
        is_system: true,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
    ];
  });

  it('returns all roles with ranks', async () => {
    const mockQuery = vi.fn(async () => ({ rows: mocks.queryResults }));
    const roles = await listRoles({ query: mockQuery } as never);
    expect(roles).toHaveLength(2);
    expect(roles[0].name).toBe('guest');
    expect(roles[0].rank).toBe(1);
    expect(roles[1].name).toBe('admin');
    expect(roles[1].rank).toBe(4);
  });
});
