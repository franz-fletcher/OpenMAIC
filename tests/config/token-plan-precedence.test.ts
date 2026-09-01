/**
 * Precedence and clobber pins for the qwen-token-plan preset.
 *
 * Pins the rule that a server-managed env or yml value wins over the client
 * preset store, per field, for all five section resolvers. Also pins that
 * applyTokenPlan writes only the client store (no env/process writes) and
 * that re-applying overwrites prior client-side edits for shared provider ids.
 *
 * TDD note: this file pins EXISTING behavior shipped in S1. If any assertion
 * fails, it is a spec-vs-reality finding, not a reason to patch production
 * code without flagging.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Contract anchor: the five resolver pairs covered by this precedence pin.
// ---------------------------------------------------------------------------
export const PRECEDENCE_SECTIONS = [
  {
    section: 'llm',
    resolveApiKey: 'resolveApiKey',
    resolveBaseUrl: 'resolveBaseUrl',
  },
  {
    section: 'tts',
    resolveApiKey: 'resolveTTSApiKey',
    resolveBaseUrl: 'resolveTTSBaseUrl',
  },
  {
    section: 'asr',
    resolveApiKey: 'resolveASRApiKey',
    resolveBaseUrl: 'resolveASRBaseUrl',
  },
  {
    section: 'image',
    resolveApiKey: 'resolveImageApiKey',
    resolveBaseUrl: 'resolveImageBaseUrl',
  },
  {
    section: 'video',
    resolveApiKey: 'resolveVideoApiKey',
    resolveBaseUrl: 'resolveVideoBaseUrl',
  },
] as const;

// ---------------------------------------------------------------------------
// Env stub + module-reload pattern (mirrors tests/server/provider-config.test.ts)
// ---------------------------------------------------------------------------
const ENV_PREFIXES_TO_CLEAR = [
  'QWEN',
  'TTS_QWEN',
  'TTS_QWEN_TOKEN_PLAN',
  'ASR_QWEN',
  'ASR_QWEN_TOKEN_PLAN',
  'IMAGE_QWEN_IMAGE',
  'VIDEO_GROK',
];

function clearProviderEnv() {
  for (const prefix of ENV_PREFIXES_TO_CLEAR) {
    delete process.env[`${prefix}_API_KEY`];
    delete process.env[`${prefix}_BASE_URL`];
    delete process.env[`${prefix}_MODELS`];
    delete process.env[`${prefix}_ENABLED`];
  }
}

// Server-managed env values for the token-plan providers.
const SERVER_ENV = {
  QWEN_API_KEY: 'sk-server-qwen',
  QWEN_BASE_URL: 'https://server.example.com/qwen',
  TTS_QWEN_TOKEN_PLAN_API_KEY: 'sk-server-tts',
  TTS_QWEN_TOKEN_PLAN_BASE_URL: 'wss://server.example.com/tts',
  ASR_QWEN_TOKEN_PLAN_API_KEY: 'sk-server-asr',
  ASR_QWEN_TOKEN_PLAN_BASE_URL: 'https://server.example.com/asr',
  IMAGE_QWEN_IMAGE_API_KEY: 'sk-server-image',
  IMAGE_QWEN_IMAGE_BASE_URL: 'https://server.example.com/image',
  VIDEO_GROK_API_KEY: 'sk-server-video',
  VIDEO_GROK_BASE_URL: 'https://server.example.com/video',
} as const;

// Client store values (what applyTokenPlan writes to the client store).
const CLIENT_STORE = {
  llm: { apiKey: 'sk-client-qwen', baseUrl: 'https://client.example.com/qwen' },
  tts: { apiKey: 'sk-client-tts', baseUrl: 'wss://client.example.com/tts' },
  asr: { apiKey: 'sk-client-asr', baseUrl: 'https://client.example.com/asr' },
  image: { apiKey: 'sk-client-image', baseUrl: 'https://client.example.com/image' },
  video: { apiKey: 'sk-client-video', baseUrl: 'https://client.example.com/video' },
} as const;

describe('token-plan precedence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    clearProviderEnv();
  });

  // -----------------------------------------------------------------------
  // (1) Server-managed env present: resolvers return SERVER values.
  // -----------------------------------------------------------------------
  describe('server values win when server env is present', () => {
    for (const entry of PRECEDENCE_SECTIONS) {
      describe(`${entry.section} resolvers`, () => {
        it('resolveApiKey returns server value over client store value', async () => {
          for (const [k, v] of Object.entries(SERVER_ENV)) vi.stubEnv(k, v);
          const {
            resolveApiKey,
            resolveTTSApiKey,
            resolveASRApiKey,
            resolveImageApiKey,
            resolveVideoApiKey,
          } = await import('@/lib/server/provider-config');
          const resolvers = {
            resolveApiKey,
            resolveTTSApiKey,
            resolveASRApiKey,
            resolveImageApiKey,
            resolveVideoApiKey,
          };
          const fn = resolvers[entry.resolveApiKey as keyof typeof resolvers];
          const clientVal = CLIENT_STORE[entry.section].apiKey;
          const serverVal =
            SERVER_ENV[
              `${entry.section === 'llm' ? 'QWEN' : entry.section === 'tts' ? 'TTS_QWEN_TOKEN_PLAN' : entry.section === 'asr' ? 'ASR_QWEN_TOKEN_PLAN' : entry.section === 'image' ? 'IMAGE_QWEN_IMAGE' : 'VIDEO_GROK'}_API_KEY` as keyof typeof SERVER_ENV
            ];
          const providerId =
            entry.section === 'llm'
              ? 'qwen'
              : entry.section === 'tts'
                ? 'qwen-token-plan-tts'
                : entry.section === 'asr'
                  ? 'qwen-token-plan-asr'
                  : entry.section === 'image'
                    ? 'qwen-image'
                    : 'grok-video';
          expect(fn(providerId, clientVal)).toBe(serverVal);
        });

        it('resolveBaseUrl returns server value over client store value', async () => {
          for (const [k, v] of Object.entries(SERVER_ENV)) vi.stubEnv(k, v);
          const {
            resolveBaseUrl,
            resolveTTSBaseUrl,
            resolveASRBaseUrl,
            resolveImageBaseUrl,
            resolveVideoBaseUrl,
          } = await import('@/lib/server/provider-config');
          const resolvers = {
            resolveBaseUrl,
            resolveTTSBaseUrl,
            resolveASRBaseUrl,
            resolveImageBaseUrl,
            resolveVideoBaseUrl,
          };
          const fn = resolvers[entry.resolveBaseUrl as keyof typeof resolvers];
          const clientVal = CLIENT_STORE[entry.section].baseUrl;
          const serverVal =
            SERVER_ENV[
              `${entry.section === 'llm' ? 'QWEN' : entry.section === 'tts' ? 'TTS_QWEN_TOKEN_PLAN' : entry.section === 'asr' ? 'ASR_QWEN_TOKEN_PLAN' : entry.section === 'image' ? 'IMAGE_QWEN_IMAGE' : 'VIDEO_GROK'}_BASE_URL` as keyof typeof SERVER_ENV
            ];
          const providerId =
            entry.section === 'llm'
              ? 'qwen'
              : entry.section === 'tts'
                ? 'qwen-token-plan-tts'
                : entry.section === 'asr'
                  ? 'qwen-token-plan-asr'
                  : entry.section === 'image'
                    ? 'qwen-image'
                    : 'grok-video';
          expect(fn(providerId, clientVal)).toBe(serverVal);
        });
      });
    }
  });

  // -----------------------------------------------------------------------
  // (2) No server entry: resolvers return client store values.
  // -----------------------------------------------------------------------
  describe('client values win when no server entry exists', () => {
    for (const entry of PRECEDENCE_SECTIONS) {
      describe(`${entry.section} resolvers`, () => {
        it('resolveApiKey returns client value when no server env', async () => {
          const {
            resolveApiKey,
            resolveTTSApiKey,
            resolveASRApiKey,
            resolveImageApiKey,
            resolveVideoApiKey,
          } = await import('@/lib/server/provider-config');
          const resolvers = {
            resolveApiKey,
            resolveTTSApiKey,
            resolveASRApiKey,
            resolveImageApiKey,
            resolveVideoApiKey,
          };
          const fn = resolvers[entry.resolveApiKey as keyof typeof resolvers];
          const clientVal = CLIENT_STORE[entry.section].apiKey;
          const providerId =
            entry.section === 'llm'
              ? 'qwen'
              : entry.section === 'tts'
                ? 'qwen-token-plan-tts'
                : entry.section === 'asr'
                  ? 'qwen-token-plan-asr'
                  : entry.section === 'image'
                    ? 'qwen-image'
                    : 'grok-video';
          expect(fn(providerId, clientVal)).toBe(clientVal);
        });

        it('resolveBaseUrl returns client value when no server env', async () => {
          const {
            resolveBaseUrl,
            resolveTTSBaseUrl,
            resolveASRBaseUrl,
            resolveImageBaseUrl,
            resolveVideoBaseUrl,
          } = await import('@/lib/server/provider-config');
          const resolvers = {
            resolveBaseUrl,
            resolveTTSBaseUrl,
            resolveASRBaseUrl,
            resolveImageBaseUrl,
            resolveVideoBaseUrl,
          };
          const fn = resolvers[entry.resolveBaseUrl as keyof typeof resolvers];
          const clientVal = CLIENT_STORE[entry.section].baseUrl;
          const providerId =
            entry.section === 'llm'
              ? 'qwen'
              : entry.section === 'tts'
                ? 'qwen-token-plan-tts'
                : entry.section === 'asr'
                  ? 'qwen-token-plan-asr'
                  : entry.section === 'image'
                    ? 'qwen-image'
                    : 'grok-video';
          expect(fn(providerId, clientVal)).toBe(clientVal);
        });
      });
    }
  });

  // -----------------------------------------------------------------------
  // (3) applyTokenPlan writes only the client store (no env/process writes).
  // -----------------------------------------------------------------------
  describe('apply writes only client store, not server env', () => {
    it('applyTokenPlan does not write process.env or mutate server state', async () => {
      const { applyTokenPlan } = await import('@/lib/config/apply-token-plan');
      const { TOKEN_PLAN_PRESETS } = await import('@/lib/config/token-plan-presets');
      const qwen = TOKEN_PLAN_PRESETS.find((p) => p.id === 'qwen-token-plan')!;

      const envBefore = { ...process.env };

      const actions = {
        setProviderConfig: vi.fn(),
        setImageProviderConfig: vi.fn(),
        setVideoProviderConfig: vi.fn(),
        setTTSProviderConfig: vi.fn(),
        setASRProviderConfig: vi.fn(),
        setWebSearchProviderConfig: vi.fn(),
      };

      applyTokenPlan(qwen, 'sk-sp-test', actions);

      // applyTokenPlan calls actions that write to the client store (Zustand).
      // It must NOT write to process.env or any server-managed state.
      expect(process.env).toEqual(envBefore);

      // Verify all five setter calls target the client store via actions,
      // not through env manipulation.
      expect(actions.setProviderConfig).toHaveBeenCalledTimes(1);
      expect(actions.setImageProviderConfig).toHaveBeenCalledTimes(1);
      expect(actions.setVideoProviderConfig).toHaveBeenCalledTimes(1);
      expect(actions.setTTSProviderConfig).toHaveBeenCalledTimes(1);
      expect(actions.setASRProviderConfig).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // (4) Clobber caveat: re-apply overwrites prior client-side edits for shared
  //     provider ids (qwen, qwen-image, happyhorse) while leaving untouched
  //     modalities alone.
  // -----------------------------------------------------------------------
  describe('clobber caveat: re-apply overwrites shared ids', () => {
    it('applying qwen-token-plan twice overwrites the first key for all five shared ids', async () => {
      const { applyTokenPlan } = await import('@/lib/config/apply-token-plan');
      const { TOKEN_PLAN_PRESETS } = await import('@/lib/config/token-plan-presets');
      const qwen = TOKEN_PLAN_PRESETS.find((p) => p.id === 'qwen-token-plan')!;

      const callLog: Array<{ id: string; config: Record<string, unknown> }> = [];

      const actions = {
        setProviderConfig: vi.fn((id: string, config: Record<string, unknown>) => {
          callLog.push({ id, config });
        }),
        setImageProviderConfig: vi.fn((id: string, config: Record<string, unknown>) => {
          callLog.push({ id, config });
        }),
        setVideoProviderConfig: vi.fn((id: string, config: Record<string, unknown>) => {
          callLog.push({ id, config });
        }),
        setTTSProviderConfig: vi.fn((id: string, config: Record<string, unknown>) => {
          callLog.push({ id, config });
        }),
        setASRProviderConfig: vi.fn((id: string, config: Record<string, unknown>) => {
          callLog.push({ id, config });
        }),
        setWebSearchProviderConfig: vi.fn(),
      };

      // First apply with key "sk-first".
      applyTokenPlan(qwen, 'sk-first', actions);
      const firstApplyCount = callLog.length;

      // Second apply with key "sk-second" — overwrites the first.
      applyTokenPlan(qwen, 'sk-second', actions);

      // The second apply produced the same number of setter calls (one per modality).
      expect(callLog.length).toBe(firstApplyCount * 2);

      // For each shared provider id, the second apply's config must carry the new key.
      const sharedIds = [
        'qwen',
        'qwen-image',
        'happyhorse',
        'qwen-token-plan-tts',
        'qwen-token-plan-asr',
      ];
      for (const id of sharedIds) {
        const secondCall = callLog.find(
          (c) => c.id === id && callLog.indexOf(c) >= firstApplyCount,
        );
        expect(secondCall).toBeDefined();
        expect(secondCall!.config.apiKey).toBe('sk-second');
      }
    });

    it('untouched modalities (webSearch) are not affected by re-apply', async () => {
      const { applyTokenPlan } = await import('@/lib/config/apply-token-plan');
      const { TOKEN_PLAN_PRESETS } = await import('@/lib/config/token-plan-presets');
      const qwen = TOKEN_PLAN_PRESETS.find((p) => p.id === 'qwen-token-plan')!;

      const actions = {
        setProviderConfig: vi.fn(),
        setImageProviderConfig: vi.fn(),
        setVideoProviderConfig: vi.fn(),
        setTTSProviderConfig: vi.fn(),
        setASRProviderConfig: vi.fn(),
        setWebSearchProviderConfig: vi.fn(),
      };

      // qwen-token-plan has no webSearch target.
      applyTokenPlan(qwen, 'sk-test', actions);
      expect(actions.setWebSearchProviderConfig).not.toHaveBeenCalled();
    });
  });
});
