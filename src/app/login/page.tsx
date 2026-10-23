import type { Metadata } from 'next';
import Image from 'next/image';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in | TSF Admin Panel',
  icons: {
    icon: "/logo/logo.jpg",
  },
};

/**
 * Static on purpose: there is nothing request-specific to render, and the
 * password is checked by the Server Action. The Proxy redirects here whenever
 * the session cookie is missing or stale.
 */
export default function LoginPage() {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-950 p-6">
      {/* Decorative background elements */}
      <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-zinc-900 shadow-lg ring-1 ring-zinc-800">
            <Image
              src="/logo/logo.jpg"
              alt="TSF Logo"
              width={64}
              height={64}
              className="object-cover"
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            TSF Admin Panel
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Unified AI Business Suite & Inbox
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white">Sign in</h2>
            <p className="text-xs text-zinc-500">
              Enter your dashboard password to continue.
            </p>
          </div>

          <LoginForm />
        </div>

        <p className="mt-8 text-center text-xs text-zinc-600">
          Powered by mlwio &bull; Secure Access
        </p>
      </div>
    </main>
  );
}
