/**
 * Compaction trigger policy for the agent runtime.
 *
 * Measures the assembled driver context against the pinned context window
 * and resolves compaction settings with floor semantics. The summarizer
 * and entry writer land in later slices (S02, S03, S04).
 */
import {
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  InMemorySessionRepo,
  prepareCompaction,
  Session,
  shouldCompact,
  type AgentMessage,
} from '@earendil-works/pi-agent-core';

/** Compaction thresholds and retention settings. */
export interface CompactionSettings {
  /** Enable automatic compaction decisions. */
  enabled: boolean;
  /** Tokens reserved for summary prompt and output. */
  reserveTokens: number;
  /** Approximate recent-context tokens to keep after compaction. */
  keepRecentTokens: number;
}

/**
 * Discriminated union of durable compaction card events.
 *
 * Emitted by `makeCompactionRuntime` through the `emitEvent` sink.
 * The runner maps these to lifecycle frames in the durable log.
 */
export type CompactionCardEvent =
  | { kind: 'start'; tokensBefore: number; messagesBefore: number }
  | { kind: 'delta'; text: string }
  | {
      kind: 'end';
      entryId: string;
      tokensBefore: number;
      tokensAfter: number;
      summary: string;
    };

/**
 * Resolve compaction settings with floor semantics.
 *
 * When overrides omit reserveTokens or keepRecentTokens the floor policy
 * applies: reserve is at least 2048 or 20 percent of the context window,
 * keepRecent is at least 2048 or 25 percent. Both are capped by the pi
 * defaults so the floor never exceeds the harness maximum.
 *
 * @param contextWindow - The pinned driver context window in tokens.
 * @param overrides - Optional partial settings that win over the floor.
 */
// prettier-ignore
export function resolveCompactionSettings(contextWindow: number, overrides?: Partial<CompactionSettings>): CompactionSettings {
  const reserveTokens = Math.min(
    DEFAULT_COMPACTION_SETTINGS.reserveTokens,
    Math.max(2_048, Math.floor(contextWindow * 0.2)),
  );
  const keepRecentTokens = Math.min(
    DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
    Math.max(2_048, Math.floor(contextWindow * 0.25)),
  );
  return {
    // The agent runtime inverts the pi opt-out default: compaction is OFF
    // unless the operator explicitly enables it through overrides or env.
    enabled: overrides?.enabled ?? false,
    reserveTokens: overrides?.reserveTokens ?? reserveTokens,
    keepRecentTokens: overrides?.keepRecentTokens ?? keepRecentTokens,
  };
}

/**
 * Measure the assembled driver context token count.
 *
 * Uses the pi provider usage anchor when a nonzero usage block exists.
 * A zero or absent usage anchor (common on the last assistant message of
 * a run, or from imported UI history) falls back to the conservative
 * per-message character heuristic from pi.
 *
 * @param messages - The assembled driver context messages.
 */
export function measureDriverContextTokens(messages: AgentMessage[]): number {
  const providerEstimate = estimateContextTokens(messages);
  // Imported UI history and providers that omit streamed usage both produce a
  // successful assistant message with an all-zero usage object. Pi treats any
  // such object as an authoritative anchor and would otherwise ignore every
  // earlier message. Fall back to its own conservative per-message estimator.
  if (providerEstimate.lastUsageIndex !== null && providerEstimate.usageTokens <= 0) {
    return messages.reduce((total, message) => total + estimateTokens(message), 0);
  }
  return providerEstimate.tokens;
}

/**
 * Runtime trace snapshot recording compaction activity.
 */
export interface CompactionRuntimeTrace {
  readonly enabled: boolean;
  readonly contextWindow: number;
  readonly reserveTokens: number;
  readonly keepRecentTokens: number;
  readonly checkCount: number;
  readonly triggerCount: number;
  readonly failures: readonly string[];
  readonly events: readonly CompactionRuntimeEvent[];
}

/** A recorded compaction event. */
export interface CompactionRuntimeEvent {
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly messagesBefore: number;
  readonly messagesAfter: number;
  readonly summary: string;
}

