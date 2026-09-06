/**
 * Admin settings page. Server component gated by users.manage.
 *
 * Catches the guard throw and renders a dedicated not-authorized state
 * instead of letting the Response reach the error boundary.
 * The three section components ship as client components for S2-S4 wiring.
 */
import { headers } from 'next/headers';
import { requirePermission } from '@/lib/auth/permissions-server';
import { resolveServerLocale } from '@/lib/i18n/server';
import { serverTranslate } from '@/lib/i18n/server-translate';
import UsersSection from '@/components/admin/users-section';
import InvitesSection from '@/components/admin/invites-section';
import CoursesSection from '@/components/admin/courses-section';

export const metadata = {
  title: 'Admin Settings',
};

async function guard(h: Headers): Promise<boolean> {
  try {
    await requirePermission(h, 'users.manage');
    return true;
  } catch (err) {
    if (err instanceof Response) return false;
    throw err;
  }
}

export default async function AdminSettingsPage() {
  const h = await headers();
  const authorized = await guard(h);

  if (!authorized) {
    const locale = await resolveServerLocale();
    const [notAuthorized] = await Promise.all([serverTranslate(locale, 'admin.notAuthorized')]);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {notAuthorized}
          </h1>
        </div>
      </div>
    );
  }

  const locale = await resolveServerLocale();
  const [title, usersTitle, invitesTitle, coursesTitle] = await Promise.all([
    serverTranslate(locale, 'admin.settings.title'),
    serverTranslate(locale, 'admin.users.title'),
    serverTranslate(locale, 'admin.invites.title'),
    serverTranslate(locale, 'admin.courses.title'),
  ]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8">{title}</h1>
        <div className="space-y-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {usersTitle}
            </h2>
            <UsersSection />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {invitesTitle}
            </h2>
            <InvitesSection />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {coursesTitle}
            </h2>
            <CoursesSection />
          </div>
        </div>
      </div>
    </div>
  );
}
