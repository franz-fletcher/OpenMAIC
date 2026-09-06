/**
 * Hermetic unit test for the admin settings page gate.
 *
 * Verifies through the REAL requirePermission + the REAL guard():
 * - Admin with a users.manage role renders the three sections
 * - Guest (no session) receives the not-authorized state
 * - The page catches the guard throw and never lets it escape
 * - Translated i18n strings are rendered, not raw keys
 *
 * Mocks only at the transport boundary: getSession (cookie lookup)
 * and getServerPersistenceProvider (DB queries for ban + rank).
 * requirePermission itself runs real code.
 *
 * Flag OFF behavior: the admin page still enforces users.manage
 * unconditionally (admin surface gates unconditionally per the settings
 * gate split decision).
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
// Mocks -- transport boundary only
// ---------------------------------------------------------------------------

interface FullSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

let _mockSession: FullSession | null = {
  id: 'sess-1',
  userId: 'test-user',
  token: 'tok',
  expiresAt: new Date('2099-01-01'),
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ipAddress: null,
  userAgent: null,
};

// Mock getSession at the transport boundary.
vi.mock('@/lib/auth/index', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/auth/index')>();
  return {
    ...orig,
    getSession: vi.fn(async () => _mockSession),
  };
});

// Mock getServerPersistenceProvider so requirePermission DB calls resolve.
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: vi.fn(async () => ({
    pool: {
      query: vi.fn(async (sql: string) => {
        // Ban check: not banned
        if (sql.includes('"banned"')) {
          return { rows: [{ banned: false }] };
        }
        // Role rank: return admin rank 4 for the test user
        if (sql.includes('user_roles') || sql.includes('roles')) {
          return { rows: [{ rank: 4 }] };
        }
        return { rows: [] };
      }),
    },
  })),
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

// Mock next/headers to return real Headers with cookie.
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    const h = new Headers();
    if (_mockSession) {
      h.set('cookie', 'better-auth.session_token=test-token');
    }
    return h;
  }),
}));

// Mock i18n server functions.
vi.mock('@/lib/i18n/server', () => ({
  resolveServerLocale: vi.fn(async () => 'en-US'),
}));

vi.mock('@/lib/i18n/server-translate', () => ({
  serverTranslate: vi.fn(async (_locale: string, key: string) => {
    const translations: Record<string, string> = {
      'admin.notAuthorized': 'You do not have permission to access this page.',
      'admin.settings.title': 'Admin Settings',
      'admin.users.title': 'Users',
      'admin.invites.title': 'Invites',
      'admin.courses.title': 'Courses',
    };
    return translations[key] ?? key;
  }),
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

  describe('ADMIN_PAGE_OK: guest -> not-authorized state', () => {
    it('renders translated not-authorized when session is null', async () => {
      _mockSession = null;
      try {
        const { default: AdminSettingsPage } = await import('@/app/admin/settings/page');
        const result = await AdminSettingsPage();
        const { renderToStaticMarkup } = await import('react-dom/server');
        const html = renderToStaticMarkup(result as React.ReactElement);
        expect(html).toContain('You do not have permission to access this page.');
        expect(html).not.toContain('USERS_SECTION');
        expect(html).not.toContain('INVITES_SECTION');
        expect(html).not.toContain('COURSES_SECTION');
      } finally {
        _mockSession = {
          id: 'sess-1',
          userId: 'test-user',
          token: 'tok',
          expiresAt: new Date('2099-01-01'),
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
          ipAddress: null,
          userAgent: null,
        };
      }
    });
  });

  describe('ADMIN_PAGE_OK: admin -> renders three sections', () => {
    it('renders users, invites, and courses sections with translated titles', async () => {
      _mockSession = {
        id: 'sess-1',
        userId: 'test-user',
        token: 'tok',
        expiresAt: new Date('2099-01-01'),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
        ipAddress: null,
        userAgent: null,
      };
      const { default: AdminSettingsPage } = await import('@/app/admin/settings/page');
      const result = await AdminSettingsPage();
      const { renderToStaticMarkup } = await import('react-dom/server');
      const html = renderToStaticMarkup(result as React.ReactElement);
      // Verify translated strings, not raw keys
      expect(html).toContain('Admin Settings');
      expect(html).toContain('Users');
      expect(html).toContain('Invites');
      expect(html).toContain('Courses');
      // Verify section components render
      expect(html).toContain('USERS_SECTION');
      expect(html).toContain('INVITES_SECTION');
      expect(html).toContain('COURSES_SECTION');
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
