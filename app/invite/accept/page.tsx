'use client';

/**
 * Invite accept page. Validates the invite code read-only and prefills
 * the signup form with the invited email and role.
 *
 * The code is validated via a server API call. On success, the email and
 * role are shown. The user completes signup, and the user-create hook
 * consumes the invite and grants the role in the same transaction.
 *
 * Invalid, expired, used, or revoked codes show the invalid state.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface InviteInfo {
  email: string;
  roleName: string;
  expiresAt: string;
}

export default function Page() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) {
      setError('no_code');
      setLoading(false);
      return;
    }

    async function validate() {
      try {
        const res = await fetch(`/api/invite/validate?code=${encodeURIComponent(code!)}`);
        if (!res.ok) {
          setError('invalid');
        } else {
          const data = await res.json();
          setInvite(data.invite);
        }
      } catch {
        setError('invalid');
      } finally {
        setLoading(false);
      }
    }

    validate();
  }, [code]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <div className="w-full max-w-[400px] text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">Validating invitation...</p>
        </div>
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <div className="w-full max-w-[400px] text-center">
          <div className="mb-6 inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 dark:bg-red-900/20">
            <svg
              className="w-8 h-8 text-red-600 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Invalid Invitation
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {error === 'no_code'
              ? 'No invitation code provided.'
              : 'This invitation link is invalid, expired, or has already been used.'}
          </p>
          <Link
            href="/signup"
            className="inline-block py-2.5 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors"
          >
            Sign up normally
          </Link>
        </div>
      </div>
    );
  }

  const expiryDate = new Date(invite.expiresAt);
  const isExpired = expiryDate < new Date();

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/20">
          <svg
            className="w-8 h-8 text-green-600 dark:text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 text-center mb-2">
          You&apos;ve been invited
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-8">
          Complete your signup to accept this invitation.
        </p>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email
            </label>
            <input
              type="email"
              value={invite.email}
              readOnly
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-sm text-gray-600 dark:text-gray-400 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Invited role
            </label>
            <div className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-sm text-gray-600 dark:text-gray-400 capitalize">
              {invite.roleName}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Expires
            </label>
            <div
              className={`px-3 py-2 rounded-lg border text-sm ${
                isExpired
                  ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                  : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400'
              }`}
            >
              {isExpired
                ? 'Expired'
                : expiryDate.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
            </div>
          </div>

          <Link
            href={`/signup?email=${encodeURIComponent(invite.email)}&invite=true`}
            className="block w-full py-2.5 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium text-center hover:bg-purple-700 transition-colors"
          >
            Continue to signup
          </Link>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            Already have an account?{' '}
            <Link
              href="/login"
              className="text-purple-600 dark:text-purple-400 font-medium hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
