import { NextResponse } from 'next/server';
import { loadSiteBranding } from '@/lib/config/site-branding.server';

export const runtime = 'nodejs';

/**
 * Public endpoint that returns the resolved site branding configuration.
 * No PII. No auth required. The ACCESS_CODE middleware curtain still applies.
 */
export async function GET() {
  const branding = loadSiteBranding();
  return NextResponse.json({
    name: branding.name,
    tagline: branding.tagline,
    showLogo: branding.showLogo,
    showHeadline: branding.showHeadline,
  });
}
