import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Route preflight guard: i2v and r2v models require source images.
// The route returns 400 MISSING_REQUIRED_FIELD when the matching option
// is missing or empty, before any vendor call runs.

const mocks = vi.hoisted(() => ({
  generateVideo: vi.fn(),
}));

vi.mock('@/lib/media/video-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/media/video-providers')>();
  return {
    ...actual,
    generateVideo: mocks.generateVideo,
  };
});

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function jsonRequest(url: string, body: unknown, headers?: Record<string, string>): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// Matrix of requirement x payload combos with expected codes.
const PREFLIGHT_MATRIX = [
  {
    name: 'i2v model with no firstFrameUrl returns 400',
    model: 'happyhorse-1.1-i2v',
    provider: 'happyhorse',
    body: { prompt: 'A cat sleeping' },
    expectedStatus: 400,
    expectedCode: 'MISSING_REQUIRED_FIELD',
  },
  {
    name: 'r2v model with no referenceImageUrls returns 400',
    model: 'happyhorse-1.1-r2v',
    provider: 'happyhorse',
    body: { prompt: 'A landscape transformation' },
    expectedStatus: 400,
    expectedCode: 'MISSING_REQUIRED_FIELD',
  },
  {
    name: 'r2v model with empty referenceImageUrls returns 400',
    model: 'happyhorse-1.1-r2v',
    provider: 'happyhorse',
    body: { prompt: 'A landscape transformation', referenceImageUrls: [] },
    expectedStatus: 400,
    expectedCode: 'MISSING_REQUIRED_FIELD',
  },
  {
    name: 'i2v model with firstFrameUrl passes preflight',
    model: 'happyhorse-1.1-i2v',
    provider: 'happyhorse',
    body: { prompt: 'A cat sleeping', firstFrameUrl: 'https://example.com/cat.jpg' },
    expectedStatus: 200,
    expectedCode: undefined,
  },
  {
    name: 'r2v model with referenceImageUrls passes preflight',
    model: 'happyhorse-1.1-r2v',
    provider: 'happyhorse',
    body: {
      prompt: 'A landscape transformation',
      referenceImageUrls: ['https://example.com/ref1.jpg'],
    },
    expectedStatus: 200,
    expectedCode: undefined,
  },
  {
    name: 't2v model with neither field passes preflight',
    model: 'happyhorse-1.0-t2v',
    provider: 'happyhorse',
    body: { prompt: 'A cardboard city' },
    expectedStatus: 200,
    expectedCode: undefined,
  },
  {
    name: 'unknown model without sourceRequirement passes preflight',
    model: 'unknown-model',
    provider: 'happyhorse',
    body: { prompt: 'A test' },
    expectedStatus: 200,
    expectedCode: undefined,
  },
];

describe('video route preflight', () => {
  beforeEach(() => {
    mocks.generateVideo.mockReset();
    mocks.generateVideo.mockResolvedValue({
      url: 'https://media.test/video',
      width: 1280,
      height: 720,
      duration: 5,
    });
  });

  it.each(PREFLIGHT_MATRIX)(
    '$name',
    async ({ model, provider, body, expectedStatus, expectedCode }) => {
      vi.stubEnv('VIDEO_HAPPYHORSE_API_KEY', 'test-key');

      const { POST } = await import('@/app/api/generate/video/route');
      const res = await POST(
        jsonRequest('http://localhost/api/generate/video', body, {
          'x-video-provider': provider,
          'x-video-model': model,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(expectedStatus);
      if (expectedCode) {
        expect(json).toMatchObject({ success: false, errorCode: expectedCode });
        expect(mocks.generateVideo).not.toHaveBeenCalled();
      } else {
        expect(json).toMatchObject({ success: true });
      }
    },
  );
});
