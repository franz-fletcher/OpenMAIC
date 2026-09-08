'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/hooks/use-i18n';
import { createAuthClient } from '@/lib/auth/client';

const auth = createAuthClient({});

export default function Page() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);

  const passwordChecks = {
    length: password.length >= 8,
    mix: /[a-zA-Z]/.test(password) && /\d/.test(password),
    notEmail: password !== email,
    match: password === confirmPassword && confirmPassword.length > 0,
  };

  const allValid =
    email.includes('@') &&
    passwordChecks.length &&
    passwordChecks.mix &&
    passwordChecks.notEmail &&
    passwordChecks.match;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allValid) return;
    setLoading(true);
    setError('');

    // Derive display name from email local-part for the signUp payload.
    // The DB schema requires name NOT NULL; better-auth rejects without it.
    const name = email.split('@')[0] || email;
    const result = await auth.signUp({ email, password, name });
    setLoading(false);

    if (result.error) {
      if (result.error.includes('already exists')) {
        setError('exists');
      } else {
        setError('generic');
      }
      return;
    }

    setPending(true);
  }

  if (pending) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
        <div className="w-full max-w-[400px] text-center">
          <div className="mb-6 inline-flex items-center justify-center w-16 h-16 rounded-full bg-cyan-50 dark:bg-cyan-900/20">
            <svg
              className="w-8 h-8 text-cyan-600 dark:text-cyan-400"
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
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            {t('auth.signup.pending.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            {t('auth.signup.pending.body').replace('{email}', email)}
          </p>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
            <button
              onClick={() => setPending(false)}
              className="w-full py-2.5 px-4 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {t('auth.signup.pending.restart')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="w-full max-w-[400px]">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 text-center mb-1">
          {t('auth.signup.title')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-8">
          {t('auth.signup.subtitle')}
        </p>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-4"
        >
          {error === 'exists' && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-700 dark:text-amber-300">
              <p className="font-medium">{t('auth.signup.errors.emailExists')}</p>
              <Link href="/login" className="underline font-medium">
                {t('auth.signup.errors.signInInstead')}
              </Link>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('auth.signup.email')}
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('auth.signup.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
            <p className="text-xs text-gray-400 mt-1">{t('auth.signup.passwordHint')}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('auth.signup.confirmPassword')}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              required
            />
            {confirmPassword && !passwordChecks.match && (
              <p className="text-xs text-red-500 mt-1">
                {t('auth.signup.validation.passwordMismatch')}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!allValid || loading}
            className="w-full py-2.5 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? t('common.loading') : t('auth.signup.submit')}
          </button>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            {t('auth.signup.haveAccount')}{' '}
            <Link
              href="/login"
              className="text-purple-600 dark:text-purple-400 font-medium hover:underline"
            >
              {t('auth.signup.signInLink')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
