import { describe, it, expect } from 'vitest';
import {
  main,
  scanAbortFragment,
  buildDiffLines,
  checkStageCompletion,
  PINNED_INVENTORY,
} from '../../scripts/check-stage-completion';

// ---------------------------------------------------------------------------
// Fixture types matching the shapes returned by the DB query functions.
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
    const rows: EventRow[] = [];
    expect(scanAbortFragment(rows, marker)).toBe(false);
  });

  it('returns false when no abort text in data', () => {
    const rows: EventRow[] = [
      {
        session_id: 's1',
        ts: 2000,
        type: 'tool_execution_end',
        data: '{"message":"completed"}',
      },
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
      {
        session_id: 's1',
        ts: 2000,
        type: 'tool_execution_end',
        data: '{"message":"ok"}',
      },
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
// main: CLI boundary tests with injected fixtures.
//
// The helper stubs process.exit, console.log/error, and DATABASE_URL.
// When useOverride=true (default), main receives a fixture override and
// skips the pg pool. When useOverride=false, main runs in CLI mode and
// checks DATABASE_URL from env.
// ---------------------------------------------------------------------------

describe('main', () => {
  const originalEnv = process.env.DATABASE_URL;

  async function runMain(
    argv: string[],
    stages: StageRow[],
    events: EventRow[],
    marker: number,
    envOverride: string | undefined,
    useOverride: boolean,
    session?: string,
  ): Promise<{ output: string; exitCode: number }> {
    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origExit = process.exit;

    let capturedExitCode = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).exit = (code?: number) => {
      capturedExitCode = code ?? 0;
      throw new Error('__EXIT__');
    };

    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    console.error = (...args: unknown[]) => logs.push(args.join(' '));

    if (envOverride !== undefined) {
      process.env.DATABASE_URL = envOverride;
    } else {
      delete process.env.DATABASE_URL;
    }

    let threw = false;
    try {
      const overridePayload = useOverride ? { stages, events, marker, session } : undefined;
      await main(argv, overridePayload);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === '__EXIT__') threw = true;
    }

    // Restore everything.
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
    if (originalEnv !== undefined) {
      process.env.DATABASE_URL = originalEnv;
    } else {
      delete process.env.DATABASE_URL;
    }

    return { output: logs.join('\n'), exitCode: threw ? capturedExitCode : 0 };
  }

  it('exits 0 and prints PASS on full match with no aborts', async () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    const { output, exitCode } = await runMain([], stages, [], 0, 'pg://fake', true);
    expect(exitCode).toBe(0);
    expect(output).toContain('COMPLETION_GATE_PASS');
    expect(output).toContain('mode:');
  });

  it('exits nonzero and prints FAIL on missing count with diff', async () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 0 },
      { stage: 4, label: 'Stage 4', sceneCount: 0 },
      { stage: 5, label: 'Stage 5', sceneCount: 0 },
      { stage: 6, label: 'Stage 6', sceneCount: 0 },
      { stage: 7, label: 'Stage 7', sceneCount: 0 },
    ];
    const { output, exitCode } = await runMain([], stages, [], 0, 'pg://fake', true);
    expect(exitCode).not.toBe(0);
    expect(output).toContain('COMPLETION_GATE_FAIL');
    expect(output).toContain('8/8');
    expect(output).toContain('0/7');
  });

  it('exits nonzero and prints FAIL on abort-fragment row (--session mode)', async () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    const events: EventRow[] = [
      {
        session_id: 's1',
        ts: 2000,
        type: 'tool_execution_end',
        data: '{"message":"exceeded its 900000ms execution budget and was aborted"}',
      },
    ];
    const { output, exitCode } = await runMain(
      ['--session', 's1'],
      stages,
      events,
      1000,
      'pg://fake',
      true,
      's1',
    );
    expect(exitCode).not.toBe(0);
    expect(output).toContain('COMPLETION_GATE_FAIL');
    expect(output).toContain('abort');
    expect(output).toContain('session=s1');
  });

  it('exits 0 with --expect-incomplete on mismatch', async () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 0 },
      { stage: 4, label: 'Stage 4', sceneCount: 0 },
      { stage: 5, label: 'Stage 5', sceneCount: 0 },
      { stage: 6, label: 'Stage 6', sceneCount: 0 },
      { stage: 7, label: 'Stage 7', sceneCount: 0 },
    ];
    const { output, exitCode } = await runMain(
      ['--expect-incomplete'],
      stages,
      [],
      0,
      'pg://fake',
      true,
    );
    expect(exitCode).toBe(0);
    expect(output).toContain('8/8');
    expect(output).toContain('0/7');
  });

  it('exits nonzero when DATABASE_URL is missing', async () => {
    const { output, exitCode } = await runMain([], [], [], 0, undefined, false);
    expect(exitCode).not.toBe(0);
    expect(output).toContain('DATABASE_URL');
  });

  // --- No-session mode: historical abort rows from other sessions ignored ---

  it('no-session mode ignores historical abort rows from other sessions', async () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    // Only the recent session's events are passed (the CLI filters by session_id
    // in SQL). The recent session has no abort rows, so the gate passes.
    const events: EventRow[] = [];
    // Marker derived from most recent session (simulates deriveMostRecentSession).
    const { output, exitCode } = await runMain([], stages, events, 1000, 'pg://fake', true);
    expect(exitCode).toBe(0);
    expect(output).toContain('COMPLETION_GATE_PASS');
    expect(output).not.toContain('ABORT DETECTED');
    expect(output).toContain('mode: most-recent-session');
  });

  it('no-session mode still catches same-session post-marker abort', async () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    // Abort from the recent session after its marker (ts=2000 >= marker 1000).
    const events: EventRow[] = [
      {
        session_id: 'recent-session',
        ts: 2000,
        type: 'tool_execution_end',
        data: '{"message":"exceeded its 900000ms execution budget and was aborted"}',
      },
    ];
    const { output, exitCode } = await runMain([], stages, events, 0, 'pg://fake', true);
    expect(exitCode).not.toBe(0);
    expect(output).toContain('COMPLETION_GATE_FAIL');
    expect(output).toContain('ABORT DETECTED');
    expect(output).toContain('mode: most-recent-session');
  });

  it('no-session mode ignores historical abort but catches post-marker abort in same events', async () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    // Only the recent session's events are passed (the CLI filters by session_id
    // in SQL before scanning). This simulates the SQL filter: the old session's
    // abort row at ts=500 is excluded from the events array entirely.
    const events: EventRow[] = [
      {
        session_id: 'recent-session',
        ts: 2000,
        type: 'tool_execution_end',
        data: '{"message":"exceeded its 2700000ms execution budget and was aborted"}',
      },
    ];
    const { output, exitCode } = await runMain([], stages, events, 1000, 'pg://fake', true);
    expect(exitCode).not.toBe(0);
    expect(output).toContain('COMPLETION_GATE_FAIL');
    expect(output).toContain('ABORT DETECTED');
  });

  it('output header always shows mode line', async () => {
    const stages: StageRow[] = [
      { stage: 1, label: 'Stage 1', sceneCount: 8 },
      { stage: 2, label: 'Stage 2', sceneCount: 7 },
      { stage: 3, label: 'Stage 3', sceneCount: 7 },
      { stage: 4, label: 'Stage 4', sceneCount: 7 },
      { stage: 5, label: 'Stage 5', sceneCount: 7 },
      { stage: 6, label: 'Stage 6', sceneCount: 7 },
      { stage: 7, label: 'Stage 7', sceneCount: 7 },
    ];
    const { output } = await runMain([], stages, [], 42, 'pg://fake', true, 'sess-abc');
    const firstLine = output.split('\n')[0];
    expect(firstLine).toBe('mode: session=sess-abc marker=42');
  });
});