/** Dependencies injected into the compaction runtime. */
export interface CompactionRuntimeOptions {
  /** The pinned driver context window in tokens. */
  contextWindow: number;
  /** Override compaction settings. Enabled defaults to true when present. */
  settings?: Partial<CompactionSettings>;
  /** Summarizer function. Defaults to generateCompactionSummary. */
  summarizer?: (
    messages: AgentMessage[],
    focus: string,
    maxOutputTokens: number,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ) => Promise<string>;
  /** Durable append sink for compaction entries. */
  appendSink?: (entry: {
    type: 'compaction';
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
  }) => Promise<void>;
  /**
   * Resolve the mirror firstKeptEntryId to the durable id space.
   *
   * When present the runtime calls this before appendSink with the mirror
   * entry id and the mirror's cut message. The returned durable id flows
   * into the appendSink payload only. The mirror row keeps the mirror id.
   * A throw follows the existing fail-closed path: no sink, no end event,
   * failure recorded, messages unchanged.
   */
  resolveFirstKeptEntryId?: (
    mirrorFirstKeptEntryId: string,
    mirrorKeptMessage: AgentMessage,
  ) => Promise<string>;
  /** Emit one diagnostic trace line per successful compaction. */
  emitTrace?: (line: { message: string }) => void;
  /** Emit durable compaction card events for the workbench. */
  emitEvent?: (event: CompactionCardEvent) => void;
}

/** The return type of makeCompactionRuntime. */
export interface CompactionRuntime {
  transformContext: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  getTrace: () => CompactionRuntimeTrace;
  dispose: () => void;
}

// prettier-ignore
export function makeCompactionRuntime(opts: CompactionRuntimeOptions): CompactionRuntime {
  const settings = resolveCompactionSettings(opts.contextWindow, {
    ...opts.settings,
    enabled: opts.settings?.enabled ?? true,
  });
  const summarizer = opts.summarizer ?? generateCompactionSummary;
  const appendSink = opts.appendSink ?? (async () => {});
  const emitTrace = opts.emitTrace;
  const emitEvent = opts.emitEvent;
  let sessionPromise = new InMemorySessionRepo().create();
  let syncedMessages: AgentMessage[] = [];
  let disposed = false;
  const trace: {
    enabled: boolean;
    contextWindow: number;
    reserveTokens: number;
    keepRecentTokens: number;
    checkCount: number;
    triggerCount: number;
    failures: string[];
    events: CompactionRuntimeEvent[];
  } = {
    enabled: settings.enabled,
    contextWindow: opts.contextWindow,
    reserveTokens: settings.reserveTokens,
    keepRecentTokens: settings.keepRecentTokens,
    checkCount: 0,
    triggerCount: 0,
    failures: [],
    events: [],
  };
  const resetSession = async (messages: AgentMessage[]): Promise<Session> => {
    sessionPromise = new InMemorySessionRepo().create();
    const session = await sessionPromise;
    for (const message of messages) await session.appendMessage(message);
    syncedMessages = messages.slice();
    return session;
  };
  const syncSession = async (messages: AgentMessage[]): Promise<Session> => {
    const appendOnly =
      syncedMessages.length <= messages.length &&
      syncedMessages.every((msg, i) => msg === messages[i]);
    if (!appendOnly) return resetSession(messages);
    const session = await sessionPromise;
    for (let i = syncedMessages.length; i < messages.length; i += 1) {
      await session.appendMessage(messages[i]);
    }
    syncedMessages = messages.slice();
    return session;
  };
  return {
    transformContext: async (messages, signal) => {
      if (disposed || !settings.enabled) return messages;
      const session = await syncSession(messages);
      const context = await session.buildContext();
      const beforeMessages = context.messages;
      const tokensBefore = measureDriverContextTokens(beforeMessages);
      trace.checkCount += 1;
      if (!shouldCompact(tokensBefore, opts.contextWindow, settings)) {
        return beforeMessages;
      }
      try {
        const branch = await session.getBranch();
        const preparation = prepareCompaction(branch, settings);
        if (!preparation.ok) throw preparation.error;
        if (!preparation.value) return beforeMessages;
        const prep = preparation.value;
        emitEvent?.({
          kind: 'start',
          tokensBefore,
          messagesBefore: beforeMessages.length,
        });
        const summary = await summarizer(
          prep.messagesToSummarize,
          'Summarize the conversation history for context compaction.',
          prep.settings.reserveTokens,
          (text: string) => emitEvent?.({ kind: 'delta', text }),
          signal,
        );
        const entryId = await session.appendCompaction(
          summary,
          prep.firstKeptEntryId,
          tokensBefore,
        );
        // When a resolver is provided, resolve the mirror firstKeptEntryId
        // to the durable id space before the sink. The mirror row keeps the
        // mirror id; only the durable appendSink payload receives the
        // resolved id. The resolver runs inside the existing try so a throw
        // follows the fail-closed path (no sink, no end event, failure
        // recorded, messages unchanged).
        let sinkFirstKeptEntryId = prep.firstKeptEntryId;
        if (opts.resolveFirstKeptEntryId) {
          const mirrorKeptEntry = branch.find(
            (entry) => entry.id === prep.firstKeptEntryId,
          );
          if (
            !mirrorKeptEntry ||
            mirrorKeptEntry.type !== 'message' ||
            !('message' in mirrorKeptEntry)
          ) {
            throw new Error(
              'mirror kept entry is not a message entry; cannot resolve durable id',
            );
          }
          sinkFirstKeptEntryId = await opts.resolveFirstKeptEntryId(
            prep.firstKeptEntryId,
            (mirrorKeptEntry as { message: AgentMessage }).message,
          );
        }
        await appendSink({
          type: 'compaction',
          summary,
          firstKeptEntryId: sinkFirstKeptEntryId,
          tokensBefore,
        });
        const afterContext = await session.buildContext();
        const tokensAfter = measureDriverContextTokens(afterContext.messages);
        trace.triggerCount += 1;
        trace.events.push({
          tokensBefore,
          tokensAfter,
          messagesBefore: beforeMessages.length,
          messagesAfter: afterContext.messages.length,
          summary,
        });
        emitTrace?.({
          message: `compaction ${entryId} tokens ${tokensBefore}->${tokensAfter} summary ${summary.length}`,
        });
        // Emit end after the rebuild with real token counts
        emitEvent?.({
          kind: 'end',
          entryId,
          tokensBefore,
          tokensAfter,
          summary,
        });
        return afterContext.messages;
      } catch (error) {
        trace.failures.push(error instanceof Error ? error.message : String(error));
        return messages;
      }
    },
    getTrace: () => ({
      ...trace,
      failures: [...trace.failures],
      events: trace.events.map((e) => ({ ...e })),
    }),
    dispose: () => {
      disposed = true;
    },
  };
}

