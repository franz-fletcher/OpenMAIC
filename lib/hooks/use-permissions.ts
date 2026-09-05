'use client';

import { useEffect, useState } from 'react';
import type { Permission } from '@/lib/auth/permissions';

/**
 * Permission state returned by usePermissions.
 *
 * permissions: the resolved permission list for the current session.
 * loading: true until the fetch completes.
 * can: checks whether a specific permission is in the resolved set.
 */
export interface PermissionState {
  readonly permissions: readonly Permission[];
  readonly loading: boolean;
  readonly can: (permission: Permission) => boolean;
}

/**
 * Client hook that fetches the session's permission list from the
 * public API route. Returns defaults-deny (empty list) before
 * resolve and on any non-2xx or network error. Never throws to
 * the UI. Pure import graph: no server modules.
 */
export function usePermissions(): PermissionState {
  const [permissions, setPermissions] = useState<readonly Permission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchPermissions() {
      try {
        const res = await fetch('/api/auth/permissions');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const perms = Array.isArray(data.permissions) ? data.permissions : [];
        setPermissions(perms);
      } catch {
        // On error, keep empty. Never throw to UI.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPermissions();
    return () => {
      cancelled = true;
    };
  }, []);

  const can = (permission: Permission): boolean => permissions.includes(permission);

  return { permissions, loading, can };
}
