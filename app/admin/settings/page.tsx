/**
 * Admin settings page. Server component gated by users.manage.
 *
 * Catches the guard throw and renders a dedicated not-authorized state
 * instead of letting the Response reach the error boundary.
 * The three section components ship as client components for S2-S4 wiring.
 */
import { requirePermission } from '@/lib/auth/permissions-server';
import UsersSection from '@/components/admin/users-section';
import InvitesSection from '@/components/admin/invites-section';
import CoursesSection from '@/components/admin/courses-section';

export const metadata = {
  title: 'Admin Settings',
};

async function guard(): Promise<boolean> {
  try {
    await requirePermission(new Headers(), 'users.manage');
    return true;
  } catch (err) {
    if (err instanceof Response) return false;
    throw err;
  }
}

export default async function AdminSettingsPage() {
  const authorized = await guard();

  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Not authorized
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">admin.notAuthorized</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8">
          admin.settings.title
        </h1>
        <div className="space-y-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              admin.users.title
            </h2>
            <UsersSection />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              admin.invites.title
            </h2>
            <InvitesSection />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              admin.courses.title
            </h2>
            <CoursesSection />
          </div>
        </div>
      </div>
    </div>
  );
}
