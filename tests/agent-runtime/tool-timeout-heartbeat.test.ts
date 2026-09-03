/**
 * Heartbeat tests for the global tool-call execution bound.
 *
 * The wrapper now resets the deadline timer whenever the tool reports progress
 * through the onUpdate callback, while a hard ceiling of 3x the base budget
 * caps total elapsed time. These tests use fake timers with a configurable
 * small base budget to verify three behaviors:
 *
 * (a) A tool that calls onUpdate repeatedly past the base budget completes.
 * (b) A silent tool still rejects with AgentToolTimeoutError at the base.
 * (c) Continuous progress past the ceiling rejects at exactly 3x base and
 *     the error message contains the fragment "execution budget and was aborted".
 *
 * Caller abort still rejects with AgentToolAbortedError immediately.
 */
import type { AgentTool, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentToolAbortedError,
  AgentToolTimeoutError,
  withAgentToolTimeout,
} from '@/lib/agent/runtime/tool-timeout';

const Params = Type.Object({});

type DemoTool = AgentTool<typeof Params>;

function makeTool(execute: DemoTool['execute']): DemoTool {
  return {
    name: 'test_tool',
    label: 'Test',
    description: 'Heartbeat test tool',
    parameters: Params,
    execute,
  };
}

const result = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  details: { source: 'tool' },
});

describe('withAgentToolTimeout heartbeat', () => {
  const BASE_BUDGET_MS = 1000;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes when calling onUpdate repeatedly past the base budget', async () => {
    process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS = String(BASE_BUDGET_MS);

    const emit = vi.fn<AgentToolUpdateCallback>();
    const wrappedTool = withAgentToolTimeout(
      makeTool(async (_id, _args, _signal, onUpdate) => {
        await new Promise<void>((r) => setTimeout(r, 900));
        onUpdate?.({
          content: [{ type: 'text' as const, text: 'progress at 900ms' }],
          details: { source: 'tool' },
        });

        await new Promise<void>((r) => setTimeout(r, 900));
        onUpdate?.({
          content: [{ type: 'text' as const, text: 'progress at 1800ms' }],
          details: { source: 'tool' },
        });

        await new Promise<void>((r) => setTimeout(r, 900));
        onUpdate?.({
          content: [{ type: 'text' as const, text: 'progress at 2700ms' }],
          details: { source: 'tool' },
        });

        return result('completed');
      }),
    );

    const promise = wrappedTool.execute('call-1', {}, undefined, emit);

    // Advance to 950ms (before base budget of 1000ms). First progress resets timer.
    await vi.advanceTimersByTimeAsync(950);
    expect(emit).toHaveBeenCalledTimes(1);

    // Advance another 950ms (total 1900ms, but timer was reset at 900ms).
    // Second progress resets timer.
    await vi.advanceTimersByTimeAsync(950);
    expect(emit).toHaveBeenCalledTimes(2);

    // Advance another 950ms (total 2850ms, but timer was reset at 1800ms).
    // Third progress resets timer.
    await vi.advanceTimersByTimeAsync(950);
    expect(emit).toHaveBeenCalledTimes(3);

    // Now let it complete. The tool should resolve.
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toEqual(result('completed'));
    expect(vi.getTimerCount()).toBe(0);

    delete process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS;
  });

  it('still rejects a silent tool with AgentToolTimeoutError at the base budget', async () => {
    process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS = String(BASE_BUDGET_MS);
    const emit = vi.fn<AgentToolUpdateCallback>();

    const silentTool: DemoTool = makeTool(() => new Promise(() => {}));
    const wrappedTool = withAgentToolTimeout(silentTool);

    const promise = wrappedTool.execute('call-1', {}, undefined, emit);
    // Attach handler BEFORE advancing so the rejection is never unhandled.
    const settled = expect(promise).rejects.toBeInstanceOf(AgentToolTimeoutError);

    await vi.advanceTimersByTimeAsync(BASE_BUDGET_MS);
    await settled;

    expect(emit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    delete process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS;
  });

  it('rejects at the 3x ceiling with the required error fragment', async () => {
    const CEILING_MS = BASE_BUDGET_MS * 3;
    process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS = String(BASE_BUDGET_MS);
    const emit = vi.fn<AgentToolUpdateCallback>();

    // Tool that always reports progress (never settles).
    const wrappedTool = withAgentToolTimeout(
      makeTool(async (_id, _args, _signal, onUpdate) => {
        for (let i = 0; i < 100; i++) {
          await new Promise<void>((r) => setTimeout(r, 200));
          onUpdate?.({
            content: [{ type: 'text' as const, text: `progress ${i}` }],
            details: { source: 'tool' },
          });
        }
        return result('should not reach');
      }),
    );

    const promise = wrappedTool.execute('call-1', {}, undefined, emit);

    // Attach the rejection handler BEFORE advancing time. The ceiling timer
    // fires during advanceTimersByTimeAsync and rejects the promise. If no
    // handler is attached at that instant, Node.js flags it as unhandled
    // even if a handler is added later.
    const settled = expect(promise).rejects.toBeInstanceOf(AgentToolTimeoutError);

    // Advance well past the 3x ceiling.
    await vi.advanceTimersByTimeAsync(CEILING_MS + 500);
    await settled;

    // Verify the error carries the ceiling budget and the required fragment.
    const error = await promise.catch((e: unknown) => e);
    expect((error as AgentToolTimeoutError).message).toContain('execution budget and was aborted');
    expect((error as AgentToolTimeoutError).timeoutMs).toBe(CEILING_MS);

    delete process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS;
  });

  it('caller abort still rejects immediately with AgentToolAbortedError', async () => {
    process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS = String(BASE_BUDGET_MS);
    const emit = vi.fn<AgentToolUpdateCallback>();

    const silentTool: DemoTool = makeTool(() => new Promise(() => {}));
    const wrappedTool = withAgentToolTimeout(silentTool);
    const controller = new AbortController();

    const promise = wrappedTool.execute('call-1', {}, controller.signal, emit);

    // Abort immediately, well before the base budget.
    controller.abort();

    const settled = expect(promise).rejects.toBeInstanceOf(AgentToolAbortedError);
    await vi.advanceTimersByTimeAsync(0);
    await settled;

    expect(vi.getTimerCount()).toBe(0);
    delete process.env.OPENMAIC_AGENT_TOOL_TIMEOUT_MS;
  });
});
