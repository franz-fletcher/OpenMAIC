import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { replaceMediaPlaceholders } from '@/lib/server/classroom-media-generation';
import type { Scene } from '@/lib/types/stage';
import type { SceneOutline } from '@/lib/types/generation';

// Close the ENV VECTOR: a bun-compiled gate runner auto-loads .env.local, so
// inherited provider env keys (VIDEO_HAPPYHORSE_API_KEY, etc.) leak into test
// assertions. Delete every provider-related env key before any import or stub.
// vitest isolates files per worker, so intra-file deletion is safe.
const _envSnapshot = Object.keys(process.env);
for (const key of _envSnapshot) {
  if (/_API_KEY|_BASE_URL|_MODELS|_ENABLED$/.test(key)) {
    delete process.env[key];
  }
}

// Intercept fs to keep writes off the worktree and to pin the YAML path to
// null. Without this, a host server-providers.yml would leak provider keys
// into test failure output.
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
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

function slideScene(
  elements: Array<{ id: string; type: string; src?: string; mediaRef?: string }>,
) {
  return {
    id: 'scene_1',
    stageId: 'stage_1',
    type: 'slide',
    title: 'Scene',
    order: 1,
    content: {
      type: 'slide',
      canvas: {
        id: 'canvas_1',
        elements,
      },
    },
  } as unknown as Scene;
}

describe('classroom media placeholder replacement', () => {
  test('preserves direct video src when mediaRef is also present', () => {
    const scene = slideScene([
      {
        id: 'video_1',
        type: 'video',
        src: 'https://example.com/direct.mp4',
        mediaRef: 'gen_vid_real123',
      },
    ]);

    replaceMediaPlaceholders([scene], {
      gen_vid_real123: 'https://cdn.example.com/generated.mp4',
    });

    const content = scene.content as {
      canvas: { elements: Array<{ src?: string }> };
    };
    const video = content.canvas.elements[0];
    expect(video.src).toBe('https://example.com/direct.mp4');
  });

  test('preserves an author-supplied non-URL src when mediaRef is also present', () => {
    const scene = slideScene([
      {
        id: 'video_1',
        type: 'video',
        src: 'lesson-intro.mp4',
        mediaRef: 'gen_vid_real123',
      },
    ]);

    replaceMediaPlaceholders([scene], {
      gen_vid_real123: 'https://cdn.example.com/generated.mp4',
    });

    const content = scene.content as {
      canvas: { elements: Array<{ src?: string }> };
    };
    expect(content.canvas.elements[0].src).toBe('lesson-intro.mp4');
  });

  test('does not treat an image placeholder as the video-manifest overwrite guard', () => {
    const scene = slideScene([
      {
        id: 'video_1',
        type: 'video',
        src: 'gen_img_preview123',
        mediaRef: 'gen_vid_real123',
      },
    ]);

    replaceMediaPlaceholders([scene], {
      gen_vid_real123: 'https://cdn.example.com/generated.mp4',
    });

    const content = scene.content as {
      canvas: { elements: Array<{ src?: string }> };
    };
    expect(content.canvas.elements[0].src).toBe('gen_img_preview123');
  });
});

