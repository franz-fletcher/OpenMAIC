import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  providers: vi.fn(),
  generate: vi.fn(),
  persist: vi.fn(),
  apiKey: vi.fn(() => ''),
}));

vi.mock('@/lib/server/provider-config', () => ({
  getServerTTSProviders: mocks.providers,
  resolveTTSApiKey: mocks.apiKey,
  resolveTTSBaseUrl: vi.fn(() => undefined),
  resolveTTSModel: vi.fn(() => ''),
}));

vi.mock('@/lib/audio/tts-providers', () => ({ generateTTS: mocks.generate }));

vi.mock('@/lib/server/classroom-media-bytes', () => ({
  persistClassroomMediaBytes: mocks.persist,
}));

import { synthesizeSceneNarration } from '@/lib/server/agent-runtime/scene-tts';
import type { Scene } from '@/lib/types/stage';

const scene = {
  id: 'scene-a',
  stageId: 'stage-a',
  order: 1,
  title: 'A',
  type: 'slide',
  content: { type: 'slide' },
  actions: [{ id: 'speech-a', type: 'speech', text: 'Hello' }],
} as Scene;

describe('scene TTS capability routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiKey.mockImplementation(() => '');
  });

  it('honors the server capability force-off before synthesis', async () => {
    mocks.providers.mockReturnValue({ 'configured-tts': { disabled: true } });
    const summary = await synthesizeSceneNarration({
      scene: structuredClone(scene),
      force: false,
    });
    expect(summary).toMatchObject({ available: false, changed: false });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it('stores generated narration bytes in classroom media', async () => {
    mocks.providers.mockReturnValue({ 'configured-tts': {} });
    mocks.generate.mockResolvedValue({ audio: new Uint8Array([1, 2]), format: 'mp3' });
    mocks.persist.mockResolvedValue('/api/classroom-media/stage-a/media/tts-speech-a-abc123.mp3');
    const target = structuredClone(scene);
    const summary = await synthesizeSceneNarration({ scene: target, force: false });
    expect(summary).toMatchObject({ available: true, changed: true, generated: 1 });
    // The durable reference is the RELATIVE classroom-media path (origin-
    // independent), stamped on both `audioId` and the legacy `audioUrl` pair
    // the browser's narration consumers resolve (timeline status/preview,
    // playback fetch, exports) — so agent-generated narration is voiced and
    // playable on any deployment origin.
    expect(target.actions?.[0]).toMatchObject({
      audioId: '/api/classroom-media/stage-a/media/tts-speech-a-abc123.mp3',
      audioUrl: '/api/classroom-media/stage-a/media/tts-speech-a-abc123.mp3',
    });
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: 'stage-a', mime: 'audio/mpeg' }),
    );
  });

  it('accepts qwen-token-plan-tts and persists mp3 narration without conversion', async () => {
    // Classroom pipeline acceptance (spec S5): the token-plan provider flows
    // through the narration seam with its registry default voice, its mp3
    // output maps to audio/mpeg, and the stored asset path keeps the .mp3
    // extension. No audio conversion happens anywhere on this path.
    mocks.apiKey.mockReturnValue('sk-sp-test');
    mocks.providers.mockReturnValue({ 'qwen-token-plan-tts': {} });
    mocks.generate.mockResolvedValue({ audio: new Uint8Array([1, 2, 3]), format: 'mp3' });
    mocks.persist.mockResolvedValue('/api/classroom-media/stage-a/media/tts-speech-a-abc123.mp3');
    const target = structuredClone(scene);
    const summary = await synthesizeSceneNarration({ scene: target, force: false });
    expect(summary).toMatchObject({ available: true, changed: true, generated: 1 });
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'qwen-token-plan-tts',
        voice: 'longanlingxin',
      }),
      'Hello',
    );
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        stageId: 'stage-a',
        bytes: Buffer.from([1, 2, 3]),
        mime: 'audio/mpeg',
        prefix: 'tts-speech-a',
      }),
    );
    expect(target.actions?.[0]).toMatchObject({
      audioId: expect.stringMatching(/\.mp3$/),
      audioUrl: expect.stringMatching(/\.mp3$/),
    });
  });
});
