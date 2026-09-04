/**
 * Client-safe site branding surface. Exports only types, constants, and
 * pure functions with no Node.js or bundler-problematic imports.
 *
 * The server-only `loadSiteBranding` lives in site-branding.server.ts.
 * The client hook (`use-site-branding.ts`) imports from THIS file only.
 */

/**
 * Truthy values: 'true' or '1'. Anything else (including unset) is
 * treated as disabled.
 */
export function readBoolean(envValue: string | undefined): boolean {
  return envValue === 'true' || envValue === '1';
}

export interface SiteBranding {
  name: string;
  tagline: string;
  showLogo: boolean;
  showHeadline: boolean;
}

export const SITE_BRANDING_DEFAULTS: SiteBranding = {
  name: 'OpenMAIC',
  tagline: '',
  showLogo: true,
  showHeadline: true,
};
