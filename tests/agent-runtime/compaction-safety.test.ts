import { InMemorySessionRepo, type AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import {
  makeCompactionRuntime,
  type CompactionRuntimeOptions,
  type CompactionCardEvent,
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

  // -----------------------------------------------------------------------
  // Durable id resolution divergence guard (batch 012)
  // -----------------------------------------------------------------------

  describe('durable id resolution divergence guard', () => {
    it('mirror and durable branches with same messages: resolver content comparison passes', async () => {
      const { InMemorySessionRepo, prepareCompaction } =
        await import('@earendil-works/pi-agent-core');

      const repo = new InMemorySessionRepo();
      const mirrorSession = await repo.create();
      const durableSession = await repo.create();

      // Both branches receive the same message sequence with independent
      // id counters. The resolver's content comparison must pass on agreement.
      for (let i = 0; i < 9; i += 1) {
        const msg = fakeMessage(`shared-msg-${i}`);
        await mirrorSession.appendMessage(msg);
        await durableSession.appendMessage(msg);
      }

      const mirrorBranch = await mirrorSession.getBranch();
      const durableBranch = await durableSession.getBranch();

      const settings = {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 16_384,
      };

      const mirrorPrep = prepareCompaction(mirrorBranch, settings);
      expect(mirrorPrep.ok).toBe(true);
      if (!mirrorPrep.ok || !mirrorPrep.value) return;

      const durablePrep = prepareCompaction(durableBranch, settings);
      expect(durablePrep.ok).toBe(true);
      if (!durablePrep.ok || !durablePrep.value) return;

      // Resolver: compare the mirror kept message with the durable kept
      // message. On agreement return the durable firstKeptEntryId.
      const mirrorKeptEntry = mirrorBranch.find((e) => e.id === mirrorPrep.value!.firstKeptEntryId);
      expect(mirrorKeptEntry).toBeDefined();
      expect(mirrorKeptEntry!.type).toBe('message');

      const durableKeptEntry = durableBranch.find(
        (e) => e.id === durablePrep.value!.firstKeptEntryId,
      );
      expect(durableKeptEntry).toBeDefined();
      expect(durableKeptEntry!.type).toBe('message');

      const mirrorKeptMsg = (mirrorKeptEntry as { message: AgentMessage }).message;
      const durableKeptMsg = (durableKeptEntry as { message: AgentMessage }).message;

      // Content comparison must pass: same message sequence, same content.
      expect(JSON.stringify(mirrorKeptMsg)).toBe(JSON.stringify(durableKeptMsg));

      // Simulate the resolver returning the durable id on agreement.
      const resolverResult = durablePrep.value.firstKeptEntryId;
      expect(typeof resolverResult).toBe('string');
      expect(resolverResult.length).toBeGreaterThan(0);

      // Append compaction with the resolved id and verify the tree is valid.
      await durableSession.appendCompaction('resolved summary', resolverResult, 100_000);

      const history = await loadSessionEntryHistory(durableSession, {
        sessionId: 'test-agreement',
        hasPriorRun: true,
      });
      expect(history.messages.length).toBeGreaterThan(0);
      const firstMsg = history.messages[0]! as unknown as Record<string, unknown>;
      expect(firstMsg.role).toBe('compactionSummary');
    });

    it('mirror and durable branches with different messages: resolver throws on divergence', async () => {
      const { InMemorySessionRepo, prepareCompaction } =
        await import('@earendil-works/pi-agent-core');

      const repo = new InMemorySessionRepo();
      const mirrorSession = await repo.create();
      const durableSession = await repo.create();

      // Mirror branch: standard 9-message sequence.
      for (let i = 0; i < 9; i += 1) {
        await mirrorSession.appendMessage(fakeMessage(`mirror-msg-${i}`));
      }

      // Durable branch: same count but different content (simulating
      // divergence after a prior compaction or write failure).
      for (let i = 0; i < 9; i += 1) {
        await durableSession.appendMessage(fakeMessage(`durable-msg-${i}`));
      }

      const mirrorBranch = await mirrorSession.getBranch();
      const durableBranch = await durableSession.getBranch();

      const settings = {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 16_384,
      };

      const mirrorPrep = prepareCompaction(mirrorBranch, settings);
      expect(mirrorPrep.ok).toBe(true);
      if (!mirrorPrep.ok || !mirrorPrep.value) return;

      const durablePrep = prepareCompaction(durableBranch, settings);
      expect(durablePrep.ok).toBe(true);
      if (!durablePrep.ok || !durablePrep.value) return;

      // Extract kept messages from both branches.
      const mirrorKeptEntry = mirrorBranch.find((e) => e.id === mirrorPrep.value!.firstKeptEntryId);
      const durableKeptEntry = durableBranch.find(
        (e) => e.id === durablePrep.value!.firstKeptEntryId,
      );
      expect(mirrorKeptEntry).toBeDefined();
      expect(durableKeptEntry).toBeDefined();

      const mirrorKeptMsg = (mirrorKeptEntry as { message: AgentMessage }).message;
      const durableKeptMsg = (durableKeptEntry as { message: AgentMessage }).message;

      // Content comparison must FAIL: different message content.
      expect(JSON.stringify(mirrorKeptMsg)).not.toBe(JSON.stringify(durableKeptMsg));

      // The resolver must throw on divergence.
      const resolver = vi.fn(async () => {
        throw new Error('compaction kept-entry resolution diverged');
      });

      const summarizer = vi.fn(async () => 'summary after divergence');
      const appendSink = vi.fn(async () => {});
      const emitEvent = vi.fn();

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

      expect(resolver).toHaveBeenCalledOnce();
      expect(appendSink).not.toHaveBeenCalled();
      expect(result).toBe(messages);

      const trace = runtime.getTrace();
      expect(trace.failures).toHaveLength(1);
      expect(trace.failures[0]).toContain('diverged');

      const endEvents = emitEvent.mock.calls
        .map((c) => c[0] as CompactionCardEvent)
        .filter((e) => e.kind === 'end');
      expect(endEvents).toHaveLength(0);

      runtime.dispose();
    });

    it('validator round-trip: after resolved sink append, loadSessionEntryHistory accepts the tree', async () => {
      const { InMemorySessionRepo, prepareCompaction } =
        await import('@earendil-works/pi-agent-core');

      const repo = new InMemorySessionRepo();
      const durableSession = await repo.create();

      for (let i = 0; i < 9; i += 1) {
        await durableSession.appendMessage(fakeMessage(`durable-msg-${i}`));
      }

      const durableBranch = await durableSession.getBranch();
      const durablePrep = prepareCompaction(durableBranch, {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 16_384,
      });
      expect(durablePrep.ok).toBe(true);
      if (!durablePrep.ok || !durablePrep.value) return;

      const durableFirstKeptId = durablePrep.value.firstKeptEntryId;
      expect(typeof durableFirstKeptId).toBe('string');

      await durableSession.appendCompaction('resolved summary', durableFirstKeptId, 100_000);

      const history = await loadSessionEntryHistory(durableSession, {
        sessionId: 'test-resolved',
        hasPriorRun: true,
      });

      expect(history.messages.length).toBeGreaterThan(0);
      const firstMsg = history.messages[0]! as unknown as Record<string, unknown>;
      expect(firstMsg.role).toBe('compactionSummary');
    });
  });
});
