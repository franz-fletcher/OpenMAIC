import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryCalls: [] as { text: string; params?: unknown[] }[],
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        mocks.queryCalls.push({ text, params });
        // Return a count result for UPDATE queries
        if (text.includes('UPDATE')) {
          return { rows: [{ count: params?.[2] ?? 1 }] };
        }
        return { rows: [] };
      }),
    },
  }),
}));

import { claimAnonOwnership } from '@/lib/auth/claim';

describe('claimAnonOwnership', () => {
  beforeEach(() => {
    mocks.queryCalls.length = 0;
    vi.clearAllMocks();
  });

  it('updates all 8 owner columns from anon:<id> to user:<id>', async () => {
    const count = await claimAnonOwnership('anon-uuid-1', 'user-123');

    // Should have 8 UPDATE calls (one per table)
    const updateCalls = mocks.queryCalls.filter((c) => c.text.includes('UPDATE'));
    expect(updateCalls.length).toBe(8);

    // Each UPDATE should use the correct prefix pattern
    for (const call of updateCalls) {
      expect(call.text).toContain('UPDATE');
      expect(call.text).toContain('owner_id');
      expect(call.params).toContain('anon:anon-uuid-1');
      expect(call.params).toContain('user:user-123');
    }
  });

  it('returns the total row count', async () => {
    const count = await claimAnonOwnership('anon-uuid-1', 'user-123');
    expect(count).toBe(8);
  });
});
