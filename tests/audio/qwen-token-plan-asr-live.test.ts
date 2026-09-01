import { describe, expect, it } from 'vitest';

/**
 * Opt-in live smoke test for qwen-token-plan-asr (slice S4, live half).
 *
 * Gate: runs only with `TEST_LOAD_LOCAL_ENV=1` and a resolved ASR key.
 * `tests/setup-env.ts` loads `.env.local` only under that flag, and CI has no
 * `.env.local` at all, so the default `pnpm test` run skips this file with a
 * printed reason. Run it with the S4 gate command:
 *
 *   TEST_LOAD_LOCAL_ENV=1 npx vitest run tests/audio/qwen-token-plan-asr-live.test.ts
 *
 * Key resolution: the file reads `ASR_QWEN_TOKEN_PLAN_API_KEY` only. The TTS
 * fallback is not allowed because the operator already added the ASR key to
 * `.env.local`. The base URL uses the registry default for this provider.
 *
 * Cost note: each passing test is a real vendor request. Budget: <=4 requests.
 */

import { ASR_PROVIDERS } from '@/lib/audio/constants';
import { transcribeAudio } from '@/lib/audio/asr-providers';
import type { ASRModelConfig } from '@/lib/audio/types';

const PROVIDER_ID = 'qwen-token-plan-asr';

/** Vendor's public sample: 128480 bytes, 16 kHz mono PCM16, ~5 s. */
const VENDOR_SAMPLE_URL =
  'https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav';

/** Per-test budget. Live RTT plus transcription takes 5-15 s. */
const LIVE_TIMEOUT_MS = 60_000;

/** Resolve the live plan key: per-modality var only, no TTS fallback. */
function resolveLiveApiKey(): string {
  return process.env.ASR_QWEN_TOKEN_PLAN_API_KEY?.trim() || '';
}

/**
 * Smoke function with the frozen signature: zero params, returns transcript.
 * Fetches the vendor sample, base64-encodes it, calls transcribeAudio with
 * a resolved config. Using transcribeAudio (not the private internal) avoids
 * server plumbing — the test runs in-process through the public dispatch.
 */
export async function qwenTokenPlanAsrLiveSmoke(): Promise<string> {
  const apiKey = resolveLiveApiKey();
  if (!apiKey) {
    throw new Error('qwen-token-plan-asr live smoke has no resolved plan key.');
  }

  // Fetch the public sample. The CDN object is auth-free and 128480 bytes.
  const resp = await fetch(VENDOR_SAMPLE_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch vendor sample: ${resp.status} ${resp.statusText}`);
  }
  const wavBytes = Buffer.from(await resp.arrayBuffer());

  const config: ASRModelConfig = {
    providerId: PROVIDER_ID,
    apiKey,
    baseUrl: ASR_PROVIDERS[PROVIDER_ID].defaultBaseUrl || '',
    modelId: ASR_PROVIDERS[PROVIDER_ID].defaultModelId,
  };

  const result = await transcribeAudio(config, wavBytes);
  return result.text;
}

const liveEnabled = process.env.TEST_LOAD_LOCAL_ENV === '1';
const liveApiKey = liveEnabled ? resolveLiveApiKey() : '';
const skipReason = !liveEnabled
  ? 'TEST_LOAD_LOCAL_ENV is not "1"; .env.local is not loaded and live probes stay opt-in.'
  : !liveApiKey
    ? 'No plan key: set ASR_QWEN_TOKEN_PLAN_API_KEY in .env.local.'
    : '';

if (!liveEnabled || !liveApiKey) {
  console.log(`[qwen-token-plan-asr-live] SKIPPED: ${skipReason}`);
  describe('qwen-token-plan-asr live smoke', () => {
    it.skip('live probes (reason printed by the module loader)', () => {});
  });
} else {
  describe('qwen-token-plan-asr live smoke', () => {
    it(
      'transcribes the vendor sample and starts with "hello world"',
      { timeout: LIVE_TIMEOUT_MS },
      async () => {
        const transcript = await qwenTokenPlanAsrLiveSmoke();

        expect(transcript).toBeTruthy();
        expect(transcript.toLowerCase()).toMatch(/^hello world/);
        console.log('[qwen-token-plan-asr-live] ok');
      },
    );

    it(
      'handles empty-ish audio gracefully (adversarial)',
      { timeout: LIVE_TIMEOUT_MS },
      async () => {
        // 16 zero bytes with wav-like header fields. The vendor treats this
        // as no-speech and returns either { text: '' } (empty-400 convention)
        // or a thrown Error whose message contains the HTTP status.
        const fakeWav = Buffer.alloc(128, 0);
        // Write a minimal RIFF header so detectAudioFormat sees 'wav'.
        fakeWav.write('RIFF', 0, 'ascii');
        fakeWav.writeUInt32LE(120, 4); // file size minus 8
        fakeWav.write('WAVE', 8, 'ascii');
        fakeWav.write('fmt ', 12, 'ascii');
        fakeWav.writeUInt32LE(16, 16); // fmt chunk size
        fakeWav.writeUInt16LE(1, 20); // PCM
        fakeWav.writeUInt16LE(1, 22); // mono
        fakeWav.writeUInt32LE(16000, 24); // sample rate
        fakeWav.writeUInt32LE(32000, 28); // byte rate
        fakeWav.writeUInt16LE(2, 32); // block align
        fakeWav.writeUInt16LE(16, 34); // bits per sample
        fakeWav.write('data', 36, 'ascii');
        fakeWav.writeUInt32LE(64, 40); // data chunk size

        const config: ASRModelConfig = {
          providerId: PROVIDER_ID,
          apiKey: liveApiKey,
          baseUrl: ASR_PROVIDERS[PROVIDER_ID].defaultBaseUrl || '',
          modelId: ASR_PROVIDERS[PROVIDER_ID].defaultModelId,
        };

        try {
          const result = await transcribeAudio(config, fakeWav);
          // Empty-400 convention: vendor returned text: '' for no speech.
          expect(result.text).toBe('');
          console.log('[qwen-token-plan-asr-live] adversarial: vendor returned { text: "" }');
        } catch (err) {
          // Non-400 status or non-empty error body: vendor threw.
          expect(err).toBeInstanceOf(Error);
          const msg = (err as Error).message;
          expect(msg).toMatch(/\d{3}/);
          console.log(`[qwen-token-plan-asr-live] adversarial: vendor threw — ${msg}`);
        }
      },
    );
  });
}
