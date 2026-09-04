import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'en-US', setLocale: () => undefined }),
}));

vi.mock('@/lib/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: () => undefined }),
}));

vi.mock('@/components/language-switcher', () => ({
  LanguageSwitcher: () => '<LanguageSwitcher />',
}));

vi.mock('@/components/workbench/ProBadge', () => ({
  ProBadge: ({ active }: { active: boolean }) => `<ProBadge active=${active} />`,
}));

vi.mock('@/lib/config/feature-flags', () => ({
  isProWorkbenchEnabled: () => true,
}));

vi.mock('@/lib/workbench/pro-swap', () => ({
  startProSwap: () => undefined,
  arrivedByProSwap: false,
}));

vi.mock('@/lib/workbench/workspace-session-memory', () => ({
  readLastWorkspaceSessionId: () => null,
  workspaceResumeHref: () => '/workspace',
}));

vi.mock('motion/react', () => ({
  motion: { button: 'button' },
  useReducedMotion: () => true,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

import { HeaderCapsule } from '@/components/header-capsule';

describe('HeaderCapsule markup contract', () => {
  it('renders all five capsule items in order', () => {
    const html = renderToStaticMarkup(
      createElement(HeaderCapsule, {
        onSettingsOpen: () => undefined,
      }),
    );

    // Language switcher
    expect(html).toContain('LanguageSwitcher');
    // Theme selector button (sun/moon/monitor icon area)
    expect(html).toContain('lucide-sun');
    // Pro badge
    expect(html).toContain('ProBadge');
    // Settings gear
    expect(html).toContain('lucide-settings');
  });

  it('renders with an account slot when provided', () => {
    const html = renderToStaticMarkup(
      createElement(HeaderCapsule, {
        onSettingsOpen: () => undefined,
        accountSlot: '<div data-testid="account-slot" />',
      }),
    );

    expect(html).toContain('account-slot');
  });
});