describe('generateMediaForClassroom model fallback', () => {
  beforeEach(() => {
    yamlOverride = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('guard: fixture key — whole-init matcher captures headers, scalar assertion does not', async () => {
    // Sensitivity leg: a whole-init matcher on a called spy serializes the full
    // request init, including Authorization. Catch the error and assert the key
    // is present — this proves capture works.
    vi.stubEnv('IMAGE_SEEDREAM_API_KEY', 'sk-LIVE-FIXTURE-9876543210');
    vi.stubEnv('IMAGE_SEEDREAM_MODELS', 'seedream');
    vi.resetModules();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn.example.com/x.png' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { generateMediaForClassroom } = await import('@/lib/server/classroom-media-generation');
    const outlines = [
      {
        id: 'outline_guard',
        type: 'slide',
        title: 'Scene',
        description: 'd',
        order: 1,
        mediaGenerations: [{ type: 'image', prompt: 'a cat', elementId: 'gen_img_guard' }],
      },
    ] as unknown as SceneOutline[];

    await generateMediaForClassroom(outlines, 'cls-guard', 'http://localhost');
    expect(fetchMock).toHaveBeenCalled();

    try {
      expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }));
      throw new Error('assertion should have failed');
    } catch (err) {
      if (err instanceof Error && err.message === 'assertion should have failed') throw err;
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain('sk-LIVE-FIXTURE-9876543210');
    }

    // Fixed leg: a scalar assertion on a non-secret field must not embed the
    // key in the failure message.
    try {
      expect(fetchMock.mock.calls[0][1].redirect).toBe('follow');
      throw new Error('assertion should have failed');
    } catch (err) {
      if (err instanceof Error && err.message === 'assertion should have failed') throw err;
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('sk-LIVE-FIXTURE-9876543210');
    }
  });

  test('gracefully skips media when every configured provider is force-disabled', async () => {
    vi.stubEnv('IMAGE_SEEDREAM_API_KEY', 'sk-seedream');
    vi.stubEnv('IMAGE_SEEDREAM_ENABLED', 'false');
    vi.stubEnv('VIDEO_SEEDANCE_API_KEY', 'sk-seedance');
    vi.stubEnv('VIDEO_SEEDANCE_ENABLED', 'false');
    vi.resetModules();

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { generateMediaForClassroom } = await import('@/lib/server/classroom-media-generation');
    const outlines = [
      {
        id: 'outline_disabled',
        type: 'slide',
        title: 'Scene',
        description: 'd',
        order: 1,
        mediaGenerations: [
          { type: 'image', prompt: 'image', elementId: 'gen_img_disabled' },
          { type: 'video', prompt: 'video', elementId: 'gen_vid_disabled' },
        ],
      },
    ] as unknown as SceneOutline[];

    await expect(
      generateMediaForClassroom(outlines, 'cls-disabled', 'http://localhost'),
    ).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('falls back to the first catalog image model when the server pins no models', async () => {
    // Key-only managed provider (no IMAGE_SEEDREAM_MODELS pin): the resolver
    // yields no model, so the classroom path must fall back to the first
    // catalog model instead of reaching the adapter with an undefined model.
    vi.stubEnv('IMAGE_SEEDREAM_API_KEY', 'sk-seedream');
    vi.resetModules();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://cdn.example.com/x.png' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(8),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { generateMediaForClassroom } = await import('@/lib/server/classroom-media-generation');

    const outlines = [
      {
        id: 'outline_1',
        type: 'slide',
        title: 'Scene 1',
        description: 'd',
        order: 1,
        mediaGenerations: [{ type: 'image', prompt: 'a cat', elementId: 'gen_img_1' }],
      },
    ] as unknown as SceneOutline[];

    const mediaMap = await generateMediaForClassroom(outlines, 'cls-fallback', 'http://localhost');

    expect(mediaMap['gen_img_1']).toBe(
      'http://localhost/api/classroom-media/cls-fallback/media/gen_img_1.png',
    );
    const genBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(genBody.model).toBe('doubao-seedream-5-0-260128');
  });

  test('uses the server-pinned model when IMAGE_<PREFIX>_MODELS is set', async () => {
    vi.stubEnv('IMAGE_SEEDREAM_API_KEY', 'sk-seedream');
    vi.stubEnv('IMAGE_SEEDREAM_MODELS', 'pinned-a');
    vi.resetModules();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ url: 'https://cdn.example.com/y.png' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(8),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { generateMediaForClassroom } = await import('@/lib/server/classroom-media-generation');

    const outlines = [
      {
        id: 'outline_1',
        type: 'slide',
        title: 'Scene 1',
        description: 'd',
        order: 1,
        mediaGenerations: [{ type: 'image', prompt: 'a cat', elementId: 'gen_img_2' }],
      },
    ] as unknown as SceneOutline[];

    await generateMediaForClassroom(outlines, 'cls-pinned', 'http://localhost');

    const genBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(genBody.model).toBe('pinned-a');
  });

  test('falls back to the first catalog video model when the server pins no models', async () => {
    // Key-only managed provider (no VIDEO_SEEDANCE_MODELS pin): the resolver
    // yields no model, so the classroom path must fall back to the first
    // catalog model instead of reaching the adapter with an undefined model.
    vi.stubEnv('VIDEO_SEEDANCE_API_KEY', 'sk-seedance');
    vi.useFakeTimers();
    vi.resetModules();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'video-task-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'video-task-1',
          status: 'succeeded',
          content: { video_url: 'https://cdn.example.com/video.mp4' },
          resolution: '720p',
          ratio: '16:9',
          duration: 5,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(8),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { generateMediaForClassroom } = await import('@/lib/server/classroom-media-generation');

    const outlines = [
      {
        id: 'outline_1',
        type: 'slide',
        title: 'Scene 1',
        description: 'd',
        order: 1,
        mediaGenerations: [{ type: 'video', prompt: 'a cat running', elementId: 'gen_vid_1' }],
      },
    ] as unknown as SceneOutline[];

    const mediaMapPromise = generateMediaForClassroom(
      outlines,
      'cls-video-fallback',
      'http://localhost',
    );
    // Seedance submits a task then polls on a 5s interval; advance the fake
    // timers past the first poll so the mocked success response is consumed.
    await vi.advanceTimersByTimeAsync(5_000);
    const mediaMap = await mediaMapPromise;

    expect(mediaMap['gen_vid_1']).toBe(
      'http://localhost/api/classroom-media/cls-video-fallback/media/gen_vid_1.mp4',
    );
    const genBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(genBody.model).toBe('doubao-seedance-2-0-260128');
  });

  test('uses the server-pinned video model when VIDEO_<PREFIX>_MODELS is set', async () => {
    vi.stubEnv('VIDEO_SEEDANCE_API_KEY', 'sk-seedance');
    vi.stubEnv('VIDEO_SEEDANCE_MODELS', 'pinned-video-a');
    vi.useFakeTimers();
    vi.resetModules();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'video-task-2' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'video-task-2',
          status: 'succeeded',
          content: { video_url: 'https://cdn.example.com/video.mp4' },
          resolution: '720p',
          ratio: '16:9',
          duration: 5,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(8),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { generateMediaForClassroom } = await import('@/lib/server/classroom-media-generation');

    const outlines = [
      {
        id: 'outline_1',
        type: 'slide',
        title: 'Scene 1',
        description: 'd',
        order: 1,
        mediaGenerations: [{ type: 'video', prompt: 'a cat running', elementId: 'gen_vid_2' }],
      },
    ] as unknown as SceneOutline[];

    const mediaMapPromise = generateMediaForClassroom(
      outlines,
      'cls-video-pinned',
      'http://localhost',
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const mediaMap = await mediaMapPromise;

    expect(mediaMap['gen_vid_2']).toBe(
      'http://localhost/api/classroom-media/cls-video-pinned/media/gen_vid_2.mp4',
    );
    const genBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(genBody.model).toBe('pinned-video-a');
  });
});
