import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ResolvedModel } from '@/lib/server/resolve-model';

vi.mock('@/lib/ai/llm', () => ({
  streamLLM: vi.fn(),
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: vi.fn(),
}));

describe('generateCompactionSummary', () => {
  let streamLLM: ReturnType<typeof vi.fn>;
  let resolveModel: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    delete process.env.DEFAULT_MODEL;
    delete process.env.MODEL_ROUTES;
    const llm = await import('@/lib/ai/llm');
    const rm = await import('@/lib/server/resolve-model');
    streamLLM = vi.mocked(llm.streamLLM);
    resolveModel = vi.mocked(rm.resolveModel);
    streamLLM.mockReset();
    resolveModel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls streamLLM with stage maic-agent-compaction and returns the summary text', async () => {
    const { generateCompactionSummary } = await import('@/lib/server/agent-runtime/compaction');

    const mockModel = { modelId: 'test-model', provider: 'test-provider' };
    resolveModel.mockResolvedValue({
      model: mockModel as unknown as ResolvedModel['model'],
      modelInfo: {} as unknown as ResolvedModel['modelInfo'],
      modelString: 'test:model',
      providerId: 'test',
      modelId: 'model',
      apiKey: 'key',
      thinkingConfig: undefined,
    });
    streamLLM.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'summarized ' };
        yield { type: 'text-delta', text: 'content' };
        yield { type: 'finish' };
      })(),
    });

    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there' }],
      },
    ] as unknown as AgentMessage[];

    const result = await generateCompactionSummary(messages, 'key topics', 1024, () => {});

    expect(streamLLM).toHaveBeenCalledOnce();
    expect(streamLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        maxOutputTokens: 1024,
      }),
      'maic-agent-compaction',
      undefined,
    );
    expect(result).toBe('summarized content');
  });

  it('calls onDelta with accumulated text on each text-delta part', async () => {
    const { generateCompactionSummary } = await import('@/lib/server/agent-runtime/compaction');

    const mockModel = { modelId: 'test-model', provider: 'test-provider' };
    resolveModel.mockResolvedValue({
      model: mockModel as unknown as ResolvedModel['model'],
      modelInfo: {} as unknown as ResolvedModel['modelInfo'],
      modelString: 'test:model',
      providerId: 'test',
      modelId: 'model',
      apiKey: 'key',
      thinkingConfig: undefined,
    });
    streamLLM.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'Hello ' };
        yield { type: 'text-delta', text: 'world' };
        yield { type: 'text-delta', text: '!' };
        yield { type: 'finish' };
      })(),
    });

    const onDelta = vi.fn();
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    ] as unknown as AgentMessage[];

    await generateCompactionSummary(messages, 'focus', 1024, onDelta);

    expect(onDelta).toHaveBeenCalledTimes(3);
    expect(onDelta).toHaveBeenNthCalledWith(1, 'Hello ');
    expect(onDelta).toHaveBeenNthCalledWith(2, 'Hello world');
    expect(onDelta).toHaveBeenNthCalledWith(3, 'Hello world!');
  });

  it('passes the abort signal to streamLLM', async () => {
    const { generateCompactionSummary } = await import('@/lib/server/agent-runtime/compaction');

    const mockModel = { modelId: 'test-model', provider: 'test-provider' };
    resolveModel.mockResolvedValue({
      model: mockModel as unknown as ResolvedModel['model'],
      modelInfo: {} as unknown as ResolvedModel['modelInfo'],
      modelString: 'test:model',
      providerId: 'test',
      modelId: 'model',
      apiKey: 'key',
      thinkingConfig: undefined,
    });
    streamLLM.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', text: 'done' };
        yield { type: 'finish' };
      })(),
    });

    const controller = new AbortController();
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    ] as unknown as AgentMessage[];

    await generateCompactionSummary(messages, 'focus', 1024, () => {}, controller.signal);

    expect(streamLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: controller.signal,
      }),
      'maic-agent-compaction',
      undefined,
    );
  });

  it('throws before calling streamLLM when the stage has no route and no DEFAULT_MODEL', async () => {
    const { generateCompactionSummary } = await import('@/lib/server/agent-runtime/compaction');

    await expect(
      generateCompactionSummary(
        [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] as unknown as AgentMessage[],
        'summary',
        1024,
        () => {},
      ),
    ).rejects.toThrow();

    expect(streamLLM).not.toHaveBeenCalled();
  });

  it('does not import generateText or streamText from the ai SDK', () => {
    const filePath = resolve(process.cwd(), 'lib/server/agent-runtime/compaction.ts');
    const source = readFileSync(filePath, 'utf8');
    expect(source).not.toMatch(/from\s+['"]ai['"]/);
  });
});
