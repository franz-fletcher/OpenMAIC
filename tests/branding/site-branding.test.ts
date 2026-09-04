import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SITE_BRANDING_DEFAULTS } from '@/lib/config/site-branding';
import { loadSiteBranding } from '@/lib/config/site-branding.server';

const ENV_KEYS = ['SITE_NAME', 'SITE_TAGLINE', 'SHOW_LOGO', 'SHOW_HEADLINE'] as const;

describe('SITE_BRANDING_DEFAULTS', () => {
  it('has the expected shape', () => {
    expect(SITE_BRANDING_DEFAULTS).toEqual({
      name: 'OpenMAIC',
      tagline: '',
      showLogo: true,
      showHeadline: true,
    });
  });
});

describe('loadSiteBranding', () => {
  const originals = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originals.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = originals.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    originals.clear();
  });

  it('returns defaults when no env vars are set', () => {
    expect(loadSiteBranding()).toEqual(SITE_BRANDING_DEFAULTS);
  });

  it('reads SITE_NAME from env', () => {
    process.env.SITE_NAME = 'My School';
    expect(loadSiteBranding().name).toBe('My School');
  });

  it('reads SITE_TAGLINE from env', () => {
    process.env.SITE_TAGLINE = 'Learn together';
    expect(loadSiteBranding().tagline).toBe('Learn together');
  });

  it("parses SHOW_LOGO='true' as true", () => {
    process.env.SHOW_LOGO = 'true';
    expect(loadSiteBranding().showLogo).toBe(true);
  });

  it("parses SHOW_LOGO='1' as true", () => {
    process.env.SHOW_LOGO = '1';
    expect(loadSiteBranding().showLogo).toBe(true);
  });

  it("parses SHOW_LOGO='false' as false", () => {
    process.env.SHOW_LOGO = 'false';
    expect(loadSiteBranding().showLogo).toBe(false);
  });

  it('parses SHOW_LOGO unset as true (default)', () => {
    delete process.env.SHOW_LOGO;
    expect(loadSiteBranding().showLogo).toBe(true);
  });

  it("parses SHOW_HEADLINE='true' as true", () => {
    process.env.SHOW_HEADLINE = 'true';
    expect(loadSiteBranding().showHeadline).toBe(true);
  });

  it("parses SHOW_HEADLINE='1' as true", () => {
    process.env.SHOW_HEADLINE = '1';
    expect(loadSiteBranding().showHeadline).toBe(true);
  });

  it("parses SHOW_HEADLINE='false' as false", () => {
    process.env.SHOW_HEADLINE = 'false';
    expect(loadSiteBranding().showHeadline).toBe(false);
  });

  it('parses SHOW_HEADLINE unset as true (default)', () => {
    delete process.env.SHOW_HEADLINE;
    expect(loadSiteBranding().showHeadline).toBe(true);
  });

  it('env vars override defaults', () => {
    process.env.SITE_NAME = 'Custom';
    process.env.SITE_TAGLINE = 'Tag';
    process.env.SHOW_LOGO = 'false';
    process.env.SHOW_HEADLINE = 'false';
    expect(loadSiteBranding()).toEqual({
      name: 'Custom',
      tagline: 'Tag',
      showLogo: false,
      showHeadline: false,
    });
  });
});
