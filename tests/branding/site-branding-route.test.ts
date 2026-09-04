import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config/site-branding.server', () => ({
  loadSiteBranding: vi.fn(() => ({
    name: 'TestSite',
    tagline: 'Testing',
    showLogo: true,
    showHeadline: false,
  })),
}));

import { GET } from '@/app/api/site-branding/route';

describe('GET /api/site-branding', () => {
  it('returns the branding config as JSON', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      name: 'TestSite',
      tagline: 'Testing',
      showLogo: true,
      showHeadline: false,
    });
  });

  it('returns no PII fields', async () => {
    const response = await GET();
    const body = await response.json();

    expect(body).not.toHaveProperty('accessCode');
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('apiKey');
  });

  it('sets correct content type', async () => {
    const response = await GET();
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
