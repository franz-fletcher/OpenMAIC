'use client';

/**
 * Admin users section. Client component for the user management table.
 * Provides search, role picker, ban toggle wired to the API routes.
 *
 * The identity column never renders in the UI (ban reason only).
 */

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  roleId: string | null;
  role: string | null;
  rank: number;
  banned: boolean;
  banReason: string | null;
  createdAt: string;
}

interface Role {
  id: string;
  name: string;
  rank: number;
}

export default function UsersSection() {
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async (query?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      } else {
        setError(data.message || 'Failed to load users');
      }
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    // Load roles from the roles API instead of hardcoding.
    // Option values are role IDs and the current-selection highlight
    // resolves by ID through the fetched list, because user.role
    // carries the role NAME and custom role ids are uuids, not names.
    fetch('/api/admin/roles')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.roles)) {
          setRoles(
            data.roles.map((r: { id: string; name: string; rank: number }) => ({
              id: r.id,
              name: r.name,
              rank: r.rank,
            })),
          );
        } else {
          // Fallback to hardcoded system roles on failure
          setRoles([
            { id: 'guest', name: 'guest', rank: 1 },
            { id: 'learner', name: 'learner', rank: 2 },
            { id: 'creator', name: 'creator', rank: 3 },
            { id: 'admin', name: 'admin', rank: 4 },
          ]);
        }
      })
      .catch(() => {
        // Fallback to hardcoded system roles on network error
        setRoles([
          { id: 'guest', name: 'guest', rank: 1 },
          { id: 'learner', name: 'learner', rank: 2 },
          { id: 'creator', name: 'creator', rank: 3 },
          { id: 'admin', name: 'admin', rank: 4 },
        ]);
      });
  }, [fetchUsers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers(search);
  };

  const handleRoleChange = async (userId: string, roleId: string) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'setRole', roleId }),
      });
      if (res.ok) {
        fetchUsers(search);
      }
    } catch {
      // Silent fail; the UI stays on the last known state
    }
  };

  const handleBanToggle = async (userId: string, currentlyBanned: boolean) => {
    if (!currentlyBanned) {
      const confirmed = window.confirm(t('admin.users.banConfirm'));
      if (!confirmed) return;
    }
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'setBanned', banned: !currentlyBanned }),
      });
      if (res.ok) {
        fetchUsers(search);
      }
    } catch {
      // Silent fail; the UI stays on the last known state
    }
  };

  return (
    <section data-testid="admin-users-section">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {t('admin.users.title')}
      </h2>

      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder={t('admin.users.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          {t('admin.users.searchButton')}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.users.email')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.users.verified')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.users.role')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.users.banned')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.users.created')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.users.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-3">{user.email}</td>
                  <td className="py-2 px-3">
                    {user.emailVerified ? (
                      <span className="text-green-600 dark:text-green-400">
                        {t('admin.users.yes')}
                      </span>
                    ) : (
                      <span className="text-gray-400">{t('admin.users.no')}</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <select
                      value={user.roleId ?? ''}
                      onChange={(e) => handleRoleChange(user.id, e.target.value)}
                      className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-800"
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    {user.banned ? (
                      <span className="text-red-600 dark:text-red-400">
                        {t('admin.users.bannedYes')}
                      </span>
                    ) : (
                      <span className="text-gray-400">{t('admin.users.bannedNo')}</span>
                    )}
                  </td>
                  <td className="py-2 px-3">{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 px-3">
                    <button
                      onClick={() => handleBanToggle(user.id, user.banned)}
                      className={`px-2 py-1 text-xs rounded ${
                        user.banned
                          ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300'
                          : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300'
                      }`}
                    >
                      {user.banned ? t('admin.users.unban') : t('admin.users.ban')}
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-gray-500 dark:text-gray-400">
                    {t('admin.users.noUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
