import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// The five token-plan provider ids demonstrated in server-providers.yml.example.
// Exported so the ledger can anchor a symbol.
export const EXAMPLE_TOKEN_PLAN_IDS = [
  'qwen', // LLM providers section
  'qwen-image', // image section
  'happyhorse', // video section
  'qwen-token-plan-tts', // tts section
  'qwen-token-plan-asr', // asr section
] as const;

// Mock fs — only intercept server-providers.yml; delegate everything else to real fs.
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
  };
});

describe('server-providers.yml.example', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    yamlOverride = null;
  });

  it('is a valid YAML file that parses without error', async () => {
    const examplePath = path.join(process.cwd(), 'server-providers.yml.example');
    expect(fs.existsSync(examplePath), 'server-providers.yml.example must exist').toBe(true);
    const raw = fs.readFileSync(examplePath, 'utf-8');
    // Parse through the loader by injecting via yamlOverride and importing the module.
    yamlOverride = raw;
    const { isServerConfiguredProvider } = await import('@/lib/server/provider-config');
    // If the YAML is malformed the import would throw during loadYamlFile.
    // A bare assertion that the module loaded confirms parse success.
    expect(typeof isServerConfiguredProvider).toBe('function');
  });

  it('resolves all five token-plan ids through isServerConfiguredProvider', async () => {
    const examplePath = path.join(process.cwd(), 'server-providers.yml.example');
    const raw = fs.readFileSync(examplePath, 'utf-8');
    yamlOverride = raw;

    const { isServerConfiguredProvider } = await import('@/lib/server/provider-config');

    // LLM: qwen in providers section
    expect(isServerConfiguredProvider('providers', 'qwen')).toBe(true);
    // Image: qwen-image in image section
    expect(isServerConfiguredProvider('image', 'qwen-image')).toBe(true);
    // Video: happyhorse in video section
    expect(isServerConfiguredProvider('video', 'happyhorse')).toBe(true);
    // TTS: qwen-token-plan-tts in tts section
    expect(isServerConfiguredProvider('tts', 'qwen-token-plan-tts')).toBe(true);
    // ASR: qwen-token-plan-asr in asr section
    expect(isServerConfiguredProvider('asr', 'qwen-token-plan-asr')).toBe(true);
  });

  it('spot-checks one base_url per token-plan section', async () => {
    const examplePath = path.join(process.cwd(), 'server-providers.yml.example');
    const raw = fs.readFileSync(examplePath, 'utf-8');
    yamlOverride = raw;

    const {
      resolveBaseUrl,
      resolveTTSBaseUrl,
      resolveASRBaseUrl,
      resolveImageBaseUrl,
      resolveVideoBaseUrl,
    } = await import('@/lib/server/provider-config');

    // LLM: token-plan compatible-mode base URL
    expect(resolveBaseUrl('qwen')).toBe(
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    );
    // Image: bare token-plan host (adapter appends the path)
    expect(resolveImageBaseUrl('qwen-image')).toBe(
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com',
    );
    // Video: bare token-plan host (adapter appends the path)
    expect(resolveVideoBaseUrl('happyhorse')).toBe(
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com',
    );
    // TTS: wss token-plan endpoint
    expect(resolveTTSBaseUrl('qwen-token-plan-tts')).toBe(
      'wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference',
    );
    // ASR: token-plan /api/v1 base
    expect(resolveASRBaseUrl('qwen-token-plan-asr')).toBe(
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1',
    );
  });
});
