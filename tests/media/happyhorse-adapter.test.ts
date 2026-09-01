import { beforeEach, describe, expect, test, vi } from 'vitest';
import { pollHappyHorseTask, submitHappyHorseTask } from '@/lib/media/adapters/happyhorse-adapter';
import type { VideoGenerationConfig } from '@/lib/media/types';

const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);

const config: VideoGenerationConfig = {
  providerId: 'happyhorse',
  apiKey: 'test-key',
  model: 'happyhorse-1.0-t2v',
};

describe('HappyHorse video adapter', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  test('submits an async DashScope video synthesis task', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: {
          task_status: 'PENDING',
          task_id: 'task-123',
        },
        request_id: 'request-123',
      }),
    });

    const taskId = await submitHappyHorseTask(config, {
      prompt: 'A cardboard city at night',
      aspectRatio: '16:9',
      duration: 5,
      resolution: '720p',
    });

    expect(taskId).toBe('task-123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: 'happyhorse-1.0-t2v',
          input: {
            prompt: 'A cardboard city at night',
          },
          parameters: {
            resolution: '720P',
            ratio: '16:9',
            duration: 5,
            watermark: false,
          },
        }),
      },
    );
  });

  test('sends i2v body with first_frame media entry', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: { task_status: 'PENDING', task_id: 'task-i2v' },
      }),
    });

    await submitHappyHorseTask(
      { ...config, model: 'happyhorse-1.1-i2v' },
      {
        prompt: 'A cat sleeping',
        firstFrameUrl: 'https://example.com/cat.jpg',
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: 'happyhorse-1.1-i2v',
          input: {
            prompt: 'A cat sleeping',
            media: [{ type: 'first_frame', url: 'https://example.com/cat.jpg' }],
          },
          parameters: {
            resolution: '720P',
            ratio: '16:9',
            duration: 5,
            watermark: false,
          },
        }),
      },
    );
  });

  test('sends r2v body with two reference_image entries', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: { task_status: 'PENDING', task_id: 'task-r2v' },
      }),
    });

    await submitHappyHorseTask(
      { ...config, model: 'happyhorse-1.1-r2v' },
      {
        prompt: 'A landscape transformation',
        referenceImageUrls: [
          'https://example.com/ref1.jpg',
          'https://example.com/ref2.jpg',
        ],
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: 'happyhorse-1.1-r2v',
          input: {
            prompt: 'A landscape transformation',
            media: [
              { type: 'reference_image', url: 'https://example.com/ref1.jpg' },
              { type: 'reference_image', url: 'https://example.com/ref2.jpg' },
            ],
          },
          parameters: {
            resolution: '720P',
            ratio: '16:9',
            duration: 5,
            watermark: false,
          },
        }),
      },
    );
  });

  test('returns a video result when polling succeeds', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: {
          task_id: 'task-123',
          task_status: 'SUCCEEDED',
          video_url: 'https://example.com/video.mp4',
        },
        usage: {
          duration: 5,
          SR: 720,
          ratio: '16:9',
        },
      }),
    });

    const result = await pollHappyHorseTask(config, 'task-123');

    expect(result).toEqual({
      url: 'https://example.com/video.mp4',
      duration: 5,
      width: 1280,
      height: 720,
    });
  });

  test('throws provider error details when polling fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: {
          task_id: 'task-123',
          task_status: 'FAILED',
          code: 'InvalidParameter',
          message: 'The parameter is invalid.',
        },
      }),
    });

    await expect(pollHappyHorseTask(config, 'task-123')).rejects.toThrow(
      'HappyHorse video generation failed: InvalidParameter: The parameter is invalid.',
    );
  });

  test('rejects unreachable image on poll', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: {
          task_id: 'task-bad-url',
          task_status: 'FAILED',
          code: 'InvalidParameter',
          message: 'Failed to download https://example.com/unreachable.jpg',
        },
      }),
    });

    await expect(pollHappyHorseTask(config, 'task-bad-url')).rejects.toThrow(
      'HappyHorse video generation failed: InvalidParameter: Failed to download https://example.com/unreachable.jpg',
    );
  });
});
