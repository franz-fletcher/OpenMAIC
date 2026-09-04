import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryCalls: [] as { text: string; params?: unknown[] }[],
  // Track which owner_ids have been claimed
  claimedOwners: new Set<string>(),
}));

vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({
    pool: {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        mocks.queryCalls.push({ text, params });

        if (text.includes('UPDATE')) {
          const targetOwnerId = params?.[1] as string;
          const sourceOwnerId = params?.[0] as string;

          // If the source rows have already been claimed by someone else,
          // the WHERE clause finds no matching rows
          if (mocks.claimedOwners.has(sourceOwnerId)) {
            return { rows: [] };
          }

          // Mark as claimed
          mocks.claimedOwners.add(sourceOwnerId);
          // Return 8 rows (one per table)
          return {
            rows: [
              { _mark: 1 },
              { _mark: 1 },
              { _mark: 1 },
              { _mark: 1 },
              { _mark: 1 },
              { _mark: 1 },
              { _mark: 1 },
              { _mark: 1 },
            ],
          };
        }

        if (text.includes('SELECT')) {
          return { rows: [] };
        }

        if (text.includes('DELETE')) {
          return { rows: [] };
        }

        return { rows: [] };
      }),
    },
  }),
}));

import { claimAnonOwnership } from '@/lib/auth/claim';

describe('adversarial claim scenarios', () => {
  beforeEach(() => {
    mocks.queryCalls.length = 0;
    mocks.claimedOwners.clear();
    vi.clearAllMocks();
  });

  it('second claim on already-claimed rows returns 0 (no double-claim)', async () => {
    // First claim: user:victim claims anon:uuid-1
    const firstCount = await claimAnonOwnership('uuid-1', 'victim');
    expect(firstCount).toBe(8);

    // Second claim: user:attacker tries to claim the same anon:uuid-1
    // The rows now have owner_id = 'user:victim', not 'anon:uuid-1'
    // So the WHERE clause finds no matching rows
    const secondCount = await claimAnonOwnership('uuid-1', 'attacker');
    expect(secondCount).toBe(0);
  });

  it('concurrent claims for different anon ids do not interfere', async () => {
    // Two different anon ids claimed by two different users
    const count1 = await claimAnonOwnership('uuid-a', 'user-a');
    const count2 = await claimAnonOwnership('uuid-b', 'user-b');

    expect(count1).toBe(8);
    expect(count2).toBe(8);
  });

  it('claim is idempotent: re-running changes nothing', async () => {
    const firstCount = await claimAnonOwnership('uuid-1', 'user-1');
    const secondCount = await claimAnonOwnership('uuid-1', 'user-1');

    // Second run should find no rows (already claimed by user-1)
    expect(firstCount).toBe(8);
    expect(secondCount).toBe(0);
  });
});
