'use client';

/**
 * The standardized top-right capsule for the home header. Fixed order:
 * language, theme, Pro toggle, account slot, settings gear.
 *
 * The account slot renders null through a prop in batch G. Batch A fills
 * it with the account menu. Gear, theme, and language behaviors stay
 * unchanged in function. The Pro toggle is the workbench entry
 * affordance, the same intent as the hero ProBadge routing.
 */
import { useState } from 'react';
import { Settings, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/lib/hooks/use-theme';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ProBadge } from '@/components/workbench/ProBadge';
import { isProWorkbenchEnabled, isMinimalModeClientEnabled } from '@/lib/config/feature-flags';
import { usePermissions } from '@/lib/hooks/use-permissions';
import { startProSwap, arrivedByProSwap } from '@/lib/workbench/pro-swap';
import {
  readLastWorkspaceSessionId,
  workspaceResumeHref,
} from '@/lib/workbench/workspace-session-memory';

export interface HeaderCapsuleProps {
  /** Open the settings dialog. */
  onSettingsOpen: () => void;
  /**
   * Optional account slot. Renders null in batch G. Batch A fills it.
   */
  accountSlot?: React.ReactNode;
}

export function HeaderCapsule({ onSettingsOpen, accountSlot }: HeaderCapsuleProps) {
  const { theme, setTheme } = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);

  const workbenchBuildEnabled = isProWorkbenchEnabled();
  const minimalMode = isMinimalModeClientEnabled();
  const { can } = usePermissions();
  const enterWorkbench = () => {
    const href = workspaceResumeHref(readLastWorkspaceSessionId());
    startProSwap(href, () => {});
  };

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-1 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-2 py-1.5 rounded-full border border-gray-100/50 dark:border-gray-700/50 shadow-sm">
      {/* 1. Language Selector */}
      <LanguageSwitcher onOpen={() => setThemeOpen(false)} />

      <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />

      {/* 2. Theme Selector */}
      <div className="relative">
        <button
          onClick={() => setThemeOpen(!themeOpen)}
          className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all"
        >
          {theme === 'light' && <Sun className="w-4 h-4" />}
          {theme === 'dark' && <Moon className="w-4 h-4" />}
          {theme === 'system' && <Monitor className="w-4 h-4" />}
        </button>
        {themeOpen && (
          <div className="absolute top-full mt-2 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[140px]">
            <button
              onClick={() => {
                setTheme('light');
                setThemeOpen(false);
              }}
              className={cn(
                'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                theme === 'light' &&
                  'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
              )}
            >
              <Sun className="w-4 h-4" />
              Light
            </button>
            <button
              onClick={() => {
                setTheme('dark');
                setThemeOpen(false);
              }}
              className={cn(
                'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                theme === 'dark' &&
                  'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
              )}
            >
              <Moon className="w-4 h-4" />
              Dark
            </button>
            <button
              onClick={() => {
                setTheme('system');
                setThemeOpen(false);
              }}
              className={cn(
                'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                theme === 'system' &&
                  'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
              )}
            >
              <Monitor className="w-4 h-4" />
              System
            </button>
          </div>
        )}
      </div>

      <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />

      {/* 3. Pro Toggle (workbench entry affordance) */}
      {workbenchBuildEnabled && (!minimalMode || can('course.create')) && (
        <ProBadge active={false} onToggle={enterWorkbench} />
      )}

      {/* 4. Account slot (empty in G, batch A fills it) */}
      {accountSlot ?? null}

      <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />

      {/* 5. Settings Gear */}
      <div className="relative">
        <button
          onClick={onSettingsOpen}
          className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all group"
        >
          <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
        </button>
      </div>
    </div>
  );
}
