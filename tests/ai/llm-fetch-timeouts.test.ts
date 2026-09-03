/**
 * Assert that the LLM fetch path used by scene generation applies raised or
 * disabled undici headersTimeout and bodyTimeout.
 *
 * Strategy: mock the AI SDK provider constructor (@ai-sdk/openai) to capture
 * the fetch option passed to it. The compatFetch wrapper injects a dispatcher
 * (undici Agent with headersTimeout: 0 and bodyTimeout: 0) on the RequestInit
 * before calling globalThis.fetch.
 *
 * Note: only the compat transport (OpenAI-compatible providers like xiaomi,
 * qwen, deepseek) uses a custom fetch wrapper. Native providers (Anthropic,
 * Google) use the SDK's built-in HTTP client which does not go through the
 * compatFetch path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const openaiMock = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: openaiMock.createOpenAI,
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(),
}));
vi.mock('@ai-sdk/azure', () => ({
  createAzure: vi.fn(),
}));
vi.mock('@ai-sdk/amazon-bedrock', () => ({
  createAmazonBedrock: vi.fn(),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(),
}));
vi.mock('@/lib/usage/normalize', () => ({
  normalizeUsage: vi.fn((usage: unknown) => usage),
}));
vi.mock('@/lib/server/usage-storage', () => ({
  recordUsage: vi.fn(async () => undefined),
}));

import { getModel } from '@/lib/ai/providers';

// Fake model returned by the mock provider factory.
const fakeModel = {
  doGenerate: vi.fn(async () => ({ text: 'ok', usage: {} })),
  doStream: vi.fn(async function* () {}),
};

describe('LLM fetch timeout configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('compat fetch path (xiaomi) injects a dispatcher on globalThis.fetch', async () => {
    let capturedFetch: typeof globalThis.fetch | undefined;

    openaiMock.createOpenAI.mockImplementation((opts: Record<string, unknown>) => {
      capturedFetch = opts.fetch as typeof globalThis.fetch;
      return {
        chat: () => fakeModel,
        responses: () => fakeModel,
      };
    });

    getModel({
      providerId: 'xiaomi',
      modelId: 'mimo-v2.5',
      apiKey: 'test-key',
    });

    expect(capturedFetch).toBeDefined();

    const originalFetch = globalThis.fetch;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response('{}', { status: 200 });
    }) as typeof globalThis.fetch;

    try {
      await capturedFetch!('https://api.xiaomimimo.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'mimo-v2.5', stream: false }),
      });
    } catch {
      // May fail due to mock response.
    }

    globalThis.fetch = originalFetch;

    // The compatFetch wraps globalThis.fetch and injects a dispatcher.
    // The dispatcher is an undici Agent configured with headersTimeout: 0
    // and bodyTimeout: 0, so long-running LLM requests are not killed by
    // undici's default 300 s caps.
    const d = (capturedInit as Record<string, unknown> | undefined)?.dispatcher as
      | Record<string, unknown>
      | undefined;
    expect(d).toBeDefined();
    // The dispatcher is an undici Agent instance (has a dispatch method).
    expect(typeof d?.dispatch).toBe('function');
  });

  it('compat fetch path (qwen) also injects the dispatcher', async () => {
    let capturedFetch: typeof globalThis.fetch | undefined;

    openaiMock.createOpenAI.mockImplementation((opts: Record<string, unknown>) => {
      capturedFetch = opts.fetch as typeof globalThis.fetch;
      return {
        chat: () => fakeModel,
        responses: () => fakeModel,
      };
    });

    getModel({
      providerId: 'qwen',
      modelId: 'qwen-turbo',
      apiKey: 'test-key',
    });

    expect(capturedFetch).toBeDefined();

    const originalFetch = globalThis.fetch;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response('{}', { status: 200 });
    }) as typeof globalThis.fetch;

    try {
      await capturedFetch!('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'qwen-turbo', stream: false }),
      });
    } catch {
      // May fail.
    }

    globalThis.fetch = originalFetch;

    const d = (capturedInit as Record<string, unknown> | undefined)?.dispatcher as
      | Record<string, unknown>
      | undefined;
    expect(d).toBeDefined();
    expect(typeof d?.dispatch).toBe('function');
  });
});
