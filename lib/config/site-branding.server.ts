/**
 * Server-only site branding loader. Reads env vars and the optional
 * server-branding.yml file. This module must never be imported by
 * client components — it depends on node:fs and js-yaml.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { SITE_BRANDING_DEFAULTS, readBoolean, type SiteBranding } from '@/lib/config/site-branding';

export type { SiteBranding };

const DEFAULT_FILENAME = 'server-branding.yml';

/**
 * Read the optional YAML branding file. Returns an empty object when
 * the file is absent or unparseable. The loader mirrors the pattern
 * from lib/server/provider-config.ts loadYamlFile.
 */
function loadYamlFile(filename: string): Record<string, unknown> {
  try {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Resolve site branding from three layers: defaults, then the optional
 * server-branding.yml file, then environment variables. Env wins.
 */
export function loadSiteBranding(): SiteBranding {
  const yamlData = loadYamlFile(DEFAULT_FILENAME);
  const yamlName =
    typeof yamlData.name === 'string' && yamlData.name.trim() ? yamlData.name.trim() : undefined;
  const yamlTagline =
    typeof yamlData.tagline === 'string' && yamlData.tagline.trim()
      ? yamlData.tagline.trim()
      : undefined;
  const yamlShowLogo = typeof yamlData.showLogo === 'boolean' ? yamlData.showLogo : undefined;
  const yamlShowHeadline =
    typeof yamlData.showHeadline === 'boolean' ? yamlData.showHeadline : undefined;

  return {
    name: process.env.SITE_NAME || yamlName || SITE_BRANDING_DEFAULTS.name,
    tagline: process.env.SITE_TAGLINE || yamlTagline || SITE_BRANDING_DEFAULTS.tagline,
    showLogo:
      process.env.SHOW_LOGO !== undefined
        ? readBoolean(process.env.SHOW_LOGO)
        : (yamlShowLogo ?? SITE_BRANDING_DEFAULTS.showLogo),
    showHeadline:
      process.env.SHOW_HEADLINE !== undefined
        ? readBoolean(process.env.SHOW_HEADLINE)
        : (yamlShowHeadline ?? SITE_BRANDING_DEFAULTS.showHeadline),
  };
}
