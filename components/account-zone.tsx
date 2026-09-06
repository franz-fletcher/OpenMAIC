'use client';

/**
 * Account zone for the header capsule. Renders the signed-in state
 * with avatar initials, name, role badge, and sign-out action.
 * Fills the batch G capsule's accountSlot prop.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createAuthClient } from '@/lib/auth/client';
import { usePermissions } from '@/lib/hooks/use-permissions';
import { isMinimalModeClientEnabled } from '@/lib/config/feature-flags';

const auth = createAuthClient({});

interface AccountZoneProps {
  /** Called when the user signs out. */
  onSignOut?: () => void;
  /** Called when the user opens settings. Opens the provider dialog. */
  onOpenSettings?: () => void;
  /** Called when the user opens admin. Navigates to admin page. */
  onOpenAdmin?: () => void;
}

interface SessionData {
  user: { id: string; email: string; name?: string };
  session: { token: string };
}

/**
 * Menu items for the account dropdown. Settings gated by settings.manage.
 * Admin entry gated by users.manage. Account and Sign out always visible.
 */
function AccountMenuItems({
  t,
  setMenuOpen,
  handleSignOut,
  onOpenSettings,
  onOpenAdmin,
}: {
  t: (key: string) => string;
  setMenuOpen: (open: boolean) => void;
  handleSignOut: () => void;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
}) {
  const { can } = usePermissions();

  return (
    <div className="py-1">
      <button
        onClick={() => setMenuOpen(false)}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
      >
        {t('auth.account.title')}
      </button>
      {can('settings.manage') ? (
        <button
          onClick={() => {
            setMenuOpen(false);
            onOpenSettings?.();
          }}
          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
        >
          {t('auth.account.settings')}
        </button>
      ) : null}
      {can('users.manage') && (
        <button
          onClick={() => {
            setMenuOpen(false);
            onOpenAdmin?.();
          }}
          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
        >
          {t('auth.account.admin')}
        </button>
      )}
      <button
        onClick={handleSignOut}
        className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        {t('auth.account.signOut')}
      </button>
    </div>
  );
}

export function AccountZone({ onSignOut, onOpenSettings, onOpenAdmin }: AccountZoneProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/get-session')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.session) setSession(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSignOut() {
    await auth.signOut();
    setSession(null);
    setMenuOpen(false);
    onSignOut?.();
    router.refresh();
  }

  if (loading) return null;

  // Signed out: show "Sign in" pill. Under minimal mode, also show
  // "Create account" so the first step into the product is one click.
  if (!session) {
    const minimalMode = isMinimalModeClientEnabled();
    if (minimalMode) {
      return (
        <div className="flex items-center gap-1.5">
          <a
            href="/login"
            data-testid="capsule-sign-in"
            className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-700/60 rounded-full hover:bg-white dark:hover:bg-gray-700 transition-colors"
          >
            {t('auth.nav.signIn')}
          </a>
          <a
            href="/signup"
            data-testid="capsule-create-account"
            className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 dark:bg-purple-500 rounded-full hover:bg-purple-700 dark:hover:bg-purple-600 transition-colors"
          >
            {t('auth.nav.createAccount')}
          </a>
        </div>
      );
    }
    return (
      <a
        href="/login"
        className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white/60 dark:bg-gray-700/60 rounded-full hover:bg-white dark:hover:bg-gray-700 transition-colors"
      >
        {t('auth.nav.signIn')}
      </a>
    );
  }

  const name = session.user.name || session.user.email.split('@')[0];
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/60 dark:bg-gray-700/60 hover:bg-white dark:hover:bg-gray-700 transition-colors"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[10px] font-semibold flex items-center justify-center">
          {initials}
        </span>
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">
          {name}
        </span>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute top-full mt-2 right-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden min-w-[200px]">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {session.user.email}
              </p>
            </div>
            <AccountMenuItems
              t={t}
              setMenuOpen={setMenuOpen}
              handleSignOut={handleSignOut}
              onOpenSettings={onOpenSettings}
              onOpenAdmin={onOpenAdmin}
            />
          </div>
        </>
      )}
    </div>
  );
}
