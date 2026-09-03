import { InMemorySessionRepo, type AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import {
  makeCompactionRuntime,
  type CompactionRuntimeOptions,
} from '@/lib/server/agent-runtime/compaction';
import { loadSessionEntryHistory } from '@/lib/server/agent-runtime/entry-tree-storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeMessage(text: string, role = 'user'): AgentMessage {
  return { role, content: [{ type: 'text', text }] } as unknown as AgentMessage;
}

/**
 * Build messages that exceed a context window so compaction triggers.
 *
 * Pi estimates tokens at roughly 0.25 tokens per character. Nine messages
 * at 50k chars each yield ~112 500 tokens, which exceeds a 128k window
 * minus the reserve.
 */
function messagesOverThreshold(count = 9): AgentMessage[] {
  const msgs: AgentMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    msgs.push(fakeMessage(`message-${i}: ` + 'x'.repeat(50_000)));
  }
  return msgs;
}

function buildDefaults(
  overrides: Partial<CompactionRuntimeOptions> = {},
): CompactionRuntimeOptions {
  return {
    contextWindow: 128_000,
    settings: { enabled: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compaction safety', () => {
  // -----------------------------------------------------------------------
  // Summarizer failure
  // -----------------------------------------------------------------------

  describe('summarizer failure', () => {
    it('returns the ORIGINAL array reference, records failure, calls no appendSink, emits no trace', async () => {
      const summarizerError = new Error('summarizer exploded');
      const summarizer = vi.fn(async () => {
        throw summarizerError;
      });
      const appendSink = vi.fn(async () => {});
      const emitTrace = vi.fn();

      const runtime = makeCompactionRuntime(buildDefaults({ summarizer, appendSink, emitTrace }));

      const messages = messagesOverThreshold();
      const result = await runtime.transformContext(messages);

      // The original array reference must be returned unchanged.
      expect(result).toBe(messages);

      // Failure recorded in trace.
      const trace = runtime.getTrace();
      expect(trace.failures).toHaveLength(1);
      expect(trace.failures[0]).toBe('summarizer exploded');

      // No append, no tree write.
      expect(appendSink).not.toHaveBeenCalled();
      // No trace emission on failure path.
      expect(emitTrace).not.toHaveBeenCalled();
      // Trigger count stays zero on failure.
      expect(trace.triggerCount).toBe(0);

      runtime.dispose();
    });

    it('returns original messages when summarizer throws a non-Error value', async () => {
      const summarizer = vi.fn(async () => {
        throw 'string error';
      });
      const appendSink = vi.fn(async () => {});
      const emitTrace = vi.fn();

      const runtime = makeCompactionRuntime(buildDefaults({ summarizer, appendSink, emitTrace }));

      const messages = messagesOverThreshold();
      const result = await runtime.transformContext(messages);

      expect(result).toBe(messages);
      const trace = runtime.getTrace();
      expect(trace.failures).toHaveLength(1);
      expect(trace.failures[0]).toBe('string error');
      expect(appendSink).not.toHaveBeenCalled();
      expect(emitTrace).not.toHaveBeenCalled();

      runtime.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Append sink failure (lease-loss simulation)
  // -----------------------------------------------------------------------

  describe('append sink failure', () => {
    it('records failure, returns original messages, error not swallowed silently', async () => {
      const sinkError = new Error('lease lost during external write');
      const summarizer = vi.fn(async () => 'compacted summary');
      const appendSink = vi.fn(async () => {
        throw sinkError;
      });
      const emitTrace = vi.fn();

      const runtime = makeCompactionRuntime(buildDefaults({ summarizer, appendSink, emitTrace }));

      const messages = messagesOverThreshold();
      const result = await runtime.transformContext(messages);

      // Original messages returned unchanged.
      expect(result).toBe(messages);

      // Failure recorded in trace.failures.
      const trace = runtime.getTrace();
      expect(trace.failures).toHaveLength(1);
      expect(trace.failures[0]).toBe('lease lost during external write');

      // Summarizer was called (the failure is downstream).
      expect(summarizer).toHaveBeenCalledOnce();
      // emitTrace not called on failure path.
      expect(emitTrace).not.toHaveBeenCalled();
      // Trigger count stays zero on failure.
      expect(trace.triggerCount).toBe(0);

      runtime.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Trace emission on success
  // -----------------------------------------------------------------------

  describe('trace emission', () => {
    it('emits exactly one trace line per successful compaction with entry id, token counts, and summary length', async () => {
      const summaryText = 'compacted summary of conversation history';
      const summarizer = vi.fn(async () => summaryText);
      const appendSink = vi.fn(async () => {});
      const emitTrace = vi.fn();

      const runtime = makeCompactionRuntime(buildDefaults({ summarizer, appendSink, emitTrace }));

      const messages = messagesOverThreshold();
      const result = await runtime.transformContext(messages);

      // Exactly one trace emission.
      expect(emitTrace).toHaveBeenCalledOnce();
      const emitted = emitTrace.mock.calls[0]![0] as { message: string };

      // Line carries entry id, token counts, and summary length.
      expect(emitted.message).toMatch(/^compaction .+ tokens \d+->\d+ summary \d+$/);
      expect(emitted.message).toContain(`summary ${summaryText.length}`);
      expect(result.length).toBeGreaterThan(0);

      runtime.dispose();
    });

    it('emits zero trace lines on the no-op path (under threshold)', async () => {
      const summarizer = vi.fn(async () => 'should not be called');
      const emitTrace = vi.fn();

      const runtime = makeCompactionRuntime(buildDefaults({ summarizer, emitTrace }));

      // Short messages do not exceed the context window.
      const messages = [fakeMessage('short-1'), fakeMessage('short-2'), fakeMessage('short-3')];
      await runtime.transformContext(messages);

      expect(summarizer).not.toHaveBeenCalled();
      expect(emitTrace).not.toHaveBeenCalled();

      runtime.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // loadSessionEntryHistory rejection shapes
  // -----------------------------------------------------------------------

  describe('loadSessionEntryHistory rejection shapes', () => {
    it('rejects a branch with a non-backward firstKeptEntryId', async () => {
      const repo = new InMemorySessionRepo();
      const session = await repo.create();

      // Append messages so the tree is non-empty.
      await session.appendMessage(fakeMessage('msg-1'));
      await session.appendMessage(fakeMessage('msg-2'));

      // Append a compaction entry with a fake firstKeptEntryId that does not
      // exist in the branch, creating a non-backward reference.
      await session.appendCompaction('summary', 'fake-nonexistent-id', 1000);

      // loadSessionEntryHistory must reject this shape.
      await expect(
        loadSessionEntryHistory(session, {
          sessionId: 'test-session',
          hasPriorRun: true,
        }),
      ).rejects.toThrow(/non-backward firstKeptEntryId/);
    });
  });
});
