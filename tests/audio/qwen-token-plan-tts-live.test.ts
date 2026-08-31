import { describe, expect, it } from 'vitest';

/**
 * Opt-in live smoke test for qwen-token-plan-tts (slice S4, live half).
 *
 * Gate: runs only with `TEST_LOAD_LOCAL_ENV=1` and a resolved plan key.
 * `tests/setup-env.ts` loads `.env.local` only under that flag, and CI has no
 * `.env.local` at all, so the default `pnpm test` run skips this file with a
 * printed reason. Run it with the S4 gate command:
 *
 *   TEST_LOAD_LOCAL_ENV=1 npx vitest run tests/audio/qwen-token-plan-tts-live.test.ts
 *
 * Key resolution: the file reads `TTS_QWEN_TOKEN_PLAN_API_KEY` first, the
 * per-modality variable the S3 wiring serves. When that is unset it falls
 * back to `TTS_QWEN_API_KEY`, because the plan hosts the same DashScope
 * account credential. The server route resolves through
 * `resolveTTSApiKey()` in `lib/server/provider-config.ts`; that resolver
 * returns an empty string for this provider unless a `TTS_QWEN_TOKEN_PLAN_*`
 * entry exists, so the direct read with the documented fallback is the
 * variant that can actually run the gate. The base URL keeps route parity:
 * `TTS_QWEN_TOKEN_PLAN_BASE_URL` overrides the registry default endpoint.
 *
 * Cost note: each passing synthesis is a real vendor request. Tests A and B
 * are one synthesis each. Test C costs one rejected request plus one short
 * recovery synthesis that proves the pool discarded the failed connection.
 */

import { TTS_PROVIDERS } from '@/lib/audio/constants';
import type { TTSVoiceInfo } from '@/lib/audio/types';
import { QwenTTSError } from '@/lib/audio/tts-providers';
import { generateQwenTokenPlanTTS, QwenTokenPlanTTSError } from '@/lib/audio/qwen-token-plan-ws';

const PROVIDER_ID = 'qwen-token-plan-tts';
const PLUS_MODEL = 'qwen-audio-3.0-tts-plus';
const FLASH_MODEL = 'qwen-audio-3.0-tts-flash';
const FLASH_VOICE = 'longanfengyue';

/** Per-test budget. Live RTT plus synthesis takes 5-15s per short phrase. */
const LIVE_TIMEOUT_MS = 60_000;

/** Resolve the live plan key: per-modality var first, account var fallback. */
function resolveLiveApiKey(): string {
  return (
    process.env.TTS_QWEN_TOKEN_PLAN_API_KEY?.trim() || process.env.TTS_QWEN_API_KEY?.trim() || ''
  );
}

/** Resolve the endpoint the same way the route's resolver chains. */
function resolveLiveBaseUrl(): string {
  return (
    process.env.TTS_QWEN_TOKEN_PLAN_BASE_URL?.trim() ||
    TTS_PROVIDERS[PROVIDER_ID].defaultBaseUrl ||
    ''
  );
}

/**
 * True for an mp3 stream start: an ID3v2 tag or an MPEG frame sync word
 * (11 set bits). The vendor streams raw mp3, so either header is valid.
 */
function hasMp3Magic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 3) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // 'ID3'
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0; // frame sync
}

/**
 * One gated live synthesis. Runs the real client against the plan endpoint
 * and rejects anything that is not a plausible mp3 body, so callers only
 * need to check the byte count and format.
 */
