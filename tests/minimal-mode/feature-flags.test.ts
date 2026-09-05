import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMinimalModeClientEnabled, isMinimalModeEnabled } from '@/lib/config/feature-flags';
describe('isMinimalModeEnabled', () => {
  const FLAG = 'MINIMAL_MODE';
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[FLAG];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[FLAG];
    else process.env[FLAG] = original;
  });

  it('defaults off when unset', () => {
    delete process.env[FLAG];
    expect(isMinimalModeEnabled()).toBe(false);
  });

  it("returns true for 'true'", () => {
    process.env[FLAG] = 'true';
    expect(isMinimalModeEnabled()).toBe(true);
  });

  it("returns true for '1'", () => {
    process.env[FLAG] = '1';
    expect(isMinimalModeEnabled()).toBe(true);
  });

  it("returns false for 'false'", () => {
    process.env[FLAG] = 'false';
    expect(isMinimalModeEnabled()).toBe(false);
  });

  it('returns false for an unrecognized string', () => {
    process.env[FLAG] = 'yes';
    expect(isMinimalModeEnabled()).toBe(false);
  });
});

describe('isMinimalModeClientEnabled', () => {
  const FLAG = 'NEXT_PUBLIC_MINIMAL_MODE';
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[FLAG];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[FLAG];
    else process.env[FLAG] = original;
  });

  it('defaults off when unset', () => {
    delete process.env[FLAG];
    expect(isMinimalModeClientEnabled()).toBe(false);
  });

  it("returns true for 'true'", () => {
    process.env[FLAG] = 'true';
    expect(isMinimalModeClientEnabled()).toBe(true);
  });

  it("returns true for '1'", () => {
    process.env[FLAG] = '1';
    expect(isMinimalModeClientEnabled()).toBe(true);
  });

  it("returns false for 'false'", () => {
    process.env[FLAG] = 'false';
    expect(isMinimalModeClientEnabled()).toBe(false);
  });

  it('returns false for an unrecognized string', () => {
    process.env[FLAG] = 'yes';
    expect(isMinimalModeClientEnabled()).toBe(false);
  });

  it('reads only the NEXT_PUBLIC_ variable, not MINIMAL_MODE', () => {
    process.env.MINIMAL_MODE = 'true';
    process.env[FLAG] = 'false';
    expect(isMinimalModeClientEnabled()).toBe(false);
  });
});

describe('validateMinimalMode', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Ensure both flags are set so the validator fires
    process.env.MINIMAL_MODE = 'true';
    process.env.ACCESS_CODE = 'secret';
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.MINIMAL_MODE;
    delete process.env.ACCESS_CODE;
  });

  it('warns when both MINIMAL_MODE and ACCESS_CODE are set', async () => {
    const { validateMinimalMode } = await import('@/lib/server/config-validation');
    validateMinimalMode();
    expect(warnSpy).toHaveBeenCalledOnce();
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('[config]');
    expect(message).toContain('MINIMAL_MODE');
    expect(message).toContain('ACCESS_CODE');
  });

  it('does not warn when only MINIMAL_MODE is set', async () => {
    delete process.env.ACCESS_CODE;
    const { validateMinimalMode } = await import('@/lib/server/config-validation');
    validateMinimalMode();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when only ACCESS_CODE is set', async () => {
    delete process.env.MINIMAL_MODE;
    const { validateMinimalMode } = await import('@/lib/server/config-validation');
    validateMinimalMode();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when neither is set', async () => {
    delete process.env.MINIMAL_MODE;
    delete process.env.ACCESS_CODE;
    const { validateMinimalMode } = await import('@/lib/server/config-validation');
    validateMinimalMode();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
