'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createAuthClient } from '@/lib/auth/client';

const auth = createAuthClient({});

export default function Page() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setUnverified(false);

    const result = await auth.signIn({ email, password });
    setLoading(false);

    if (result.error) {
      if (result.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true);
        return;
      }
      setError(result.error);
      return;
    }

    router.push('/');
  }

  async function handleResend() {
    setResending(true);
    await auth.resendVerification({ email });
    setResending(false);
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="w-full max-w-[400px]">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 text-center mb-1">
          {t('auth.signin.title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-8">
          {t('auth.signin.subtitle')}
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-4"
        >
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
              <p className="font-medium">{t('auth.signin.errors.invalidCredentials')}</p>
              <p>{t('auth.signin.errors.invalidCredentialsDetail')}</p>
            </div>
          )}

          {unverified && (
            <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-lg p-3 text-sm text-cyan-700 dark:text-cyan-300">
              <p className="font-medium">{t('auth.signin.unverified.title')}</p>
              <p>
                {t('auth.signin.unverified.body').replace('{email}', email)}{' '}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="underline font-medium"
                >
                  {resending ? t('common.loading') : t('auth.signin.unverified.resend')}
                </button>
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('auth.signin.email')}
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

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('auth.signin.password')}
              </label>
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span className="cursor-not-allowed">{t('auth.signin.forgot')}</span>
                <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-[9px] font-medium">
                  {t('auth.signin.forgotSoon')}
                </span>
              </span>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? t('common.loading') : t('auth.signin.submit')}
          </button>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            New to OpenMAIC?{' '}
            <Link
              href="/signup"
              className="text-purple-600 dark:text-purple-400 font-medium hover:underline"
            >
              {t('auth.nav.createAccount')}
            </Link>
          </p>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4 max-w-[340px] mx-auto">
          {t('auth.signin.forgotNote')}
        </p>
      </div>
    </div>
  );
}
