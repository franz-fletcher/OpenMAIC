// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Component-level test: non-holders get no Settings/Admin nodes at all.
// Holders see Settings with the auth.common.soon badge.
// Admin appears only with users.manage.

const mocks = vi.hoisted(() => ({
  mockCan: vi.fn(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: [],
    loading: false,
    can: mocks.mockCan,
  }),
}));

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/auth/client', () => ({
  createAuthClient: () => ({
    signOut: vi.fn(),
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

// Mock fetch for the session check in AccountZone.
global.fetch = vi.fn() as unknown as typeof fetch;

import { AccountZone } from '@/components/account-zone';

let root: Root;
let container: HTMLDivElement;

function renderWithSession() {
  // Mock fetch to return a session.
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({
      session: { token: 'tok' },
      user: { id: 'u1', email: 'test@example.com', name: 'Test User' },
    }),
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(AccountZone));
  });
}

function openMenu() {
  const trigger = container.querySelector(
    'button[aria-haspopup="menu"]',
  ) as HTMLButtonElement | null;
  if (trigger) {
    act(() => {
      trigger.click();
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Non-holder — Settings and Admin are hidden
// ---------------------------------------------------------------------------

describe('AccountZone — non-holder gating', () => {
  it('does not render Settings when user lacks settings.manage', async () => {
    mocks.mockCan.mockReturnValue(false);

    renderWithSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    openMenu();

    // Settings should NOT appear at all (not even with a Soon badge).
    const settingsButtons = container.querySelectorAll('button');
    const hasSettings = Array.from(settingsButtons).some((btn) =>
      btn.textContent?.includes('auth.account.settings'),
    );
    expect(hasSettings).toBe(false);
  });

  it('does not render Admin when user lacks users.manage', async () => {
    mocks.mockCan.mockReturnValue(false);

    renderWithSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    openMenu();

    const allText = container.textContent || '';
    expect(allText).not.toContain('auth.account.admin');
  });

  it('does not render the Soon badge when Settings is hidden', async () => {
    mocks.mockCan.mockReturnValue(false);

    renderWithSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    openMenu();

    const allText = container.textContent || '';
    expect(allText).not.toContain('auth.common.soon');
  });
});

// ---------------------------------------------------------------------------
// Holder — Settings shows with Soon badge, Admin shows with users.manage
// ---------------------------------------------------------------------------

describe('AccountZone — holder gating', () => {
  it('renders Settings with Soon badge when user has settings.manage', async () => {
    mocks.mockCan.mockImplementation((perm: string) => perm === 'settings.manage');

    renderWithSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    openMenu();

    const allText = container.textContent || '';
    expect(allText).toContain('auth.account.settings');
    expect(allText).toContain('auth.common.soon');
  });

  it('renders Admin when user has users.manage', async () => {
    mocks.mockCan.mockImplementation((perm: string) => perm === 'users.manage');

    renderWithSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    openMenu();

    const allText = container.textContent || '';
    expect(allText).toContain('auth.account.admin');
  });

  it('renders both Settings and Admin for admin user', async () => {
    mocks.mockCan.mockReturnValue(true);

    renderWithSession();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    openMenu();

    const allText = container.textContent || '';
    expect(allText).toContain('auth.account.settings');
    expect(allText).toContain('auth.account.admin');
    expect(allText).toContain('auth.common.soon');
  });
});
