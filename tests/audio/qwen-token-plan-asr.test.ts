import { describe, expect, it } from 'vitest';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import { resolveASRProviderName } from '@/lib/audio/provider-display';
import { useSettingsStore } from '@/lib/store/settings';
import type { BuiltInASRProviderId } from '@/lib/audio/types';

/**
 * Slice S1 gates: registry identity for qwen-token-plan-asr.
 *
 * These tests prove the provider exists in every surface the S1 slice
 * owns. They do not test transcription logic (that is S2).
 */

// ---------------------------------------------------------------------------
// Union membership
// ---------------------------------------------------------------------------

describe('qwen-token-plan-asr identity', () => {
  it('includes the id in BuiltInASRProviderId', () => {
    const id: BuiltInASRProviderId = 'qwen-token-plan-asr';
    expect(id).toBe('qwen-token-plan-asr');
  });

  // ---------------------------------------------------------------------------
  // Registry record
  // ---------------------------------------------------------------------------

  it('has an ASR_PROVIDERS record with token-plan defaults', () => {
    const p = ASR_PROVIDERS['qwen-token-plan-asr'];
    expect(p).toBeDefined();
    expect(p.requiresApiKey).toBe(true);
    expect(p.defaultModelId).toBe('qwen-audio-3.0-asr-flash');
    expect(p.defaultBaseUrl).toBe('https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1');
    expect(p.models).toEqual([
      { id: 'qwen-audio-3.0-asr-flash', name: 'qwen-audio-3.0-asr-flash' },
    ]);
    expect(p.supportedFormats).toEqual(['wav', 'webm', 'mp3', 'opus']);
  });

  it('has exactly 31 supported language codes', () => {
    const langs = ASR_PROVIDERS['qwen-token-plan-asr'].supportedLanguages;
    expect(langs).toHaveLength(31);
    expect(langs).toContain('auto');
    expect(langs).toContain('zh');
    expect(langs).toContain('en');
    expect(langs).toContain('ja');
    expect(langs).toContain('ko');
    expect(langs).toContain('vi');
    expect(langs).toContain('th');
    expect(langs).toContain('hr');
    expect(langs).toContain('sk');
  });

  // ---------------------------------------------------------------------------
  // Display name
  // ---------------------------------------------------------------------------

  it('binds the display name key', () => {
    const fakeT = (key: string) => key;
    const name = resolveASRProviderName('qwen-token-plan-asr', fakeT);
    expect(name).toBe('settings.providerQwenTokenPlanASR');
  });

  // ---------------------------------------------------------------------------
  // Store default
  // ---------------------------------------------------------------------------

  it('injects a store default with modelId pinned', () => {
    const state = useSettingsStore.getState();
    const cfg = state.asrProvidersConfig['qwen-token-plan-asr'];
    expect(cfg).toBeDefined();
    expect(cfg.apiKey).toBe('');
    expect(cfg.baseUrl).toBe('');
    expect(cfg.modelId).toBe('qwen-audio-3.0-asr-flash');
    expect(cfg.enabled).toBe(false);
  });
});
