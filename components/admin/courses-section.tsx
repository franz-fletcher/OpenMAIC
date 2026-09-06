'use client';

/**
 * Admin courses section. Client component for the course administration table.
 * Provides the list with owner, status, audience, publish date, and actions
 * (unpublish-any, delete-any).
 *
 * The unpublish and republish actions drive the certified 017 routes and work
 * for any course. The delete action removes any course with a confirm dialog.
 */

import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';

interface AdminCourse {
  stageId: string;
  name: string;
  ownerId: string;
  ownerEmail: string | null;
  status: 'draft' | 'published';
  audience: number;
  publishedAt: number | null;
  deletedAt: Date | null;
}

const AUDIENCE_LABELS: Record<number, string> = {
  0: 'Everyone',
  1: 'Guests',
  2: 'Learners',
  3: 'Creators',
};

export default function CoursesSection() {
  const { t } = useI18n();
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/courses');
      const data = await res.json();
      if (data.success) {
        setCourses(data.courses);
      } else {
        setError(data.message || 'Failed to load courses');
      }
    } catch {
      setError('Failed to load courses');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  const handleUnpublish = async (stageId: string) => {
    try {
      const res = await fetch(`/api/stages/${stageId}/unpublish`, { method: 'POST' });
      if (res.ok) {
        fetchCourses();
      }
    } catch {
      // Silent fail; the UI stays on the last known state.
    }
  };

  const handleRepublish = async (stageId: string) => {
    try {
      const res = await fetch(`/api/stages/${stageId}/publish`, { method: 'POST' });
      if (res.ok) {
        fetchCourses();
      }
    } catch {
      // Silent fail; the UI stays on the last known state.
    }
  };

  const handleDelete = async (stageId: string) => {
    const confirmed = window.confirm(t('admin.courses.deleteConfirm'));
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/admin/courses/${stageId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchCourses();
      }
    } catch {
      // Silent fail; the UI stays on the last known state.
    }
  };

  return (
    <section data-testid="admin-courses-section">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
        {t('admin.courses.title')}
      </h2>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.courses.name')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.courses.owner')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.courses.status')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.courses.audience')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.courses.published')}
                </th>
                <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">
                  {t('admin.courses.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.stageId} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 px-3">{course.name}</td>
                  <td className="py-2 px-3">{course.ownerEmail ?? course.ownerId}</td>
                  <td className="py-2 px-3">
                    {course.status === 'published' ? (
                      <span className="text-green-600 dark:text-green-400">
                        {t('admin.courses.statusPublished')}
                      </span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">
                        {t('admin.courses.statusDraft')}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    {AUDIENCE_LABELS[course.audience] ?? String(course.audience)}
                  </td>
                  <td className="py-2 px-3">
                    {course.publishedAt
                      ? new Date(course.publishedAt).toLocaleDateString()
                      : '\u2014'}
                  </td>
                  <td className="py-2 px-3 flex gap-1">
                    {course.status === 'published' ? (
                      <button
                        onClick={() => handleUnpublish(course.stageId)}
                        className="px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900 dark:text-yellow-300"
                      >
                        {t('admin.courses.unpublish')}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRepublish(course.stageId)}
                        className="px-2 py-1 text-xs rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300"
                      >
                        {t('admin.courses.republish')}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(course.stageId)}
                      className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300"
                    >
                      {t('admin.courses.delete')}
                    </button>
                  </td>
                </tr>
              ))}
              {courses.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-gray-500 dark:text-gray-400">
                    {t('admin.courses.noCourses')}
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