/**
 * Build a compaction summary from the conversation transcript.
 *
 * Resolves the summarizer model through resolveModel with the
 * maic-agent-compaction stage. A missing route throws before any LLM call.
 * The caller owns the abort signal and the token budget.
 *
 * @param messages - The assembled driver context messages.
 * @param focus - A guidance string for the summarizer.
 * @param maxOutputTokens - Token budget for the summary output.
 * @param onDelta - Callback receiving accumulated text on each streaming delta.
 * @param signal - Optional abort signal forwarded to the LLM call.
 */
// prettier-ignore
export async function generateCompactionSummary(messages: AgentMessage[], focus: string, maxOutputTokens: number, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const { resolveModel } = await import('@/lib/server/resolve-model');
  const { streamLLM } = await import('@/lib/ai/llm');
  const transcript = messages
    .map((m) => {
      const role = m.role ?? 'unknown';
      const c = 'content' in m ? m.content : undefined;
      return `${role}: ${typeof c === 'string' ? c : JSON.stringify(c)}`;
    })
    .join('\n');
  const resolved = await resolveModel({ stage: 'maic-agent-compaction' });
  const result = streamLLM(
    {
      model: resolved.model,
      system: `Summarize the following conversation. Focus: ${focus}`,
      prompt: transcript,
      maxOutputTokens,
      maxRetries: 0,
      abortSignal: signal,
    },
    'maic-agent-compaction',
    resolved.thinkingConfig,
  );
  let accumulated = '';
  for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
    if (part.type === 'text-delta') {
      const delta = (part.text ?? part.delta ?? part.textDelta ?? '') as string;
      if (delta) {
        accumulated += delta;
        onDelta(accumulated);
      }
    }
  }
  return accumulated.trim();
}
