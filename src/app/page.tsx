import { Suspense } from 'react';
import { connection } from 'next/server';

import { Dashboard } from '@/components/dashboard/dashboard';
import { listAgentEvents, listChats } from '@/lib/dashboard/queries';

/**
 * The dashboard reads with the service_role key at request time and is then
 * kept fresh by polling a Server Action on the client.
 *
 * Two Next 16 details make this shape necessary rather than optional:
 *   - `export const dynamic` was REMOVED once Cache Components was enabled.
 *   - `connection()` is the supported way to demand a real request, but runtime
 *     data access has to sit behind a <Suspense> boundary or the whole route is
 *     refused at build time as a blocking prerender.
 */
export default function Home() {
  return (
    <Suspense fallback={<InboxFallback />}>
      <Inbox />
    </Suspense>
  );
}

async function Inbox() {
  await connection();

  const [chats, events] = await Promise.all([listChats(), listAgentEvents()]);

  return <Dashboard initialChats={chats} initialEvents={events} />;
}

/** Mirrors the dashboard shell so the layout does not jump when data lands. */
function InboxFallback() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          TSF Admin Panel
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Loading...
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="max-h-[40vh] shrink-0 border-b border-zinc-200 bg-white lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r xl:w-80 dark:border-zinc-800 dark:bg-zinc-900" />
        <div className="flex-1 bg-zinc-50 dark:bg-zinc-950" />
        <aside className="max-h-[40vh] shrink-0 border-t border-zinc-200 bg-white lg:max-h-none lg:w-72 lg:border-t-0 lg:border-l xl:w-80 dark:border-zinc-800 dark:bg-zinc-900" />
      </div>
    </div>
  );
}
