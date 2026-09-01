import { describe, it, expect, vi, afterEach } from 'vitest';
import { ASR_PROVIDERS } from '@/lib/audio/constants';

/**
 * Protocol pin tests for qwen-token-plan-asr (slice S4 hermetic half).
 *
 * These tests record the exact request JSON shape and response-key
 * fallback order the vendor token-plan protocol requires. Any change
 * to the request body structure, the supportedLanguages list, or the
 * response parsing order breaks a pin here on purpose.
 */

describe('qwen-token-plan-asr protocol pin', () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('pins the 31-code supportedLanguages list from the registry', () => {
    const langs = ASR_PROVIDERS['qwen-token-plan-asr'].supportedLanguages;
    expect(langs).toEqual([
      'auto',
      'zh',
      'en',
      'ja',
      'ko',
      'vi',
      'th',
      'id',
      'ms',
      'tl',
      'hi',
      'ar',
      'fr',
      'de',
      'es',
      'pt',
      'ru',
      'it',
      'nl',
      'sv',
      'da',
      'fi',
      'no',
      'el',
      'pl',
      'cs',
      'hu',
      'ro',
      'bg',
      'hr',
      'sk',
    ]);
  });

  it('pins the exact request JSON shape (deep-equal)', async () => {
    let capturedBody: unknown;
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ text: 'pin test' }), { status: 200 });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-pin',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://pin.example/api/v1',
      },
      Buffer.from('test-audio-data'),
    );

    // Pin the exact top-level keys and structure
    const body = capturedBody as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['input', 'model', 'parameters']);

    // Pin the model
    expect(body.model).toBe('qwen-audio-3.0-asr-flash');

    // Pin the input shape
    const input = body.input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(['messages']);
    const messages = input.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    const content = messages[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('input_audio');
    const inputAudio = content[0].input_audio as Record<string, unknown>;
    expect(Object.keys(inputAudio).sort()).toEqual(['data']);
    expect(typeof inputAudio.data).toBe('string');
    expect(inputAudio.data).toMatch(/^data:audio\/.*;base64,/);

    // Pin the parameters shape: both keys must be strings
    const params = body.parameters as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(['format', 'sample_rate']);
    expect(typeof params.format).toBe('string');
    expect(typeof params.sample_rate).toBe('string');
  });

  it('pins response-key fallback order: text -> sentence.text -> output.output.sentence.text', async () => {
    // Case 1: top-level text wins
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'top-level', sentence: { text: 'ignored' } }), {
        status: 200,
      });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    let result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-pin',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://pin.example/api/v1',
      },
      Buffer.from('x'),
    );
    expect(result).toEqual({ text: 'top-level' });

    // Case 2: sentence.text when text is absent
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ sentence: { text: 'sentence-fallback' } }), {
        status: 200,
      });
    }) as typeof fetch;

    result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-pin',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://pin.example/api/v1',
      },
      Buffer.from('x'),
    );
    expect(result).toEqual({ text: 'sentence-fallback' });

    // Case 3: output.output.sentence.text when both text and sentence are absent
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ output: { output: { sentence: { text: 'deep-fallback' } } } }),
        { status: 200 },
      );
    }) as typeof fetch;

    result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-pin',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://pin.example/api/v1',
      },
      Buffer.from('x'),
    );
    expect(result).toEqual({ text: 'deep-fallback' });

    // Case 4: empty string when no key matches
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ request_id: '123' }), { status: 200 });
    }) as typeof fetch;

    result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-pin',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://pin.example/api/v1',
      },
      Buffer.from('x'),
    );
    expect(result).toEqual({ text: '' });
  });

  it('pins the endpoint URL: baseUrl + /services/aigc/multimodal-generation/generation', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-pin',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://pin.example/api/v1',
      },
      Buffer.from('x'),
    );

    expect(capturedUrl).toBe(
      'https://pin.example/api/v1/services/aigc/multimodal-generation/generation',
    );
  });

  it('pins error mapping: 400 -> empty text, other non-OK -> throw', async () => {
    const { transcribeAudio } = await import('@/lib/audio/asr-providers');

    // 400 with body -> still returns empty text
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ message: 'no speech' }), { status: 400 });
    }) as typeof fetch;

    let result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-pin',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://pin.example/api/v1',
      },
      Buffer.from('x'),
    );
    expect(result).toEqual({ text: '' });

    // 500 -> throw with status and text
    globalThis.fetch = vi.fn(async () => {
      return new Response('internal error', { status: 500 });
    }) as typeof fetch;

    await expect(
      transcribeAudio(
        {
          providerId: 'qwen-token-plan-asr',
          apiKey: 'sk-pin',
          modelId: 'qwen-audio-3.0-asr-flash',
          baseUrl: 'https://pin.example/api/v1',
        },
        Buffer.from('x'),
      ),
    ).rejects.toThrow(/500/);
  });
});
