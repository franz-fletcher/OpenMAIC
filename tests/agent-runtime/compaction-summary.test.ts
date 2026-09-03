import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/llm', () => ({
  callLLM: vi.fn(),
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: vi.fn(),
}));

describe('generateCompactionSummary', () => {
  let callLLM: ReturnType<typeof vi.fn>;
  let resolveModel: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    delete process.env.DEFAULT_MODEL;
    delete process.env.MODEL_ROUTES;
    const llm = await import('@/lib/ai/llm');
    const rm = await import('@/lib/server/resolve-model');
    callLLM = vi.mocked(llm.callLLM);
    resolveModel = vi.mocked(rm.resolveModel);
    callLLM.mockReset();
    resolveModel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls callLLM with stage maic-agent-compaction and returns the summary text', async () => {
    const { generateCompactionSummary } = await import('@/lib/server/agent-runtime/compaction');

    const mockModel = { modelId: 'test-model', provider: 'test-provider' };
    resolveModel.mockResolvedValue({
      model: mockModel as any,
      modelInfo: {} as any,
      modelString: 'test:model',
      providerId: 'test',
      modelId: 'model',
      apiKey: 'key',
    });
    callLLM.mockResolvedValue({
      text: '  summarized content  ',
    } as any);

    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there' }],
      },
    ] as any[];

    const result = await generateCompactionSummary(messages, 'key topics', 1024);

    expect(callLLM).toHaveBeenCalledOnce();
    expect(callLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        maxOutputTokens: 1024,
      }),
      'maic-agent-compaction',
      undefined,
      undefined,
    );
    expect(result).toBe('summarized content');
  });

  it('throws before calling callLLM when the stage has no route and no DEFAULT_MODEL', async () => {
    const { generateCompactionSummary } = await import('@/lib/server/agent-runtime/compaction');

    await expect(
      generateCompactionSummary(
        [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] as any[],
        'summary',
        1024,
      ),
    ).rejects.toThrow();

    expect(callLLM).not.toHaveBeenCalled();
  });

  it('does not import generateText or streamText from the ai SDK', () => {
    const filePath = resolve(process.cwd(), 'lib/server/agent-runtime/compaction.ts');
    const source = readFileSync(filePath, 'utf8');
    expect(source).not.toMatch(/from\s+['"]ai['"]/);
  });
});
