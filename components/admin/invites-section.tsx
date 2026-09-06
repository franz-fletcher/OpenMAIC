'use client';

/**
 * Admin invites section. Displays pending invites with create, list,
 * and revoke controls. Wired to POST/GET /api/admin/invites and
 * DELETE /api/admin/invites/[id].
 */
import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';

interface Invite {
  id: string;
  email: string;
  roleName: string;
  expiresAt: string;
  createdAt: string;
}

const ROLE_OPTIONS = ['guest', 'learner', 'creator', 'admin'];

export default function InvitesSection() {
  const { t } = useI18n();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('guest');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadInvites = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/invites');
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites ?? []);
      }
    } catch {
      // Silently fail on load
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, roleName: role }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? 'Failed to create invite');
      } else {
        setSuccess(`Invite sent to ${email}`);
        setEmail('');
        setRole('guest');
        loadInvites();
      }
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      const res = await fetch(`/api/admin/invites/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        loadInvites();
      }
    } catch {
      // Silently fail
    }
  }

  return (
    <section data-testid="admin-invites-section">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {t('admin.invites.title')}
      </h2>

      {/* Create form */}
      <form onSubmit={handleCreate} className="mb-6 space-y-3">
        <div className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('admin.invites.emailPlaceholder')}
            required
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={creating || !email}
            className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? t('common.loading') : t('admin.invites.send')}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}
      </form>

      {/* Pending invites list */}
      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.invites.noInvites')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.invites.email')}
                </th>
                <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.invites.role')}
                </th>
                <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.invites.expires')}
                </th>
                <th className="text-left py-2 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.invites.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">{invite.email}</td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-gray-400 capitalize">
                    {invite.roleName}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => handleRevoke(invite.id)}
                      className="text-sm text-red-600 dark:text-red-400 hover:underline"
                    >
                      {t('admin.invites.revoke')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
