/**
 * Unit tests for publish dialog i18n wiring.
 *
 * Verifies that the dialog component references the correct translation keys
 * and that the locale file contains every key the component needs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALE_PATH = resolve(__dirname, '../../lib/i18n/locales/en-US.json');
const DIALOG_PATH = resolve(__dirname, '../../components/publishing/publish-dialog.tsx');

function loadJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadSource(path: string) {
  return readFileSync(path, 'utf-8');
}

describe('publishing i18n keys', () => {
  const locale = loadJson(LOCALE_PATH);
  const publishing = locale.publishing as Record<string, string>;

  it('has all audience keys in locale', () => {
    expect(publishing.audienceEveryone).toBe('Everyone');
    expect(publishing.audienceGuests).toBe('Guests only');
    expect(publishing.audienceLearners).toBe('Learners only');
  });

  it('has unpublish keys in locale', () => {
    expect(publishing.unpublishFailed).toBe('Unpublishing failed. Please try again.');
    expect(publishing.unpublishConfirm).toBe('Unpublish this course?');
  });

  it('has gallery keys in locale (server-side i18n not yet available)', () => {
    expect(publishing.galleryTitle).toBe('Gallery');
    expect(publishing.galleryEmpty).toBe('No courses available yet.');
  });

  it('does not contain removed badge keys', () => {
    expect(publishing).not.toHaveProperty('publishedBadge');
    expect(publishing).not.toHaveProperty('draftBadge');
  });
});

describe('publish-dialog.tsx i18n references', () => {
  const source = loadSource(DIALOG_PATH);

  it('uses t() for audience labels', () => {
    expect(source).toContain("t('publishing.audienceEveryone')");
    expect(source).toContain("t('publishing.audienceGuests')");
    expect(source).toContain("t('publishing.audienceLearners')");
  });

  it('uses t() for unpublish confirmation', () => {
    expect(source).toContain("t('publishing.unpublishConfirm')");
  });

  it('uses t() for unpublish error', () => {
    expect(source).toContain("t('publishing.unpublishFailed')");
  });

  it('no hardcoded English audience labels remain', () => {
    // The AUDIENCE_OPTIONS should not contain literal English strings
    expect(source).not.toMatch(/label:\s*['"]Everyone['"]/);
    expect(source).not.toMatch(/label:\s*['"]Guests only['"]/);
    expect(source).not.toMatch(/label:\s*['"]Learners only['"]/);
  });

  it('accepts onPublishSuccess callback', () => {
    expect(source).toContain('onPublishSuccess');
  });
});

describe('gallery/page.tsx (server component)', () => {
  const source = loadSource(resolve(__dirname, '../../app/gallery/page.tsx'));

  it('does not import getClientTranslation (server/client boundary)', () => {
    // Server components cannot use getClientTranslation because
    // lib/i18n/config.ts imports initReactI18next which calls createContext.
    expect(source).not.toContain('getClientTranslation');
  });

  it('uses serverTranslate() for gallery heading and empty state', () => {
    // Gallery is a server component. It uses serverTranslate() with resolveServerLocale().
    expect(source).toContain("serverTranslate(locale, 'publishing.galleryTitle')");
    expect(source).toContain("serverTranslate(locale, 'publishing.galleryEmpty')");
  });

  it('imports resolveServerLocale for server-side locale resolution', () => {
    expect(source).toContain('resolveServerLocale');
  });

  it('does not import client-side translate (server/client boundary)', () => {
    // Server components cannot use the client-side translate function.
    expect(source).not.toContain("import { translate } from '@/lib/i18n'");
  });
});
