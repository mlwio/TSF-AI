'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Runtime Error:', error);
  }, [error]);

  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-zinc-950 px-5 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500 mb-6">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      
      <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
      <p className="text-sm text-zinc-400 mb-8 max-w-sm leading-relaxed">
        {error.message || 'A server-side error occurred while loading the dashboard.'}
        <br />
        <span className="text-[10px] opacity-50 block mt-2">Digest: {error.digest}</span>
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => reset()}
          className="h-11 w-full rounded-xl bg-emerald-600 text-sm font-bold text-white transition-all hover:bg-emerald-500 active:scale-[0.98]"
        >
          Try again
        </button>
        
        <a 
          href="/login"
          className="text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-300"
        >
          Back to login
        </a>
      </div>
    </div>
  );
}
