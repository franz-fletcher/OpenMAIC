'use client';

import { useEffect, useState } from 'react';
import { SITE_BRANDING_DEFAULTS, type SiteBranding } from '@/lib/config/site-branding';

export interface SiteBrandingState extends SiteBranding {
  loaded: boolean;
}

/**
 * Client hook that fetches site branding from the public API route.
 * Returns defaults immediately. On success, resolves to the fetched
 * values. On any non-2xx response or fetch error, keeps the defaults
 * and never throws to the UI.
 */
export function useSiteBranding(): SiteBrandingState {
  const [state, setState] = useState<SiteBrandingState>({
    ...SITE_BRANDING_DEFAULTS,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchBranding() {
      try {
        const res = await fetch('/api/site-branding');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setState({
          name: data.name ?? SITE_BRANDING_DEFAULTS.name,
          tagline: data.tagline ?? SITE_BRANDING_DEFAULTS.tagline,
          showLogo: data.showLogo ?? SITE_BRANDING_DEFAULTS.showLogo,
          showHeadline: data.showHeadline ?? SITE_BRANDING_DEFAULTS.showHeadline,
          loaded: true,
        });
      } catch {
        // On error, keep defaults. Never throw to UI.
      }
    }

    fetchBranding();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
