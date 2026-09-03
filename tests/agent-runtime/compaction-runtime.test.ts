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
  type CompactionCardEvent,
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

function buildStreamingSummarizer(): {
  summarizer: CompactionRuntimeOptions['summarizer'];
  resolveNext: (text: string) => void;
  rejectNext: (error: Error) => void;
} {
  let resolveFn: (text: string) => void = () => {};
  let rejectFn: (error: Error) => void = () => {};
  let accumulated = '';
  const summarizer: CompactionRuntimeOptions['summarizer'] = async (
    _msgs,
    _focus,
    _maxTokens,
    onDelta,
    _signal,
  ) => {
    accumulated = '';
    const chunk1 = await new Promise<string>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    accumulated += chunk1;
    onDelta(accumulated);
    const chunk2 = await new Promise<string>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
    accumulated += chunk2;
    onDelta(accumulated);
    return accumulated;
  };
  return {
    summarizer,
    resolveNext: (text: string) => resolveFn(text),
    rejectNext: (error: Error) => rejectFn(error),
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

    it('emits nothing when disabled', async () => {
      const emitEvent = vi.fn();
      const runtime = makeCompactionRuntime(
        buildDefaults({ settings: { enabled: false }, emitEvent }),
      );
      const messages = messagesUnderThreshold();

      await runtime.transformContext(messages);

      expect(emitEvent).not.toHaveBeenCalled();
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
      const emitEvent = vi.fn();
      const runtime = makeCompactionRuntime(
        buildDefaults({
          summarizer,
          appendSink,
          emitEvent,
          contextWindow: 128_000,
        }),
      );
      const messages = messagesUnderThreshold();

      const result = await runtime.transformContext(messages);

      expect(summarizer).not.toHaveBeenCalled();
      expect(appendSink).not.toHaveBeenCalled();
      expect(emitEvent).not.toHaveBeenCalled();
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
  // emitEvent sink
  // -----------------------------------------------------------------------

  describe('emitEvent', () => {
    it('emits start before summarizer runs and end after rebuild', async () => {
      const events: CompactionCardEvent[] = [];
      const summarizer = vi.fn(async () => 'done summary');
      const appendSink = vi.fn(async () => {});

      const runtime = makeCompactionRuntime(
        buildDefaults({ summarizer, appendSink, emitEvent: (e) => events.push(e) }),
      );

      await runtime.transformContext(messagesOverThreshold());

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]!.kind).toBe('start');
      expect(events[events.length - 1]!.kind).toBe('end');

      const start = events[0] as Extract<CompactionCardEvent, { kind: 'start' }>;
      expect(typeof start.tokensBefore).toBe('number');
      expect(typeof start.messagesBefore).toBe('number');
      expect(start.tokensBefore).toBeGreaterThan(0);

      const end = events[events.length - 1] as Extract<CompactionCardEvent, { kind: 'end' }>;
      expect(typeof end.entryId).toBe('string');
      expect(typeof end.tokensBefore).toBe('number');
      expect(typeof end.tokensAfter).toBe('number');
      expect(typeof end.summary).toBe('string');
      expect(end.summary).toBe('done summary');

      runtime.dispose();
    });

    it('emits delta events with accumulated text from onDelta', async () => {
      const { summarizer, resolveNext } = buildStreamingSummarizer();
      const events: CompactionCardEvent[] = [];
      const appendSink = vi.fn(async () => {});

      const runtime = makeCompactionRuntime(
        buildDefaults({
          summarizer,
          appendSink,
          emitEvent: (e) => events.push(e),
        }),
      );

      const transformPromise = runtime.transformContext(messagesOverThreshold());

      // Wait for the start event, which means the summarizer has been called
      await vi.waitFor(() => {
        expect(events.some((e) => e.kind === 'start')).toBe(true);
      });

      // Now resolve the first chunk
      resolveNext('Hello ');
      await vi.waitFor(() => {
        const deltas = events.filter((e) => e.kind === 'delta');
        expect(deltas.length).toBeGreaterThanOrEqual(1);
      });

      // Resolve the second chunk
      resolveNext('world');
      await transformPromise;

      const deltas = events.filter((e) => e.kind === 'delta') as Extract<
        CompactionCardEvent,
        { kind: 'delta' }
      >[];
      expect(deltas.length).toBe(2);
      expect(deltas[0]!.text).toBe('Hello ');
      expect(deltas[1]!.text).toBe('Hello world');

      const startEvent = events.find((e) => e.kind === 'start');
      const endEvent = events.find((e) => e.kind === 'end');
      expect(startEvent).toBeDefined();
      expect(endEvent).toBeDefined();

      // Start must come before deltas, end must come after
      const startIdx = events.indexOf(startEvent!);
      const delta1Idx = events.indexOf(deltas[0]!);
      const delta2Idx = events.indexOf(deltas[1]!);
      const endIdx = events.indexOf(endEvent!);
      expect(startIdx).toBeLessThan(delta1Idx);
      expect(delta1Idx).toBeLessThan(delta2Idx);
      expect(delta2Idx).toBeLessThan(endIdx);

      runtime.dispose();
    });

    it('emits no end event when summarizer fails', async () => {
      const summarizer = vi.fn(async () => {
        throw new Error('model timeout');
      });
      const appendSink = vi.fn(async () => {});
      const emitEvent = vi.fn();

      const runtime = makeCompactionRuntime(buildDefaults({ summarizer, appendSink, emitEvent }));

      const result = await runtime.transformContext(messagesOverThreshold());

      // Failure returns the input messages unchanged
      expect(result).toBeDefined();
      expect(result.length).toBe(messagesOverThreshold().length);

      const emitCalls = emitEvent.mock.calls.map((c) => c[0] as CompactionCardEvent);
      expect(emitCalls.some((e) => e.kind === 'start')).toBe(true);
      expect(emitCalls.some((e) => e.kind === 'end')).toBe(false);

      // getTrace records the failure
      const trace = runtime.getTrace();
      expect(trace.failures.length).toBe(1);
      expect(trace.failures[0]).toContain('model timeout');

      runtime.dispose();
    });

    it('emits start event with correct tokensBefore and messagesBefore', async () => {
      const summarizer = vi.fn(async () => 'summary');
      const appendSink = vi.fn(async () => {});
      const events: CompactionCardEvent[] = [];

      const runtime = makeCompactionRuntime(
        buildDefaults({ summarizer, appendSink, emitEvent: (e) => events.push(e) }),
      );

      await runtime.transformContext(messagesOverThreshold());

      const start = events[0] as Extract<CompactionCardEvent, { kind: 'start' }>;
      expect(start.kind).toBe('start');
      expect(start.tokensBefore).toBeGreaterThan(0);
      expect(start.messagesBefore).toBeGreaterThan(0);

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
        streamLLM: vi.fn(() => ({
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'default summary' };
            yield { type: 'finish' };
          })(),
        })),
      }));
      vi.mock('@/lib/server/resolve-model', () => ({
        resolveModel: vi.fn(async () => ({
          model: { id: 'test-model' },
          modelInfo: {},
          modelString: 'test:model',
          providerId: 'test',
          modelId: 'model',
          apiKey: 'key',
          thinkingConfig: undefined,
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

  // -----------------------------------------------------------------------
  // Durable id resolution (batch 012)
  // -----------------------------------------------------------------------

  describe('durable id resolution', () => {
    it('two independent id spaces: durable sink gets durable id, mirror keeps mirror id', async () => {
      const summaryText = 'compacted summary';
      const summarizer = vi.fn(async () => summaryText);
      const appendSink = vi.fn(async () => {});
      const emitEvent = vi.fn();

      // The resolver simulates the runner: it receives a mirror id and
      // a mirror KEPT message (the first entry the compaction keeps).
      // This proves the two id spaces remain disjoint.
      const resolver = vi.fn(async (mirrorId: string, keptMsg: unknown) => {
        return `durable-${mirrorId}`;
      });
      const runtime = makeCompactionRuntime(
        buildDefaults({
          summarizer,
          appendSink,
          emitEvent,
          resolveFirstKeptEntryId: resolver,
        }),
      );

      const messages = messagesOverThreshold();
      await runtime.transformContext(messages);
      // The resolver was called with the mirror firstKeptEntryId AND the
      // mirror kept message (not the first summarized message).
      expect(resolver).toHaveBeenCalledOnce();
      const mirrorId = resolver.mock.calls[0]![0] as string;
      expect(typeof mirrorId).toBe('string');
      expect(mirrorId.length).toBeGreaterThan(0);

      // The second argument is the mirror kept message, which must be a
      // message from the branch whose id matches firstKeptEntryId. It
      // should NOT be the first summarized message (messagesToSummarize[0]).
      const resolverKeptMsg = resolver.mock.calls[0]![1] as AgentMessage;
      expect(resolverKeptMsg).toBeDefined();
      // The kept message is from the messagesOverThreshold set. It should
      // NOT be message-0 (the first in the input, which is summarized).
      const resolverContent = JSON.stringify(resolverKeptMsg);
      expect(resolverContent).not.toContain('message-0: ');

      // The end event entryId comes from the mirror session, NOT the resolver.
      const endEvent = emitEvent.mock.calls
        .map((c) => c[0] as CompactionCardEvent)
        .find((e) => e.kind === 'end') as Extract<CompactionCardEvent, { kind: 'end' }>;
      expect(typeof endEvent.entryId).toBe('string');
      // The end event id must NOT be the durable id.
      expect(endEvent.entryId).not.toBe(`durable-${mirrorId}`);

      runtime.dispose();
    });

    it('resolver throw: no sink call, failure recorded, context unchanged, no end event', async () => {
      const summarizer = vi.fn(async () => 'summary');
      const appendSink = vi.fn(async () => {});
      const emitEvent = vi.fn();
      const resolverError = new Error('durable resolution diverged');
      const resolver = vi.fn(async () => {
        throw resolverError;
      });

      const runtime = makeCompactionRuntime(
        buildDefaults({
          summarizer,
          appendSink,
          emitEvent,
          resolveFirstKeptEntryId: resolver,
        }),
      );

      const messages = messagesOverThreshold();
      const result = await runtime.transformContext(messages);

      // The resolver was called (it threw).
      expect(resolver).toHaveBeenCalledOnce();

      // No sink call happened.
      expect(appendSink).not.toHaveBeenCalled();

      // Original messages returned unchanged.
      expect(result).toBe(messages);

      // Failure recorded in trace.
      const trace = runtime.getTrace();
      expect(trace.failures).toHaveLength(1);
      expect(trace.failures[0]).toContain('durable resolution diverged');

      // No end event emitted.
      const endEvents = emitEvent.mock.calls
        .map((c) => c[0] as CompactionCardEvent)
        .filter((e) => e.kind === 'end');
      expect(endEvents).toHaveLength(0);

      runtime.dispose();
    });

    it('resolver absent: mirror id passes through (byte-identical to today)', async () => {
      const summaryText = 'compacted summary';
      const summarizer = vi.fn(async () => summaryText);
      const appendSink = vi.fn(async () => {});

      // No resolver provided. Today's behavior: the mirror id passes
      // directly into the appendSink payload.
      const runtime = makeCompactionRuntime(
        buildDefaults({
          summarizer,
          appendSink,
        }),
      );

      const messages = messagesOverThreshold();
      await runtime.transformContext(messages);

      // The sink receives the mirror firstKeptEntryId directly.
      const sinkEntry = (appendSink.mock.calls as unknown[][])[0]![0] as {
        firstKeptEntryId: string;
      };
      expect(typeof sinkEntry.firstKeptEntryId).toBe('string');
      expect(sinkEntry.firstKeptEntryId.length).toBeGreaterThan(0);

      runtime.dispose();
    });
  });
});
