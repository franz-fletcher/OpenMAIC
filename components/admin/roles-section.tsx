'use client';

/**
 * Admin roles section. Client component for the role management table.
 * Displays role list with defaults and overrides, create form, edit controls,
 * permission checkboxes, and delete with attached-users guard.
 */

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { PERMISSION_CATALOG, type Permission } from '@/lib/auth/permissions';

interface RoleWithPermissions {
  id: string;
  name: string;
  rank: number;
  isSystem: boolean;
  defaults: Permission[];
  overrides: Record<string, boolean>;
  effective: Permission[];
}

interface PermissionGrant {
  permission: string;
  granted: boolean;
}

const RANK_OPTIONS = [1, 2, 3, 4];

export default function RolesSection() {
  const { t } = useI18n();
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createRank, setCreateRank] = useState(2);
  const [createPerms, setCreatePerms] = useState<Record<string, boolean>>({});

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRank, setEditRank] = useState(2);
  const [editPerms, setEditPerms] = useState<Record<string, boolean>>({});

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/roles');
      const data = await res.json();
      if (data.success) {
        setRoles(data.roles);
      } else {
        setError(data.message || 'Failed to load roles');
      }
    } catch {
      setError('Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const handleCreate = async () => {
    if (!createName.trim()) return;

    const permissions: PermissionGrant[] = PERMISSION_CATALOG.map((perm) => ({
      permission: perm,
      granted: createPerms[perm] ?? false,
    }));

    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          rank: createRank,
          permissions,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setCreateName('');
        setCreateRank(2);
        setCreatePerms({});
        fetchRoles();
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to create role');
      }
    } catch {
      setError('Failed to create role');
    }
  };

  const handleEdit = (role: RoleWithPermissions) => {
    setEditingId(role.id);
    setEditName(role.name);
    setEditRank(role.rank);
    setEditPerms({ ...role.overrides });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    const permissions: PermissionGrant[] = PERMISSION_CATALOG.map((perm) => ({
      permission: perm,
      granted: editPerms[perm] ?? false,
    }));

    try {
      const res = await fetch(`/api/admin/roles/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          rank: editRank,
          permissions,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        fetchRoles();
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to update role');
      }
    } catch {
      setError('Failed to update role');
    }
  };

  const handleReset = async (roleId: string) => {
    try {
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      if (res.ok) {
        fetchRoles();
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to reset role');
      }
    } catch {
      setError('Failed to reset role');
    }
  };

  const handleDelete = async (roleId: string, roleName: string) => {
    if (!window.confirm(t('admin.roles.deleteConfirm'))) return;

    try {
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchRoles();
      } else {
        const data = await res.json();
        setError(data.message || 'Failed to delete role');
      }
    } catch {
      setError('Failed to delete role');
    }
  };

  const toggleCreatePerm = (perm: string) => {
    setCreatePerms((prev) => ({ ...prev, [perm]: !(prev[perm] ?? false) }));
  };

  const toggleEditPerm = (perm: string) => {
    setEditPerms((prev) => ({ ...prev, [perm]: !(prev[perm] ?? false) }));
  };

  return (
    <section data-testid="admin-roles-section">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('admin.roles.title')}
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
        >
          {t('admin.roles.create')}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          {/* Role table */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                    {t('admin.roles.name')}
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                    {t('admin.roles.rank')}
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                    {t('admin.roles.system')}
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                    {t('admin.roles.permissions')}
                  </th>
                  <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                    {t('admin.roles.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 px-3 font-medium">{role.name}</td>
                    <td className="py-2 px-3">{role.rank}</td>
                    <td className="py-2 px-3">
                      {role.isSystem ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                          {t('admin.roles.system')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                          {t('admin.roles.custom')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <div className="text-xs space-y-0.5">
                        <div className="text-gray-500 dark:text-gray-400">
                          {t('admin.roles.defaults')}: {role.defaults.join(', ')}
                        </div>
                        {Object.keys(role.overrides).length > 0 && (
                          <div className="text-amber-600 dark:text-amber-400">
                            {t('admin.roles.overrides')}:{' '}
                            {Object.entries(role.overrides)
                              .map(([k, v]) => `${k}=${v ? '+' : '-'}`)
                              .join(', ')}
                          </div>
                        )}
                        <div className="text-green-600 dark:text-green-400">
                          {t('admin.roles.effective')}: {role.effective.join(', ')}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1">
                        {!role.isSystem && (
                          <>
                            <button
                              onClick={() => handleEdit(role)}
                              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              {t('admin.roles.edit')}
                            </button>
                            <button
                              onClick={() => handleDelete(role.id, role.name)}
                              className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800"
                            >
                              {t('admin.roles.delete')}
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleReset(role.id)}
                          className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded hover:bg-amber-200 dark:hover:bg-amber-800"
                        >
                          {t('admin.roles.reset')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {roles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-gray-500 dark:text-gray-400">
                      {t('admin.roles.noRoles')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
                {t('admin.roles.createTitle')}
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.roles.roleName')}
                  </label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.roles.selectRank')}
                  </label>
                  <select
                    value={createRank}
                    onChange={(e) => setCreateRank(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800"
                  >
                    {RANK_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.roles.permissions')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {PERMISSION_CATALOG.map((perm) => (
                    <label key={perm} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={createPerms[perm] ?? false}
                        onChange={() => toggleCreatePerm(perm)}
                        className="rounded"
                      />
                      <span className="text-gray-700 dark:text-gray-300">{perm}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                >
                  {t('admin.roles.create')}
                </button>
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setCreateName('');
                    setCreateRank(2);
                    setCreatePerms({});
                  }}
                  className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded-md text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Edit form */}
          {editingId && (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
                {t('admin.roles.editTitle')}
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.roles.roleName')}
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('admin.roles.selectRank')}
                  </label>
                  <select
                    value={editRank}
                    onChange={(e) => setEditRank(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800"
                  >
                    {RANK_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('admin.roles.permissions')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {PERMISSION_CATALOG.map((perm) => (
                    <label key={perm} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editPerms[perm] ?? false}
                        onChange={() => toggleEditPerm(perm)}
                        className="rounded"
                      />
                      <span className="text-gray-700 dark:text-gray-300">{perm}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                >
                  {t('admin.roles.edit')}
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 rounded-md text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
