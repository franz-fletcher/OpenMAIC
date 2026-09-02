import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const aiMock = vi.hoisted(() => ({
  generateText: vi.fn(
    async (
      params: unknown,
    ): Promise<{ text: string; params: unknown; usage?: unknown; totalUsage?: unknown }> => ({
      text: 'ok',
      params,
    }),
  ),
  streamText: vi.fn(),
}));

const usageMock = vi.hoisted(() => ({
  normalizeUsage: vi.fn((usage: unknown) => usage),
  recordUsage: vi.fn(async () => undefined),
}));

vi.mock('ai', () => ({
  generateText: aiMock.generateText,
  streamText: aiMock.streamText,
}));

vi.mock('@/lib/usage/normalize', () => ({
  normalizeUsage: usageMock.normalizeUsage,
}));

vi.mock('@/lib/server/usage-storage', () => ({
  recordUsage: usageMock.recordUsage,
}));

import { callLLM } from '@/lib/ai/llm';

/** Connection-class error fixture matching @ai-sdk/provider-utils handleFetchError output. */
const CONNECTION_ERROR = Object.assign(new Error('Cannot connect to API: Headers Timeout Error'), {
  name: 'AI_APICallError',
  isRetryable: true,
  // No numeric statusCode — this is a connection-class failure.
});

/** Error with a numeric statusCode — must NOT be retried by the connection loop. */
const STATUS_ERROR = Object.assign(new Error('Server error'), {
  name: 'AI_APICallError',
  isRetryable: true,
  statusCode: 500,
});

const ORIGINAL_RETRIES = process.env.OPENMAIC_LLM_CONNECTION_RETRIES;
const ORIGINAL_BASE_MS = process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS;

describe('LLM connection retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    aiMock.generateText.mockClear();
    usageMock.normalizeUsage.mockClear();
    usageMock.recordUsage.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore env to avoid leaking into other tests.
    if (ORIGINAL_RETRIES === undefined) {
      delete process.env.OPENMAIC_LLM_CONNECTION_RETRIES;
    } else {
      process.env.OPENMAIC_LLM_CONNECTION_RETRIES = ORIGINAL_RETRIES;
    }
    if (ORIGINAL_BASE_MS === undefined) {
      delete process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS;
    } else {
      process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS = ORIGINAL_BASE_MS;
    }
  });

  it('retries transient connection error then succeeds', async () => {
    process.env.OPENMAIC_LLM_CONNECTION_RETRIES = '2';
    process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS = '100';

    // First call rejects with connection error, second succeeds.
    aiMock.generateText
      .mockRejectedValueOnce(CONNECTION_ERROR)
      .mockResolvedValueOnce({ text: 'recovered', params: undefined });

    const resultPromise = callLLM(
      { model: { provider: 'test', modelId: 'test' }, prompt: 'hi' } as Parameters<
        typeof callLLM
      >[0],
      'test-connection-retry',
    );

    // Advance past the backoff delay (base = 100ms).
    await vi.advanceTimersByTimeAsync(100);

    const result = await resultPromise;

    expect(result.text).toBe('recovered');
    expect(aiMock.generateText).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries and throws with Retry the call guidance', async () => {
    process.env.OPENMAIC_LLM_CONNECTION_RETRIES = '1'; // 1 retry = 2 attempts total
    process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS = '100';

    aiMock.generateText.mockRejectedValue(CONNECTION_ERROR);

    const resultPromise = callLLM(
      { model: { provider: 'test', modelId: 'test' }, prompt: 'hi' } as Parameters<
        typeof callLLM
      >[0],
      'test-connection-exhaust',
    );
    // Prevent unhandled-rejection warnings: the rejection fires during timer
    // advancement before the test's catch block runs.
    resultPromise.catch(() => {});

    // Advance past the backoff delay.
    await vi.advanceTimersByTimeAsync(100);

    let caughtError: unknown;
    try {
      await resultPromise;
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    const err = caughtError as Error;
    expect(err.name).toBe('AI_APICallError');
    expect(err.message).toContain('Cannot connect to API: Headers Timeout Error');
    expect(err.message).toContain('Retry the call');
    expect((err as { cause?: unknown }).cause).toBe(CONNECTION_ERROR);

    // retries=1 means 2 attempts.
    expect(aiMock.generateText).toHaveBeenCalledTimes(2);
  });

  it('does not retry errors with a numeric statusCode', async () => {
    process.env.OPENMAIC_LLM_CONNECTION_RETRIES = '2';
    process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS = '100';

    aiMock.generateText.mockRejectedValueOnce(STATUS_ERROR);

    await expect(
      callLLM(
        { model: { provider: 'test', modelId: 'test' }, prompt: 'hi' } as Parameters<
          typeof callLLM
        >[0],
        'test-connection-status',
      ),
    ).rejects.toBe(STATUS_ERROR);

    expect(aiMock.generateText).toHaveBeenCalledTimes(1);
  });

  it('does not retry a plain Error', async () => {
    process.env.OPENMAIC_LLM_CONNECTION_RETRIES = '2';
    process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS = '100';

    const plainError = new Error('some other error');
    aiMock.generateText.mockRejectedValueOnce(plainError);

    await expect(
      callLLM(
        { model: { provider: 'test', modelId: 'test' }, prompt: 'hi' } as Parameters<
          typeof callLLM
        >[0],
        'test-connection-plain',
      ),
    ).rejects.toBe(plainError);

    expect(aiMock.generateText).toHaveBeenCalledTimes(1);
  });

  it('disables retry loop when OPENMAIC_LLM_CONNECTION_RETRIES=0', async () => {
    process.env.OPENMAIC_LLM_CONNECTION_RETRIES = '0';
    process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS = '100';

    aiMock.generateText.mockRejectedValueOnce(CONNECTION_ERROR);

    await expect(
      callLLM(
        { model: { provider: 'test', modelId: 'test' }, prompt: 'hi' } as Parameters<
          typeof callLLM
        >[0],
        'test-connection-disabled',
      ),
    ).rejects.toBe(CONNECTION_ERROR);

    expect(aiMock.generateText).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff between attempts', async () => {
    process.env.OPENMAIC_LLM_CONNECTION_RETRIES = '2';
    process.env.OPENMAIC_LLM_CONNECTION_RETRY_BASE_MS = '50';

    // All attempts fail so we can observe the backoff timing.
    aiMock.generateText.mockRejectedValue(CONNECTION_ERROR);

    const resultPromise = callLLM(
      { model: { provider: 'test', modelId: 'test' }, prompt: 'hi' } as Parameters<
        typeof callLLM
      >[0],
      'test-connection-backoff',
    );
    // Prevent unhandled-rejection warnings during timer advancement.
    resultPromise.catch(() => {});

    // After 50ms (base delay) the first retry fires.
    await vi.advanceTimersByTimeAsync(50);
    expect(aiMock.generateText).toHaveBeenCalledTimes(2);

    // After another 100ms (base*2) the second retry fires.
    await vi.advanceTimersByTimeAsync(100);
    expect(aiMock.generateText).toHaveBeenCalledTimes(3);

    // Catch the rejection within this test scope to avoid unhandled rejection warnings.
    try {
      await resultPromise;
    } catch {
      // Expected: all attempts failed with CONNECTION_ERROR.
    }
  });
});
