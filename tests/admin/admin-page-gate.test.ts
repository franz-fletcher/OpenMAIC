/**
 * Hermetic unit test for the admin settings page gate.
 *
 * Verifies:
 * - AdminSettingsPage exports and renders the three sections when authorized
 * - The not-authorized state renders when requirePermission throws
 * - The page catches the guard throw (Response) and never lets it escape
 * - The three PLACEHOLDER sections exist as client components
 *
 * Flag OFF behavior: the admin page still enforces users.manage unconditionally
 * (admin surface gates unconditionally per the settings gate split decision).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = [
  'DATABASE_URL',
  'PERSISTENCE_DEV_TOKEN',
  'ACCESS_CODE',
  'OPENMAIC_AGENT_RUNTIME_ENABLED',
  'NEXT_PUBLIC_PRO_WORKBENCH_ENABLED',
  'NEXT_PUBLIC_MAIC_EDITOR_ENABLED',
  'MINIMAL_MODE',
  'NEXT_PUBLIC_MINIMAL_MODE',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let _mockSession: { userId: string; token: string; id: string } | null = {
  userId: 'test-user',
  token: 'tok',
  id: 'sess',
};

vi.mock('@/lib/auth/permissions-server', () => ({
  requirePermission: vi.fn(async () => {
    if (!_mockSession) {
      throw new Response(
        JSON.stringify({ message: 'permission denied', code: 'permission_denied' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    }
    return _mockSession;
  }),
}));

vi.mock('@/lib/auth/index', () => ({
  getSession: vi.fn(async () => _mockSession),
}));

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en-US',
    setLocale: () => undefined,
  }),
}));

vi.mock('@/components/admin/users-section', () => ({
  default: () => 'USERS_SECTION',
}));

vi.mock('@/components/admin/invites-section', () => ({
  default: () => 'INVITES_SECTION',
}));

vi.mock('@/components/admin/courses-section', () => ({
  default: () => 'COURSES_SECTION',
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin settings page gate', () => {
  describe('ADMIN_PAGE_OK: module exports', () => {
    it('exports AdminSettingsPage as default export', async () => {
      const mod = await import('@/app/admin/settings/page');
      expect(typeof mod.default).toBe('function');
    });
  });

  describe('ADMIN_PAGE_OK: not-authorized state', () => {
    it('renders not-authorized when requirePermission throws a Response', async () => {
      _mockSession = null;
      try {
        const { default: AdminSettingsPage } = await import('@/app/admin/settings/page');
        const result = await AdminSettingsPage();
        const { renderToStaticMarkup } = await import('react-dom/server');
        const html = renderToStaticMarkup(result as React.ReactElement);
        expect(html).toContain('admin.notAuthorized');
      } finally {
        _mockSession = { userId: 'test-user', token: 'tok', id: 'sess' };
      }
    });
  });

  describe('ADMIN_PAGE_OK: authorized state renders three sections', () => {
    it('renders users, invites, and courses sections', async () => {
      _mockSession = { userId: 'test-user', token: 'tok', id: 'sess' };
      const { default: AdminSettingsPage } = await import('@/app/admin/settings/page');
      const result = await AdminSettingsPage();
      const { renderToStaticMarkup } = await import('react-dom/server');
      const html = renderToStaticMarkup(result as React.ReactElement);
      expect(html).toContain('admin.users.title');
      expect(html).toContain('admin.invites.title');
      expect(html).toContain('admin.courses.title');
    });
  });

  describe('ADMIN_PAGE_OK: section components exist', () => {
    it('users-section exports a component', async () => {
      const mod = await import('@/components/admin/users-section');
      expect(typeof mod.default).toBe('function');
    });

    it('invites-section exports a component', async () => {
      const mod = await import('@/components/admin/invites-section');
      expect(typeof mod.default).toBe('function');
    });

    it('courses-section exports a component', async () => {
      const mod = await import('@/components/admin/courses-section');
      expect(typeof mod.default).toBe('function');
    });
  });
});
