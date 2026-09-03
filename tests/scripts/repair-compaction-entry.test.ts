/**
 * Tests for scripts/repair-compaction-entry.js
 *
 * Exercises the pure core (planRepairs) and the CLI entry (main) against
 * fixture durable branches. No live database is touched.
 */
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Import the script's exported pure functions and CLI entry.
// The script is plain .js with ESM dynamic imports for pi-agent-core and
// CJS require for pg. Vitest resolves it through the path alias.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = await import('../../scripts/repair-compaction-entry.js');

const { planRepairs, main } = mod as {
  planRepairs: (
    branch: Array<Record<string, unknown>>,
    settings: { enabled: boolean; reserveTokens: number; keepRecentTokens: number },
  ) => Promise<Array<{ entryId: string; oldId: string; newId: string; sql: string }>>;
  main: (argv: string[]) => Promise<number>;
};

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Build a minimal message entry shaped like a pi SessionTreeEntry row. */
function msgEntry(
  id: string,
  parentId: string | null,
  role: string,
  content: string,
): Record<string, unknown> {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-09-03T00:00:00.000Z',
    message: { role, content },
  };
}

/**
 * Build a compaction entry whose firstKeptEntryId may be phantom (not
 * present in the branch before this row).
 */
function compactionEntry(
  id: string,
  parentId: string,
  firstKeptEntryId: string,
  summary = 'prior context summary',
): Record<string, unknown> {
  return {
    type: 'compaction',
    id,
    parentId,
    timestamp: '2026-09-03T00:00:01.000Z',
    summary,
    firstKeptEntryId,
    tokensBefore: 50000,
  };
}

/** Settings that match the production floor for a 128K context window. */
const SETTINGS = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 32000,
};

// ---------------------------------------------------------------------------
// (a) Phantom firstKeptEntryId yields a planned UPDATE
// ---------------------------------------------------------------------------
describe('planRepairs', () => {
  it('detects phantom firstKeptEntryId and plans a recomputed UPDATE', async () => {
    const branch = [
      msgEntry('aa000001', null, 'user', 'Hello'),
      msgEntry('aa000002', 'aa000001', 'assistant', 'Hi there'),
      msgEntry('aa000003', 'aa000002', 'user', 'Tell me more'),
      msgEntry('aa000004', 'aa000003', 'assistant', 'Sure thing'),
      msgEntry('aa000005', 'aa000004', 'user', 'Another message'),
      // Compaction referencing a phantom id not in the branch before it.
      compactionEntry('comp01', 'aa000005', 'zz999999', 'Summary of context'),
    ];

    const plans = await planRepairs(branch, SETTINGS);

    expect(plans).toHaveLength(1);
    expect(plans[0].entryId).toBe('comp01');
    expect(plans[0].oldId).toBe('zz999999');
    // The new id must differ from the phantom and must exist in the branch
    // prefix before the compaction row.
    expect(plans[0].newId).not.toBe('zz999999');
    expect(branch.some((e) => e.id === plans[0].newId && e.type === 'message')).toBe(true);
    expect(plans[0].sql).toContain('SET data');
    expect(plans[0].sql).toContain('firstKeptEntryId');
  });

  // -----------------------------------------------------------------------
  // (b) Valid tree yields zero plans
  // -----------------------------------------------------------------------
  it('returns zero plans for a valid tree', async () => {
    const branch = [
      msgEntry('bb000001', null, 'user', 'Hello'),
      msgEntry('bb000002', 'bb000001', 'assistant', 'Hi there'),
      msgEntry('bb000003', 'bb000002', 'user', 'More'),
      // Compaction whose firstKeptEntryId is a real earlier entry.
      compactionEntry('comp02', 'bb000003', 'bb000002', 'Valid summary'),
    ];

    const plans = await planRepairs(branch, SETTINGS);

    expect(plans).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // (c) Dry-run prints the planned SQL text without executing
  // -----------------------------------------------------------------------
  it('dry-run prints SQL without executing (no DATABASE_URL)', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const originalDbUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const exitCode = await main(['--session', '13dd023b-322f-4631-8a7d-d46fc26011e2']);
      expect(exitCode).toBe(2);
      const output = logs.join('\n');
      expect(output).toContain('REPAIR_UNAVAILABLE');
    } finally {
      vi.restoreAllMocks();
      if (originalDbUrl !== undefined) {
        process.env.DATABASE_URL = originalDbUrl;
      }
    }
  });

  // -----------------------------------------------------------------------
  // (d) main([]) without DATABASE_URL prints REPAIR_UNAVAILABLE and exits 2
  // -----------------------------------------------------------------------
  it('main() without DATABASE_URL prints REPAIR_UNAVAILABLE and returns 2', async () => {
    const originalDbUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    try {
      const exitCode = await main([]);
      expect(exitCode).toBe(2);
      const output = logs.join('\n');
      expect(output).toContain('REPAIR_UNAVAILABLE');
    } finally {
      vi.restoreAllMocks();
      if (originalDbUrl !== undefined) {
        process.env.DATABASE_URL = originalDbUrl;
      }
    }
  });

  // -----------------------------------------------------------------------
  // (e) Multiple phantom rows each get their own plan
  // -----------------------------------------------------------------------
  it('handles multiple compaction rows with one phantom', async () => {
    const branch = [
      msgEntry('dd000001', null, 'user', 'A'),
      msgEntry('dd000002', 'dd000001', 'assistant', 'B'),
      msgEntry('dd000003', 'dd000002', 'user', 'C'),
      msgEntry('dd000004', 'dd000003', 'assistant', 'D'),
      // First compaction with valid id.
      compactionEntry('comp04', 'dd000004', 'dd000002', 'Summary 1'),
      msgEntry('dd000005', 'dd000004', 'user', 'E'),
      // Second compaction with phantom id.
      compactionEntry('comp05', 'dd000005', 'zz_phantom', 'Summary 2'),
    ];

    const plans = await planRepairs(branch, SETTINGS);

    expect(plans).toHaveLength(1);
    expect(plans[0].entryId).toBe('comp05');
  });
});
