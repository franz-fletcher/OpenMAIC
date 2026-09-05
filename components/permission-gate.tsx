'use client';

import type { ReactNode } from 'react';
import { usePermissions } from '@/lib/hooks/use-permissions';
import type { Permission } from '@/lib/auth/permissions';

/**
 * Props for the PermissionGate render-prop component.
 */
export interface PermissionGateProps {
  /** The permission required to show children. */
  permission: Permission;
  /** Content to render when the permission is denied. */
  fallback?: ReactNode;
  /** Content to render when the permission is granted. */
  children: ReactNode;
}

/**
 * Render-prop component that hides children when a permission is denied.
 * Shows the fallback (or nothing) when the user lacks the permission.
 * Uses the usePermissions hook for the permission check.
 */
export function PermissionGate({ permission, fallback = null, children }: PermissionGateProps) {
  const { can } = usePermissions();
  return can(permission) ? <>{children}</> : <>{fallback}</>;
}