export async function qwenTokenPlanTtsLiveSmoke(
  text: string,
  voice: string,
  model: string,
): Promise<{ bytes: number; format: string }> {
  const apiKey = resolveLiveApiKey();
  if (!apiKey) {
    throw new Error('qwen-token-plan-tts live smoke has no resolved plan key.');
  }
  const result = await generateQwenTokenPlanTTS(
    {
      providerId: PROVIDER_ID,
      apiKey,
      baseUrl: resolveLiveBaseUrl(),
      modelId: model,
      voice,
    },
    text,
  );
  const bytes = result.audio.byteLength;
  if (!hasMp3Magic(result.audio)) {
    throw new QwenTokenPlanTTSError(
      `qwen-token-plan-tts live smoke: payload of ${bytes} bytes does not start with an mp3 header.`,
    );
  }
  // Evidence line for the gate report: sizes only, never the key.
  console.log(
    `[qwen-token-plan-tts-live] ok model=${model} voice=${voice} bytes=${bytes} format=${result.format}`,
  );
  return { bytes, format: result.format };
}

const liveEnabled = process.env.TEST_LOAD_LOCAL_ENV === '1';
const liveApiKey = liveEnabled ? resolveLiveApiKey() : '';
const skipReason = !liveEnabled
  ? 'TEST_LOAD_LOCAL_ENV is not "1"; .env.local is not loaded and live probes stay opt-in.'
  : !liveApiKey
    ? 'No plan key: set TTS_QWEN_TOKEN_PLAN_API_KEY or TTS_QWEN_API_KEY in .env.local.'
    : '';

if (!liveEnabled || !liveApiKey) {
  console.log(`[qwen-token-plan-tts-live] SKIPPED: ${skipReason}`);
  describe('qwen-token-plan-tts live smoke', () => {
    it.skip('live probes (reason printed by the module loader)', () => {});
  });
} else {
  describe('qwen-token-plan-tts live smoke', () => {
    it(
      'synthesizes mp3 audio for the plus model with longanlingxin',
      { timeout: LIVE_TIMEOUT_MS },
      async () => {
        const result = await qwenTokenPlanTtsLiveSmoke('你好，世界', 'longanlingxin', PLUS_MODEL);

        expect(result.format).toBe('mp3');
        // A real two-word Chinese phrase is far above one empty frame. The
        // mp3 magic-header check runs inside the smoke wrapper.
        expect(result.bytes).toBeGreaterThan(1000);
      },
    );

    it(
      'synthesizes mp3 audio for the flash model with a registry voice',
      { timeout: LIVE_TIMEOUT_MS },
      async () => {
        // The voice must exist in the curated registry for the flash model,
        // otherwise the picker could offer a voice the plan rejects.
        const registryVoice: TTSVoiceInfo | undefined = TTS_PROVIDERS[PROVIDER_ID].voices.find(
          (voice) =>
            voice.id === FLASH_VOICE && (voice.compatibleModels ?? []).includes(FLASH_MODEL),
        );
        expect(registryVoice).toBeDefined();

        const result = await qwenTokenPlanTtsLiveSmoke('你好，世界', FLASH_VOICE, FLASH_MODEL);

        expect(result.format).toBe('mp3');
        expect(result.bytes).toBeGreaterThan(1000);
      },
    );

    it(
      'rejects an unknown voice with a typed error and recovers on the same pool',
      { timeout: LIVE_TIMEOUT_MS },
      async () => {
        const err = await qwenTokenPlanTtsLiveSmoke(
          '你好',
          'definitely-not-a-real-voice',
          PLUS_MODEL,
        ).catch((error) => error);

        expect(err).toBeInstanceOf(QwenTTSError);
        expect(err).toBeInstanceOf(QwenTokenPlanTTSError);
        // The vendor names the problem in error_code / error_message. The
        // combined text must mention a parameter, engine, or voice fault.
        const vendorSignal =
          `${String((err as QwenTokenPlanTTSError).errorCode ?? '')} ` +
          `${(err as QwenTokenPlanTTSError).errorMessage ?? ''}`.toLowerCase();
        expect(vendorSignal).toMatch(/invalid|parameter|engine|voice/);

        // Discard proof: the failed connection must not poison the shared
        // pool. One short synthesis right after the rejection proves it.
        const recovered = await qwenTokenPlanTtsLiveSmoke('好', 'longanlingxin', PLUS_MODEL);
        expect(recovered.bytes).toBeGreaterThan(1000);
      },
    );
  });
}
