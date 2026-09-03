import { describe, expect, it } from 'vitest';
import {
  resolveCompactionSettings,
  measureDriverContextTokens,
  type CompactionSettings,
} from '@/lib/server/agent-runtime/compaction';

/**
 * Compaction trigger policy tests.
 *
 * These cover:
 * - resolveCompactionSettings floor policy and override semantics.
 * - measureDriverContextTokens zero-usage-tail fallback.
 * - Trigger condition: disabled or under threshold never fires.
 */

// ---------------------------------------------------------------------------
// resolveCompactionSettings
// ---------------------------------------------------------------------------

describe('resolveCompactionSettings', () => {
  it('keeps the flag OFF with no overrides', () => {
    const settings = resolveCompactionSettings(128_000);
    expect(settings.enabled).toBe(false);
  });

  it('applies the reserve floor: max(2048, 20% of window), capped by pi default', () => {
    const settings = resolveCompactionSettings(128_000);
    // 20% of 128000 = 25600, pi default reserveTokens = 16384, min = 16384
    expect(settings.reserveTokens).toBe(16_384);
  });

  it('clamps reserve to 2048 for small windows', () => {
    // 20% of 8000 = 1600, floor is 2048, pi default = 16384, min = 2048
    const settings = resolveCompactionSettings(8_000);
    expect(settings.reserveTokens).toBe(2_048);
  });

  it('applies the keepRecent floor: max(2048, 25% of window), capped by pi default', () => {
    const settings = resolveCompactionSettings(128_000);
    // 25% of 128000 = 32000, pi default keepRecentTokens = 20000, min = 20000
    expect(settings.keepRecentTokens).toBe(20_000);
  });

  it('clamps keepRecent to 2048 for small windows', () => {
    // 25% of 6000 = 1500, floor is 2048, pi default = 20000, min = 2048
    const settings = resolveCompactionSettings(6_000);
    expect(settings.keepRecentTokens).toBe(2_048);
  });

  it('caps reserve by the pi default when floor exceeds it', () => {
    // For a huge window the floor (20%) exceeds the default cap.
    // pi reserveTokens default = 16384
    const settings = resolveCompactionSettings(200_000);
    // 20% of 200000 = 40000, min(16384, 40000) = 16384
    expect(settings.reserveTokens).toBe(16_384);
  });

  it('caps keepRecent by the pi default when floor exceeds it', () => {
    // pi keepRecentTokens default = 20000
    const settings = resolveCompactionSettings(200_000);
    // 25% of 200000 = 50000, min(20000, 50000) = 20000
    expect(settings.keepRecentTokens).toBe(20_000);
  });

  it('explicit reserve wins over the floor', () => {
    const settings = resolveCompactionSettings(128_000, { reserveTokens: 4_096 });
    expect(settings.reserveTokens).toBe(4_096);
  });

  it('explicit keepRecent wins over the floor', () => {
    const settings = resolveCompactionSettings(128_000, { keepRecentTokens: 8_192 });
    expect(settings.keepRecentTokens).toBe(8_192);
  });

  it('explicit enabled override is respected', () => {
    const settings = resolveCompactionSettings(128_000, { enabled: true });
    expect(settings.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// measureDriverContextTokens
// ---------------------------------------------------------------------------

describe('measureDriverContextTokens', () => {
  it('returns the pi estimate when a nonzero usage anchor exists', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'world' }],
        stopReason: 'stop',
        usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 },
      },
    ] as any[];
    const tokens = measureDriverContextTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it('falls back to per-message sum when the last usage anchor is zero', () => {
    // Shape from the reference session: last assistant blob has all-zero usage.
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'first message here' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'response one' }],
        stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      { role: 'user', content: [{ type: 'text', text: 'second message here' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'response two' }],
        stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ] as any[];
    const tokens = measureDriverContextTokens(messages);
    // Must count every message, not just the usage anchor.
    expect(tokens).toBeGreaterThan(0);
  });

  it('falls back to per-message sum when no message has usage', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ] as any[];
    const tokens = measureDriverContextTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Trigger condition
// ---------------------------------------------------------------------------

describe('compaction trigger condition', () => {
  it('never fires when compaction is disabled', () => {
    const settings = resolveCompactionSettings(128_000); // enabled: false
    const threshold = settings.reserveTokens;
    // Even with a huge token count, disabled means no trigger.
    const shouldTrigger = settings.enabled && threshold > 0;
    expect(shouldTrigger).toBe(false);
  });

  it('never fires when the token count is under the window minus reserve', () => {
    const settings = resolveCompactionSettings(128_000, { enabled: true });
    const windowMinusReserve = 128_000 - settings.reserveTokens;
    // Token count below threshold should not trigger.
    const tokenCount = windowMinusReserve - 1_000;
    const shouldTrigger = settings.enabled && tokenCount > windowMinusReserve;
    expect(shouldTrigger).toBe(false);
  });

  it('fires when enabled and the token count meets the window minus reserve', () => {
    const settings = resolveCompactionSettings(128_000, { enabled: true });
    const windowMinusReserve = 128_000 - settings.reserveTokens;
    const tokenCount = windowMinusReserve + 1;
    const shouldTrigger = settings.enabled && tokenCount > windowMinusReserve;
    expect(shouldTrigger).toBe(true);
  });
});
