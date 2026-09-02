import { describe, expect, test } from 'vitest';
import { submitHappyHorseTask, pollHappyHorseTask } from '@/lib/media/adapters/happyhorse-adapter';
import type { VideoGenerationConfig } from '@/lib/media/types';

// Pinned public https URL for live protocol proofs.
// Vendor docs sample, same CDN family as the proven ASR sample.
export const LIVE_IMAGE_URL =
  'https://dashscope.oss-cn-beijing.aliyuncs.com/images/dog_and_girl.jpeg';

// Skip the entire file when TEST_LOAD_LOCAL_ENV is not set
// or when the video key is absent.
const skipReason = (() => {
  if (!process.env.TEST_LOAD_LOCAL_ENV) {
    return 'TEST_LOAD_LOCAL_ENV not set';
  }
  if (!process.env.VIDEO_HAPPYHORSE_API_KEY) {
    return 'VIDEO_HAPPYHORSE_API_KEY not set';
  }
  return null;
})();

// eslint-disable-next-line no-restricted-syntax
const describeOrSkip = skipReason ? describe.skip : describe;

describeOrSkip('HappyHorse live protocol', () => {
  const config: VideoGenerationConfig = {
    providerId: 'happyhorse',
    apiKey: process.env.VIDEO_HAPPYHORSE_API_KEY || '',
    baseUrl: process.env.VIDEO_HAPPYHORSE_BASE_URL,
    model: 'happyhorse-1.1-i2v',
  };

  test('missing media rejected', async () => {
    // i2v submit with NO media.
    // Poll surfaces FAILED with message containing 'Field required: input.media'.
    // Zero quota.
    const taskId = await submitHappyHorseTask(config, {
      prompt: 'This should fail without media',
      duration: 5,
    });

    expect(taskId).toBeTruthy();

    // Poll until FAILED or timeout
    const startTime = Date.now();
    let lastError: Error | null = null;

    while (Date.now() - startTime < 30000) {
      try {
        const result = await pollHappyHorseTask(config, taskId);
        if (result === null) {
          // Still pending, wait and retry
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        break;
      }
    }

    expect(lastError).toBeTruthy();
    // The vendor returns 'InvalidParameter: Field required: input.media' for missing media
    expect(lastError!.message).toContain('InvalidParameter');
    expect(lastError!.message.toLowerCase()).toContain('input.media');
  });

  test('r2v media array accepted', async () => {
    // r2v submit with one unreachable reference url.
    // Poll FAILED message containing 'Failed to download'.
    // Proves array acceptance + auth. Zero quota.
    const configR2V: VideoGenerationConfig = {
      ...config,
      model: 'happyhorse-1.1-r2v',
    };

    const taskId = await submitHappyHorseTask(configR2V, {
      prompt: 'This should fail on download',
      duration: 5,
      referenceImageUrls: ['https://example.com/nonexistent.png'],
    });

    expect(taskId).toBeTruthy();

    // Poll until FAILED or timeout
    const startTime = Date.now();
    let lastError: Error | null = null;

    while (Date.now() - startTime < 30000) {
      try {
        const result = await pollHappyHorseTask(configR2V, taskId);
        if (result === null) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        break;
      }
    }

    expect(lastError).toBeTruthy();
    expect(lastError!.message).toContain('Failed to download');
  });

  test('i2v completes', async () => {
    // The single paid generation.
    // firstFrameUrl=LIVE_IMAGE_URL, default duration, poll to SUCCEEDED.
    const taskId = await submitHappyHorseTask(config, {
      prompt: 'A happy dog playing with a girl in a park',
      duration: 5,
      firstFrameUrl: LIVE_IMAGE_URL,
    });

    expect(taskId).toBeTruthy();

    // Poll until SUCCEEDED or timeout (10 minutes)
      const startTime = Date.now();
      let result: Awaited<ReturnType<typeof pollHappyHorseTask>> = null;

    while (Date.now() - startTime < 600000) {
      result = await pollHappyHorseTask(config, taskId);
      if (result !== null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }

    expect(result).toBeTruthy();
    expect(result!.url).toBeTruthy();
    expect(result!.url).toMatch(/^https?:\/\//);
  }, 600000);
});
