import type { Metadata } from 'next';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in | Unified Inbox',
};

/**
 * Static on purpose: there is nothing request-specific to render, and the
 * password is checked by the Server Action. The Proxy redirects here whenever
 * the session cookie is missing or stale.
 */
export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Unified Inbox
        </h1>
        <p className="mt-1 mb-5 text-xs text-zinc-500 dark:text-zinc-400">
          This dashboard can read every customer conversation and reply as you.
          Enter the password to continue.
        </p>

        <LoginForm />
      </div>
    </main>
  );
}
