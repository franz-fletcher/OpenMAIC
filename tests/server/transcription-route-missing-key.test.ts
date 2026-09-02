import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock fs — only intercept server-providers.yml so a host-machine YAML config
// can never leak into the route's provider-config (same pattern as
// tts-route-missing-key.test.ts).
let yamlOverride: string | null = null;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const isYaml = (p: unknown) => typeof p === 'string' && p.endsWith('server-providers.yml');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: string) => (isYaml(p) ? yamlOverride !== null : actual.existsSync(p)),
      readFileSync: (p: string, ...args: unknown[]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        isYaml(p) ? (yamlOverride ?? '') : (actual.readFileSync as any)(p, ...args),
    },
    existsSync: (p: string) => (isYaml(p) ? yamlOverride !== null : actual.existsSync(p)),
    readFileSync: (p: string, ...args: unknown[]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      isYaml(p) ? (yamlOverride ?? '') : (actual.readFileSync as any)(p, ...args),
  };
});

const mocks = vi.hoisted(() => ({ transcribeAudio: vi.fn() }));

vi.mock('@/lib/audio/asr-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audio/asr-providers')>();
  return { ...actual, transcribeAudio: mocks.transcribeAudio };
});

const ASR_ENV_PREFIXES = [
  'ASR_OPENAI',
  'ASR_QWEN',
  'ASR_QWEN_TOKEN_PLAN',
  'ASR_AZURE',
  'ASR_FUNASR',
  'ASR_LEMONADE',
  'ASR_BROWSER_NATIVE',
];

function clearAsrEnv() {
  for (const prefix of ASR_ENV_PREFIXES) {
    delete process.env[`${prefix}_API_KEY`];
    delete process.env[`${prefix}_BASE_URL`];
    delete process.env[`${prefix}_MODELS`];
    delete process.env[`${prefix}_ENABLED`];
  }
}

function transcriptionRequest(body: Record<string, unknown>): NextRequest {
  const formData = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      // FormData.set accepts string | Blob. Avoid String() on Blob objects.
      formData.set(key, value instanceof Blob ? value : String(value));
    }
  }
  return new NextRequest('http://localhost/api/transcription', {
    method: 'POST',
    body: formData,
  });
}

/** Built-in ASR providers whose registry entry has requiresApiKey: true. */
const KEYED_BUILTINS = ['openai-whisper', 'qwen-asr', 'qwen-token-plan-asr', 'azure-asr'];

describe('POST /api/transcription missing-key contract (batch 006)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearAsrEnv();
    yamlOverride = null;
    mocks.transcribeAudio.mockReset().mockResolvedValue({ text: 'hello' });
  });

  afterEach(() => vi.restoreAllMocks());

  // --- Four keyed built-ins return 400 MISSING_API_KEY and never dispatch ---

  it.each(KEYED_BUILTINS.map((id) => ({ providerId: id })))(
    'returns 400 MISSING_API_KEY for $providerId with no key (server or client)',
    async ({ providerId }) => {
      const { POST } = await import('@/app/api/transcription/route');
      const res = await POST(transcriptionRequest({ providerId, audio: new Blob(['x']) }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json).toMatchObject({
        success: false,
        errorCode: 'MISSING_API_KEY',
      });
      // The pre-flight rejects before any transcription call, so no socket opens.
      expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    },
  );

  it('never dispatches transcribeAudio on the MISSING_API_KEY path', async () => {
    const { POST } = await import('@/app/api/transcription/route');
    await POST(transcriptionRequest({ providerId: 'qwen-token-plan-asr', audio: new Blob(['x']) }));

    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  // --- Three keyless built-ins still dispatch ---

  it('still dispatches for keyless funasr-asr', async () => {
    const { POST } = await import('@/app/api/transcription/route');
    const res = await POST(
      transcriptionRequest({ providerId: 'funasr-asr', audio: new Blob(['x']) }),
    );

    expect(res.status).toBe(200);
    expect(mocks.transcribeAudio).toHaveBeenCalled();
  });

  it('still dispatches for keyless lemonade-asr', async () => {
    const { POST } = await import('@/app/api/transcription/route');
    const res = await POST(
      transcriptionRequest({ providerId: 'lemonade-asr', audio: new Blob(['x']) }),
    );

    expect(res.status).toBe(200);
    expect(mocks.transcribeAudio).toHaveBeenCalled();
  });

  it('still dispatches for keyless browser-native', async () => {
    // browser-native is keyless, so the route guard must not fire.
    // The library itself throws for browser-native, but the route dispatches.
    const { POST } = await import('@/app/api/transcription/route');
    mocks.transcribeAudio.mockRejectedValueOnce(
      new Error('Browser Native ASR must be handled client-side'),
    );
    const res = await POST(
      transcriptionRequest({ providerId: 'browser-native', audio: new Blob(['x']) }),
    );
    const json = await res.json();

    // Library throws → route returns 500 TRANSCRIPTION_FAILED.
    expect(res.status).toBe(500);
    expect(json.errorCode).toBe('TRANSCRIPTION_FAILED');
    // The route did dispatch — the guard did not pre-empt it.
    expect(mocks.transcribeAudio).toHaveBeenCalled();
  });

  // --- managed server key passes without client key ---

  it('managed server key passes without client key', async () => {
    yamlOverride = 'asr:\n  openai-whisper:\n    apiKey: sk-server\n';
    const { POST } = await import('@/app/api/transcription/route');
    const res = await POST(
      transcriptionRequest({ providerId: 'openai-whisper', audio: new Blob(['x']) }),
    );

    expect(res.status).toBe(200);
    expect(mocks.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai-whisper', apiKey: 'sk-server' }),
      expect.any(Blob),
    );
  });

  // --- unmanaged client key passes ---

  it('accepts a client-supplied key for an unmanaged keyed provider', async () => {
    const { POST } = await import('@/app/api/transcription/route');
    const res = await POST(
      transcriptionRequest({
        providerId: 'openai-whisper',
        apiKey: 'client-key',
        audio: new Blob(['x']),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'openai-whisper', apiKey: 'client-key' }),
      expect.any(Blob),
    );
  });

  // --- unchanged error contracts ---

  it('disabled provider still returns 403 unchanged', async () => {
    process.env.ASR_QWEN_TOKEN_PLAN_ENABLED = 'false';
    const { POST } = await import('@/app/api/transcription/route');
    const res = await POST(
      transcriptionRequest({ providerId: 'qwen-token-plan-asr', audio: new Blob(['x']) }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'PROVIDER_DISABLED',
    });
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  it('no-enabled-backend still returns 400 MISSING_PROVIDER unchanged', async () => {
    // Clear env + no yaml + no client providerId → no backend resolved.
    const { POST } = await import('@/app/api/transcription/route');
    const res = await POST(transcriptionRequest({ audio: new Blob(['x']) }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'MISSING_PROVIDER',
    });
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  it('downstream failure still returns 500 unchanged', async () => {
    mocks.transcribeAudio.mockRejectedValueOnce(new Error('upstream exploded'));
    const { POST } = await import('@/app/api/transcription/route');
    const res = await POST(
      transcriptionRequest({
        providerId: 'openai-whisper',
        apiKey: 'client-key',
        audio: new Blob(['x']),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'TRANSCRIPTION_FAILED',
    });
  });
});
