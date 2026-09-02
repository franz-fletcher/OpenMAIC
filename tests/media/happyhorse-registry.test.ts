import { describe, expect, it } from 'vitest';
import { VIDEO_PROVIDERS, getVideoModelSourceRequirement } from '@/lib/media/video-providers';

describe('happyhorse model registry', () => {
  it('lists three 1.1 model ids in VIDEO_PROVIDERS.happyhorse', () => {
    const happyhorse = VIDEO_PROVIDERS.happyhorse;
    const modelIds = happyhorse.models.map((m) => m.id);
    expect(modelIds).toContain('happyhorse-1.1-t2v');
    expect(modelIds).toContain('happyhorse-1.1-i2v');
    expect(modelIds).toContain('happyhorse-1.1-r2v');
    // Keep the 1.0-t2v row
    expect(modelIds).toContain('happyhorse-1.0-t2v');
  });

  it('has sourceRequirement metadata on i2v and r2v models', () => {
    const happyhorse = VIDEO_PROVIDERS.happyhorse;
    const i2v = happyhorse.models.find((m) => m.id === 'happyhorse-1.1-i2v');
    const r2v = happyhorse.models.find((m) => m.id === 'happyhorse-1.1-r2v');
    expect(i2v?.sourceRequirement).toBe('first_frame');
    expect(r2v?.sourceRequirement).toBe('reference_images');
  });

  it('has undefined sourceRequirement on t2v models', () => {
    const happyhorse = VIDEO_PROVIDERS.happyhorse;
    const t2v = happyhorse.models.find((m) => m.id === 'happyhorse-1.0-t2v');
    const t2v11 = happyhorse.models.find((m) => m.id === 'happyhorse-1.1-t2v');
    expect(t2v?.sourceRequirement).toBeUndefined();
    expect(t2v11?.sourceRequirement).toBeUndefined();
  });

  it('getVideoModelSourceRequirement returns undefined for t2v', () => {
    const result = getVideoModelSourceRequirement('happyhorse', 'happyhorse-1.1-t2v');
    expect(result).toBeUndefined();
  });

  it('getVideoModelSourceRequirement returns first_frame for i2v', () => {
    const result = getVideoModelSourceRequirement('happyhorse', 'happyhorse-1.1-i2v');
    expect(result).toBe('first_frame');
  });

  it('getVideoModelSourceRequirement returns reference_images for r2v', () => {
    const result = getVideoModelSourceRequirement('happyhorse', 'happyhorse-1.1-r2v');
    expect(result).toBe('reference_images');
  });

  it('getVideoModelSourceRequirement returns undefined for unknown model', () => {
    const result = getVideoModelSourceRequirement('happyhorse', 'unknown-model');
    expect(result).toBeUndefined();
  });

  it('getVideoModelSourceRequirement returns undefined for unknown provider', () => {
    const result = getVideoModelSourceRequirement('unknown-provider', 'some-model');
    expect(result).toBeUndefined();
  });
});
