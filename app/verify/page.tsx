'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createAuthClient } from '@/lib/auth/client';

const auth = createAuthClient({});

function VerifyContent() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'failure'>('loading');
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('failure');
      return;
    }

    // Try to verify the token by calling the verify endpoint.
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.ok) {
          setStatus('success');
        } else {
          setStatus('failure');
        }
      })
      .catch(() => setStatus('failure'));
  }, [token]);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setResending(true);
    await auth.resendVerification({ email });
    setResending(false);
  }

  if (status === 'loading') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <div className="text-sm text-gray-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <div className="w-full max-w-[400px] text-center">
          <div className="mb-6 inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/20">
            <svg
              className="w-8 h-8 text-green-600 dark:text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('auth.verify.success.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {t('auth.verify.success.body').replace('{name}', '')}
          </p>
          <Link
            href="/"
            className="inline-block w-full py-2.5 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors"
          >
            {t('auth.verify.success.continue')}
          </Link>
          <p className="text-xs text-gray-400 mt-4">{t('auth.verify.success.claimNote')}</p>
        </div>
      </div>
    );
  }

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
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {t('auth.verify.failure.title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t('auth.verify.failure.body')}
        </p>
        <form
          onSubmit={handleResend}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('auth.verify.failure.email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
          </div>
          <button
            type="submit"
            disabled={resending}
            className="w-full py-2.5 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {resending ? t('common.loading') : t('auth.verify.failure.submit')}
          </button>
          <p className="text-xs text-gray-400">
            You can also{' '}
            <Link
              href="/login"
              className="text-purple-600 dark:text-purple-400 font-medium hover:underline"
            >
              {t('auth.verify.failure.loginResend')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
          <div className="text-sm text-gray-500">Loading...</div>
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
