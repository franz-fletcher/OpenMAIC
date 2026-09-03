import { describe, it, expect } from 'vitest';
import {
  runWithConnection,
  scanAbortFragment,
  buildDiffLines,
  checkStageCompletion,
  PINNED_INVENTORY,
} from '../../scripts/check-stage-completion';

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

interface StageRow {
  stage: number;
  label: string;
  sceneCount: number;
}

interface EventRow {
  session_id: string;
  ts: number;
  type: string;
  data: string;
}

// ---------------------------------------------------------------------------
// Pinned inventory
// ---------------------------------------------------------------------------

describe('PINNED_INVENTORY', () => {
  it('sums to 50', () => {
    const total = PINNED_INVENTORY.reduce((s, e) => s + e.count, 0);
    expect(total).toBe(50);
  });

  it('has 7 stages with counts 8, 7, 7, 7, 7, 7, 7', () => {
    expect(PINNED_INVENTORY.map((e) => e.count)).toEqual([8, 7, 7, 7, 7, 7, 7]);
  });
});

// ---------------------------------------------------------------------------
// buildDiffLines
// ---------------------------------------------------------------------------

describe('buildDiffLines', () => {
  it('returns all-ok lines on full match', () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    const lines = buildDiffLines(stages);
    expect(lines).toHaveLength(7);
    expect(lines.every((l) => l.includes('ok'))).toBe(true);
  });

  it('reports missing count with per-stage diff', () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 0 },
      { stage: 4, label: 'Stage 4', sceneCount: 0 },
      { stage: 5, label: 'Stage 5', sceneCount: 0 },
      { stage: 6, label: 'Stage 6', sceneCount: 0 },
      { stage: 7, label: 'Stage 7', sceneCount: 0 },
    ];
    const lines = buildDiffLines(stages);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('Stage 1'))).toBe(true);
    expect(lines.some((l) => l.includes('8/8'))).toBe(true);
    expect(lines.some((l) => l.includes('Stage 3'))).toBe(true);
    expect(lines.some((l) => l.includes('0/7'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scanAbortFragment
// ---------------------------------------------------------------------------

describe('scanAbortFragment', () => {
  const marker = 1000;

  it('returns false for empty rows', () => {
    expect(scanAbortFragment([], marker)).toBe(false);
  });

  it('returns false when no abort text in data', () => {
    const rows: EventRow[] = [
      { session_id: 's1', ts: 2000, type: 'tool_execution_end', data: '{"message":"completed"}' },
    ];
    expect(scanAbortFragment(rows, marker)).toBe(false);
  });

  it('returns false for rows before marker', () => {
    const rows: EventRow[] = [
      {
        session_id: 's1',
        ts: 500,
        type: 'tool_execution_end',
        data: '{"message":"exceeded its 900000ms execution budget and was aborted"}',
      },
    ];
    expect(scanAbortFragment(rows, marker)).toBe(false);
  });

  it('matches the fragment regardless of ms value (900000)', () => {
    const rows: EventRow[] = [
      {
        session_id: 's1',
        ts: 2000,
        type: 'tool_execution_end',
        data: '{"message":"exceeded its 900000ms execution budget and was aborted"}',
      },
    ];
    expect(scanAbortFragment(rows, marker)).toBe(true);
  });

  it('matches the fragment regardless of ms value (2700000)', () => {
    const rows: EventRow[] = [
      {
        session_id: 's1',
        ts: 2000,
        type: 'tool_execution_end',
        data: '{"message":"exceeded its 2700000ms execution budget and was aborted"}',
      },
    ];
    expect(scanAbortFragment(rows, marker)).toBe(true);
  });

  it('ignores rows before marker even with abort text', () => {
    const rows: EventRow[] = [
      {
        session_id: 's1',
        ts: 500,
        type: 'tool_execution_end',
        data: '{"message":"exceeded its 900000ms execution budget and was aborted"}',
      },
      { session_id: 's1', ts: 2000, type: 'tool_execution_end', data: '{"message":"ok"}' },
    ];
    expect(scanAbortFragment(rows, marker)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkStageCompletion
// ---------------------------------------------------------------------------

describe('checkStageCompletion', () => {
  it('returns pass on full match with no aborts', () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    const result = checkStageCompletion(stages, []);
    expect(result.pass).toBe(true);
    expect(result.diffLines).toHaveLength(7);
    expect(result.diffLines.every((l) => l.includes('ok'))).toBe(true);
  });

  it('returns fail on missing count with diff', () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 0 },
      { stage: 4, label: 'Stage 4', sceneCount: 0 },
      { stage: 5, label: 'Stage 5', sceneCount: 0 },
      { stage: 6, label: 'Stage 6', sceneCount: 0 },
      { stage: 7, label: 'Stage 7', sceneCount: 0 },
    ];
    const result = checkStageCompletion(stages, []);
    expect(result.pass).toBe(false);
    expect(result.diffLines.length).toBeGreaterThan(0);
  });

  it('returns fail when abort fragment found', () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    const rows: EventRow[] = [
      {
        session_id: 's1',
        ts: 2000,
        type: 'tool_execution_end',
        data: '{"message":"exceeded its 900000ms execution budget and was aborted"}',
      },
    ];
    const result = checkStageCompletion(stages, rows, 1000);
    expect(result.pass).toBe(false);
    expect(result.abortFound).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runWithConnection: DB-injection seam tests.
//
// The helper builds a fake client factory whose query() returns canned rows
// for the three query functions (queryStageSummaries, deriveMostRecentSession
// or deriveSessionMarker, scanAbortFragmentDb). This exercises the full
// DB-touching path without a live database.
// ---------------------------------------------------------------------------

describe('runWithConnection', () => {
  const origExit = process.exit;

  /** Build a fake client whose query() dispatches on the SQL text. */
  function fakeClient(opts: {
    stages?: { id: string; name: string; sceneCount: number }[];
    marker?: { sessionId: string; marker: number } | null;
    sessionMarker?: number;
    abortFound?: boolean;
  }) {
    return {
      query(sql: string, params?: unknown[]) {
        if (sql.includes('document_stages')) {
          return Promise.resolve({
            rows: (opts.stages || []).map((s) => ({
              id: s.id,
              name: s.name,
              sceneCount: s.sceneCount,
            })),
          });
        }
        if (sql.includes('session_start') && sql.includes('ORDER BY marker DESC')) {
          // deriveMostRecentSession
          return Promise.resolve({
            rows: opts.marker
              ? [{ session_id: opts.marker.sessionId, marker: opts.marker.marker }]
              : [],
          });
        }
        if (sql.includes('session_start') && sql.includes('session_id')) {
          // deriveSessionMarker
          return Promise.resolve({
            rows: opts.sessionMarker != null ? [{ marker: opts.sessionMarker }] : [],
          });
        }
        if (sql.includes('execution budget and was aborted')) {
          return Promise.resolve({
            rows: opts.abortFound ? [{}] : [],
          });
        }
        return Promise.resolve({ rows: [] });
      },
      release() {},
    };
  }

  async function run(
    argv: string[],
    clientOpts: Parameters<typeof fakeClient>[0],
  ): Promise<{ output: string; exitCode: number }> {
    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;

    let capturedExitCode = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = (code?: number) => {
      capturedExitCode = code ?? 0;
      throw new Error('__EXIT__');
    };

    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    console.error = (...args: unknown[]) => logs.push(args.join(' '));

    const client = fakeClient(clientOpts);
    let threw = false;
    try {
      await runWithConnection(async () => client, argv);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === '__EXIT__') threw = true;
    }

    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;

    return { output: logs.join('\n'), exitCode: threw ? capturedExitCode : 0 };
  }

  it('exits 0 and prints PASS on full match with no aborts', async () => {
    const { output, exitCode } = await run([], {
      stages: [
        { id: 'stage-1', name: 'Stage 1', sceneCount: 8 },
        { id: 'stage-2', name: 'Stage 2', sceneCount: 7 },
        { id: 'stage-3', name: 'Stage 3', sceneCount: 7 },
        { id: 'stage-4', name: 'Stage 4', sceneCount: 7 },
        { id: 'stage-5', name: 'Stage 5', sceneCount: 7 },
        { id: 'stage-6', name: 'Stage 6', sceneCount: 7 },
        { id: 'stage-7', name: 'Stage 7', sceneCount: 7 },
      ],
      marker: { sessionId: 'recent', marker: 1000 },
      abortFound: false,
    });
    expect(exitCode).toBe(0);
    expect(output).toContain('COMPLETION_GATE_PASS');
    expect(output).toContain('mode: most-recent-session=recent marker=1000');
  });

  it('exits nonzero and prints FAIL on missing count with diff', async () => {
    const { output, exitCode } = await run([], {
      stages: [
        { id: 'stage-1', name: 'Stage 1', sceneCount: 8 },
        { id: 'stage-2', name: 'Stage 2', sceneCount: 7 },
        { id: 'stage-3', name: 'Stage 3', sceneCount: 0 },
      ],
      marker: { sessionId: 'recent', marker: 1000 },
      abortFound: false,
    });
    expect(exitCode).not.toBe(0);
    expect(output).toContain('COMPLETION_GATE_FAIL');
    expect(output).toContain('8/8');
    expect(output).toContain('0/7');
  });

  it('exits nonzero and prints FAIL on abort-fragment row (--session mode)', async () => {
    const { output, exitCode } = await run(['--session', 's1'], {
      stages: [
        { id: 'stage-1', name: 'Stage 1', sceneCount: 8 },
        { id: 'stage-2', name: 'Stage 2', sceneCount: 7 },
        { id: 'stage-3', name: 'Stage 3', sceneCount: 7 },
        { id: 'stage-4', name: 'Stage 4', sceneCount: 7 },
        { id: 'stage-5', name: 'Stage 5', sceneCount: 7 },
        { id: 'stage-6', name: 'Stage 6', sceneCount: 7 },
        { id: 'stage-7', name: 'Stage 7', sceneCount: 7 },
      ],
      sessionMarker: 1000,
      abortFound: true,
    });
    expect(exitCode).not.toBe(0);
    expect(output).toContain('COMPLETION_GATE_FAIL');
    expect(output).toContain('abort');
    expect(output).toContain('session=s1');
  });

  it('exits 0 with --expect-incomplete on mismatch', async () => {
    const { output, exitCode } = await run(['--expect-incomplete'], {
      stages: [
        { id: 'stage-1', name: 'Stage 1', sceneCount: 8 },
        { id: 'stage-2', name: 'Stage 2', sceneCount: 7 },
        { id: 'stage-3', name: 'Stage 3', sceneCount: 0 },
      ],
      marker: { sessionId: 'recent', marker: 1000 },
      abortFound: false,
    });
    expect(exitCode).toBe(0);
    expect(output).toContain('8/8');
    expect(output).toContain('0/7');
  });

  it('exits nonzero when DATABASE_URL is missing (main path)', async () => {
    const origEnv = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    let capturedExitCode = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = (code?: number) => {
      capturedExitCode = code ?? 0;
      throw new Error('__EXIT__');
    };
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    console.error = (...args: unknown[]) => logs.push(args.join(' '));

    const { main } = await import('../../scripts/check-stage-completion');
    let threw = false;
    try {
      await main([]);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === '__EXIT__') threw = true;
    }

    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;
    if (origEnv !== undefined) process.env.DATABASE_URL = origEnv;

    expect(capturedExitCode).not.toBe(0);
    expect(logs.join('\n')).toContain('DATABASE_URL');
  });

  it('no-session mode ignores historical abort rows from other sessions', async () => {
    const { output, exitCode } = await run([], {
      stages: [
        { id: 'stage-1', name: 'Stage 1', sceneCount: 8 },
        { id: 'stage-2', name: 'Stage 2', sceneCount: 7 },
        { id: 'stage-3', name: 'Stage 3', sceneCount: 7 },
        { id: 'stage-4', name: 'Stage 4', sceneCount: 7 },
        { id: 'stage-5', name: 'Stage 5', sceneCount: 7 },
        { id: 'stage-6', name: 'Stage 6', sceneCount: 7 },
        { id: 'stage-7', name: 'Stage 7', sceneCount: 7 },
      ],
      marker: { sessionId: 'recent', marker: 1000 },
      abortFound: false,
    });
    expect(exitCode).toBe(0);
    expect(output).toContain('COMPLETION_GATE_PASS');
    expect(output).not.toContain('ABORT DETECTED');
    expect(output).toContain('mode: most-recent-session=recent');
  });

  it('no-session mode still catches same-session post-marker abort', async () => {
    const { output, exitCode } = await run([], {
      stages: [
        { id: 'stage-1', name: 'Stage 1', sceneCount: 8 },
        { id: 'stage-2', name: 'Stage 2', sceneCount: 7 },
        { id: 'stage-3', name: 'Stage 3', sceneCount: 7 },
        { id: 'stage-4', name: 'Stage 4', sceneCount: 7 },
        { id: 'stage-5', name: 'Stage 5', sceneCount: 7 },
        { id: 'stage-6', name: 'Stage 6', sceneCount: 7 },
        { id: 'stage-7', name: 'Stage 7', sceneCount: 7 },
      ],
      marker: { sessionId: 'recent', marker: 1000 },
      abortFound: true,
    });
    expect(exitCode).not.toBe(0);
    expect(output).toContain('COMPLETION_GATE_FAIL');
    expect(output).toContain('ABORT DETECTED');
    expect(output).toContain('mode: most-recent-session=recent');
  });

  it('output header always shows mode line', async () => {
    const { output } = await run([], {
      stages: [
        { id: 'stage-1', name: 'Stage 1', sceneCount: 8 },
        { id: 'stage-2', name: 'Stage 2', sceneCount: 7 },
        { id: 'stage-3', name: 'Stage 3', sceneCount: 7 },
        { id: 'stage-4', name: 'Stage 4', sceneCount: 7 },
        { id: 'stage-5', name: 'Stage 5', sceneCount: 7 },
        { id: 'stage-6', name: 'Stage 6', sceneCount: 7 },
        { id: 'stage-7', name: 'Stage 7', sceneCount: 7 },
      ],
      marker: { sessionId: 'sess-abc', marker: 42 },
      abortFound: false,
    });
    const firstLine = output.split('\n')[0];
    expect(firstLine).toBe('mode: most-recent-session=sess-abc marker=42');
  });
});
