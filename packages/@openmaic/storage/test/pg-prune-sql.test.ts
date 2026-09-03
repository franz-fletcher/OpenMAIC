/**
 * Unit test for pruneCompactionDeltas SQL string (D1 fix).
 *
 * Verifies that the SQL query no longer uses the reserved word `end` as
 * an alias. The actual execution is covered by the pg contract suite in CI.
 */
import { describe, expect, it } from 'vitest';

describe('pruneCompactionDeltas SQL string', () => {
  it('does not use reserved word "end" as a PostgreSQL alias', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const srcPath = path.resolve(import.meta.dirname ?? '.', '../src/agent-session/pg.ts');
    const src = fs.readFileSync(srcPath, 'utf-8');

    // Find the pruneCompactionDeltas method.
    const methodStart = src.indexOf('async pruneCompactionDeltas(');
    expect(methodStart).toBeGreaterThan(-1);

    // Extract the method body (up to the next method).
    const methodEnd = src.indexOf('async ', methodStart + 10);
    const methodBody = src.slice(methodStart, methodEnd > -1 ? methodEnd : methodStart + 2000);

    // The old buggy pattern: "FROM <table> end" or "WHERE end."
    // After fix, should use a non-reserved alias like "end_event" or "compaction_end_row".
    const hasBareEnd =
      /\bFROM\s+\S+\s+end\b/.test(methodBody) || /\bend\.session_id\b/.test(methodBody);

    // This assertion will fail until the fix is applied.
    expect(hasBareEnd).toBe(false);
  });
});
