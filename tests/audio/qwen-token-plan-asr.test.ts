import { describe, expect, it, vi, afterEach } from 'vitest';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import { resolveASRProviderName } from '@/lib/audio/provider-display';
import { useSettingsStore } from '@/lib/store/settings';
import type { BuiltInASRProviderId } from '@/lib/audio/types';

/**
 * Slice S1 gates: registry identity for qwen-token-plan-asr.
 *
 * These tests prove the provider exists in every surface the S1 slice
 * owns. They do not test transcription logic (that is S2).
 */

// ---------------------------------------------------------------------------
// Union membership
// ---------------------------------------------------------------------------

describe('qwen-token-plan-asr identity', () => {
  it('includes the id in BuiltInASRProviderId', () => {
    const id: BuiltInASRProviderId = 'qwen-token-plan-asr';
    expect(id).toBe('qwen-token-plan-asr');
  });

  // ---------------------------------------------------------------------------
  // Registry record
  // ---------------------------------------------------------------------------

  it('has an ASR_PROVIDERS record with token-plan defaults', () => {
    const p = ASR_PROVIDERS['qwen-token-plan-asr'];
    expect(p).toBeDefined();
    expect(p.requiresApiKey).toBe(true);
    expect(p.defaultModelId).toBe('qwen-audio-3.0-asr-flash');
    expect(p.defaultBaseUrl).toBe('https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1');
    expect(p.models).toEqual([
      { id: 'qwen-audio-3.0-asr-flash', name: 'qwen-audio-3.0-asr-flash' },
    ]);
    expect(p.supportedFormats).toEqual(['wav', 'webm', 'mp3', 'opus']);
  });

  it('has exactly 31 supported language codes', () => {
    const langs = ASR_PROVIDERS['qwen-token-plan-asr'].supportedLanguages;
    expect(langs).toHaveLength(31);
    expect(langs).toContain('auto');
    expect(langs).toContain('zh');
    expect(langs).toContain('en');
    expect(langs).toContain('ja');
    expect(langs).toContain('ko');
    expect(langs).toContain('vi');
    expect(langs).toContain('th');
    expect(langs).toContain('hr');
    expect(langs).toContain('sk');
  });

  // ---------------------------------------------------------------------------
  // Display name
  // ---------------------------------------------------------------------------

  it('binds the display name key', () => {
    const fakeT = (key: string) => key;
    const name = resolveASRProviderName('qwen-token-plan-asr', fakeT);
    expect(name).toBe('settings.providerQwenTokenPlanASR');
  });

  // ---------------------------------------------------------------------------
  // Store default
  // ---------------------------------------------------------------------------

  it('injects a store default with modelId pinned', () => {
    const state = useSettingsStore.getState();
    const cfg = state.asrProvidersConfig['qwen-token-plan-asr'];
    expect(cfg).toBeDefined();
    expect(cfg.apiKey).toBe('');
    expect(cfg.baseUrl).toBe('');
    expect(cfg.modelId).toBe('qwen-audio-3.0-asr-flash');
    expect(cfg.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Slice S2: synchronous provider core
// ---------------------------------------------------------------------------

describe('qwen-token-plan-asr transcription', () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('sends model, input_audio content type, data URI prefix, and string parameters', async () => {
    let capturedBody: unknown;
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ text: 'hello' }), { status: 200 });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    const result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      Buffer.from('fake-audio-data'),
    );

    expect(result).toEqual({ text: 'hello' });
    const body = capturedBody as Record<string, unknown>;
    expect(body.model).toBe('qwen-audio-3.0-asr-flash');

    const messages = (body.input as Record<string, unknown>).messages as Array<
      Record<string, unknown>
    >;
    const content = messages[0].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe('input_audio');
    const audioData = (content[0].input_audio as Record<string, unknown>).data as string;
    expect(audioData).toMatch(/^data:audio\/.*;base64,/);

    const params = body.parameters as Record<string, unknown>;
    expect(typeof params.format).toBe('string');
    expect(typeof params.sample_rate).toBe('string');
  });

  it('detects wav format and reads sample rate from header', async () => {
    let capturedBody: unknown;
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ text: 'wav test' }), { status: 200 });
    }) as typeof fetch;

    // Build a minimal WAV header: RIFF....WAVE + fmt chunk + data chunk
    // Offset 24: sample rate as uint32 LE
    const wavHeader = Buffer.alloc(44);
    wavHeader.write('RIFF', 0, 'ascii');
    wavHeader.writeUInt32LE(36, 4);
    wavHeader.write('WAVE', 8, 'ascii');
    wavHeader.write('fmt ', 12, 'ascii');
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(16000, 24);
    wavHeader.writeUInt32LE(32000, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36, 'ascii');
    wavHeader.writeUInt32LE(0, 40);

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      wavHeader,
    );

    const body = capturedBody as Record<string, unknown>;
    const params = body.parameters as Record<string, unknown>;
    expect(params.format).toBe('wav');
    expect(params.sample_rate).toBe('16000');
  });

  it('detects webm format via EBML magic and reads OpusHead rate', async () => {
    let capturedBody: unknown;
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ text: 'webm test' }), { status: 200 });
    }) as typeof fetch;

    // EBML magic: 0x1A 0x45 0xDF 0xA3
    const webmBuf = Buffer.alloc(64);
    webmBuf[0] = 0x1a;
    webmBuf[1] = 0x45;
    webmBuf[2] = 0xdf;
    webmBuf[3] = 0xa3;
    // Place OpusHead marker at offset 20
    webmBuf.write('OpusHead', 20, 'ascii');
    webmBuf.writeUInt32LE(24000, 32);

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      webmBuf,
    );

    const body = capturedBody as Record<string, unknown>;
    const params = body.parameters as Record<string, unknown>;
    expect(params.format).toBe('webm');
    expect(params.sample_rate).toBe('24000');
  });

  it('defaults to wav/48000 for unknown container', async () => {
    let capturedBody: unknown;
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ text: 'unknown' }), { status: 200 });
    }) as typeof fetch;

    const unknownBuf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      unknownBuf,
    );

    const body = capturedBody as Record<string, unknown>;
    const params = body.parameters as Record<string, unknown>;
    expect(params.format).toBe('wav');
    expect(params.sample_rate).toBe('48000');
  });

  it('returns empty text on 400 with empty body', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('{}', { status: 400 });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    const result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      Buffer.from('fake-audio'),
    );

    expect(result).toEqual({ text: '' });
  });

  it('throws on non-OK status with status text', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('server error details', { status: 500 });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    await expect(
      transcribeAudio(
        {
          providerId: 'qwen-token-plan-asr',
          apiKey: 'sk-test',
          modelId: 'qwen-audio-3.0-asr-flash',
          baseUrl: 'https://example.com/api/v1',
        },
        Buffer.from('fake-audio'),
      ),
    ).rejects.toThrow(/500.*server error details/);
  });

  it('parses top-level text from response', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ text: 'transcribed' }), { status: 200 });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    const result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      Buffer.from('fake-audio'),
    );

    expect(result).toEqual({ text: 'transcribed' });
  });

  it('falls back to sentence.text when top-level text is missing', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ sentence: { text: 'fallback text' } }), { status: 200 });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    const result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      Buffer.from('fake-audio'),
    );

    expect(result).toEqual({ text: 'fallback text' });
  });

  it('falls back to output.output.sentence.text', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ output: { output: { sentence: { text: 'deep fallback' } } } }),
        { status: 200 },
      );
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    const result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      Buffer.from('fake-audio'),
    );

    expect(result).toEqual({ text: 'deep fallback' });
  });

  it('returns empty text when no recognized key exists', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ request_id: '123' }), { status: 200 });
    }) as typeof fetch;

    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    const result = await transcribeAudio(
      {
        providerId: 'qwen-token-plan-asr',
        apiKey: 'sk-test',
        modelId: 'qwen-audio-3.0-asr-flash',
        baseUrl: 'https://example.com/api/v1',
      },
      Buffer.from('fake-audio'),
    );

    expect(result).toEqual({ text: '' });
  });

  it('throws API key required error when key is missing', async () => {
    const { transcribeAudio } = await import('@/lib/audio/asr-providers');
    await expect(
      transcribeAudio(
        {
          providerId: 'qwen-token-plan-asr',
          modelId: 'qwen-audio-3.0-asr-flash',
          baseUrl: 'https://example.com/api/v1',
        },
        Buffer.from('fake-audio'),
      ),
    ).rejects.toThrow(/API key required/);
  });
});
