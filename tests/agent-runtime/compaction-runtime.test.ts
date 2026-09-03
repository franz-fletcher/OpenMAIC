import {
  InMemorySessionRepo,
  type AgentMessage,
  type Session,
} from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  makeCompactionRuntime,
  type CompactionRuntimeOptions,
  type CompactionRuntime,
} from '@/lib/server/agent-runtime/compaction';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeMessage(text: string, role = 'user'): AgentMessage {
  return { role, content: [{ type: 'text', text }] } as unknown as AgentMessage;
}

function largeMessage(kb: number): AgentMessage {
  return fakeMessage('x'.repeat(kb * 1024));
}

/**
 * Build messages that exceed a context window so compaction triggers.
 *
 * Pi estimates tokens at roughly 0.25 tokens per character. Each message
 * below is ~50 000 chars (~12 500 tokens). Nine messages yield ~112 500
 * tokens which exceeds a 128k window minus the 16 384 reserve.
 */
function messagesOverThreshold(count = 9): AgentMessage[] {
  const msgs: AgentMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    msgs.push(fakeMessage(`message-${i}: ` + 'x'.repeat(50_000)));
  }
  return msgs;
}

function messagesUnderThreshold(count = 3): AgentMessage[] {
  const msgs: AgentMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    msgs.push(fakeMessage(`short-${i}`));
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

describe('makeCompactionRuntime', () => {
  afterEach(() => vi.restoreAllMocks());

  // -----------------------------------------------------------------------
  // Disabled path
  // -----------------------------------------------------------------------

  describe('disabled runtime', () => {
    it('returns the identical array BY REFERENCE and appends nothing', async () => {
      const appendSink = vi.fn(async () => {});
      const runtime = makeCompactionRuntime(
        buildDefaults({ settings: { enabled: false }, appendSink }),
      );
      const messages = messagesUnderThreshold();

      const result = await runtime.transformContext(messages);

      expect(result).toBe(messages);
      expect(appendSink).not.toHaveBeenCalled();
      runtime.dispose();
    });

    it('getTrace reports enabled=false, zero counts', () => {
      const runtime = makeCompactionRuntime(buildDefaults({ settings: { enabled: false } }));
      const trace = runtime.getTrace();
      expect(trace.enabled).toBe(false);
      expect(trace.checkCount).toBe(0);
      expect(trace.triggerCount).toBe(0);
      expect(trace.failures).toEqual([]);
      expect(trace.events).toEqual([]);
      runtime.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Under-threshold no-op
  // -----------------------------------------------------------------------

  describe('under threshold', () => {
    it('does not trigger compaction and returns messages', async () => {
      const summarizer = vi.fn(async () => 'summary');
      const appendSink = vi.fn(async () => {});
      const runtime = makeCompactionRuntime(
        buildDefaults({
          summarizer,
          appendSink,
          contextWindow: 128_000,
        }),
      );
      const messages = messagesUnderThreshold();

      const result = await runtime.transformContext(messages);

      expect(summarizer).not.toHaveBeenCalled();
      expect(appendSink).not.toHaveBeenCalled();
      expect(result.length).toBe(messages.length);
      expect(runtime.getTrace().checkCount).toBe(1);
      expect(runtime.getTrace().triggerCount).toBe(0);
      runtime.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Over threshold triggers exactly one compaction
  // -----------------------------------------------------------------------

  describe('over threshold', () => {
    it('triggers exactly one append with summary text', async () => {
      const summaryText = 'compacted summary of old history';
      const summarizer = vi.fn(async () => summaryText);
      const appendSink = vi.fn(async () => {});

      const runtime = makeCompactionRuntime(
        buildDefaults({
          summarizer,
          appendSink,
        }),
      );

      const messages = messagesOverThreshold();
      const result = await runtime.transformContext(messages);

      expect(summarizer).toHaveBeenCalledOnce();
      expect(appendSink).toHaveBeenCalledOnce();

      const entry = (appendSink.mock.calls as unknown[][])[0]![0] as {
        type: string;
        summary: string;
        firstKeptEntryId: string;
        tokensBefore: number;
      };
      expect(entry.type).toBe('compaction');
      expect(typeof entry.summary).toBe('string');
      expect(typeof entry.firstKeptEntryId).toBe('string');
      expect(typeof entry.tokensBefore).toBe('number');

      // The returned view must contain the summary message plus the kept tail.
      expect(result.length).toBeGreaterThan(0);
      // Pi materializes the compaction entry into a summary message.
      const summaryMsg = result[0]! as unknown as Record<string, unknown>;
      expect(summaryMsg.role).toBe('compactionSummary');
      // Pi stores the summary text in the message. The exact property varies
      // by pi version; check summary, text, or content fields.
      const summaryText_ =
        (summaryMsg.summary as string) ??
        (summaryMsg.text as string) ??
        (Array.isArray(summaryMsg.content)
          ? (summaryMsg.content as Array<{ text?: string }>)[0]?.text
          : undefined) ??
        '';
      expect(summaryText_).toBe(summaryText);

      // getTrace records the trigger.
      const trace = runtime.getTrace();
      expect(trace.triggerCount).toBe(1);
      expect(trace.checkCount).toBe(1);
      expect(trace.events).toHaveLength(1);
      expect(trace.events[0]!.tokensBefore).toBeGreaterThan(0);
      expect(trace.events[0]!.summary).toBe(summaryText);

      runtime.dispose();
    });

    it('never mutates the input array', async () => {
      const summarizer = vi.fn(async () => 'summary');
      const appendSink = vi.fn(async () => {});
      const runtime = makeCompactionRuntime(buildDefaults({ summarizer, appendSink }));

      const messages = messagesOverThreshold();
      const originalLength = messages.length;
      const originalFirst = messages[0];

      await runtime.transformContext(messages);

      expect(messages.length).toBe(originalLength);
      expect(messages[0]).toBe(originalFirst);
      runtime.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Trace shape
  // -----------------------------------------------------------------------

  describe('getTrace', () => {
    it('records checkCount and triggerCount across multiple calls', async () => {
      const summarizer = vi.fn(async () => 'summary');
      const appendSink = vi.fn(async () => {});
      const runtime = makeCompactionRuntime(buildDefaults({ summarizer, appendSink }));

      // First call: over threshold triggers compaction.
      await runtime.transformContext(messagesOverThreshold());
      // Second call: under threshold, no compaction.
      await runtime.transformContext(messagesUnderThreshold());

      const trace = runtime.getTrace();
      expect(trace.checkCount).toBe(2);
      expect(trace.triggerCount).toBe(1);
      expect(trace.events).toHaveLength(1);
      runtime.dispose();
    });

    it('returns a snapshot (not a live reference)', () => {
      const runtime = makeCompactionRuntime(buildDefaults({ settings: { enabled: false } }));
      const trace1 = runtime.getTrace();
      const trace2 = runtime.getTrace();
      expect(trace1).not.toBe(trace2);
      expect(trace1.failures).not.toBe(trace2.failures);
      runtime.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Defaults
  // -----------------------------------------------------------------------

  describe('default summarizer', () => {
    it('uses generateCompactionSummary when no summarizer is injected', async () => {
      // When no summarizer is provided the runtime should use the default
      // generateCompactionSummary. That function calls resolveModel which
      // requires MODEL_ROUTES or DEFAULT_MODEL, so we mock both modules.
      vi.mock('@/lib/ai/llm', () => ({
        callLLM: vi.fn(async () => ({ text: '  default summary  ' })),
      }));
      vi.mock('@/lib/server/resolve-model', () => ({
        resolveModel: vi.fn(async () => ({
          model: { id: 'test-model' },
          modelInfo: {},
          modelString: 'test:model',
          providerId: 'test',
          modelId: 'model',
          apiKey: 'key',
        })),
      }));

      const appendSink = vi.fn(async () => {});
      const runtime = makeCompactionRuntime(buildDefaults({ appendSink }));

      // Use messages that trigger compaction.
      const messages = messagesOverThreshold();
      const result = await runtime.transformContext(messages);

      expect(result.length).toBeGreaterThan(0);
      const summaryMsg = result[0]! as unknown as Record<string, unknown>;
      expect(summaryMsg.role).toBe('compactionSummary');
      const summaryText_ =
        (summaryMsg.summary as string) ??
        (summaryMsg.text as string) ??
        (Array.isArray(summaryMsg.content)
          ? (summaryMsg.content as Array<{ text?: string }>)[0]?.text
          : undefined) ??
        '';
      expect(summaryText_).toBe('default summary');

      runtime.dispose();
    });
  });
});
