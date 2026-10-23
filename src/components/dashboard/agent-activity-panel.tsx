'use client';

import {
  CircleCheckBig,
  CircleSlash,
  CircleX,
  Headphones,
  LoaderCircle,
  Package,
  Send,
  ShoppingCart,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { formatTime } from '@/lib/dashboard/format';
import { chatDisplayName, type ChatListItem } from '@/lib/dashboard/types';
import type { AgentEventRow, AgentEventType, AgentName } from '@/types/database';

/**
 * The right-hand "what are my agents doing" panel.
 *
 * Both agents run inside after() on the webhook function, so nothing they do is
 * visible from the browser by itself. Every step they take is written to
 * `agent_events` (see src/lib/ai/agent-events.ts) and re-read on the dashboard's
 * 3-second poll, which is what makes this panel live without any websocket.
 */

/**
 * How long a `started`/`thinking` step counts as "working".
 *
 * Slightly longer than the webhook's maxDuration (60s) so a genuinely slow
 * Gemini round-trip is never reported as finished before its terminal event
 * lands.
 */
const WORKING_WINDOW_MS = 90_000;

/** Transient steps: the agent is mid-task and a terminal event is expected. */
const WORKING_TYPES: AgentEventType[] = ['started', 'thinking'];

/** Steps that mean something needs a human. */
const PROBLEM_TYPES: AgentEventType[] = ['alert', 'error', 'order_failed'];

type AgentStatus = 'working' | 'attention' | 'idle';

const AGENTS: {
  name: AgentName;
  label: string;
  role: string;
  icon: typeof Headphones;
}[] = [
  {
    name: 'support_sales',
    label: 'Agent 1 · Support & Sales',
    role: 'কাস্টমারের রিপ্লাই দেয় ও অর্ডার কনফার্ম করে',
    icon: Headphones,
  },
  {
    name: 'order_manager',
    label: 'Agent 2 · Order Manager',
    role: 'BusinessKoro-তে অর্ডার প্লেস করে',
    icon: Package,
  },
];

export function AgentActivityPanel({
  events,
  chats,
  activeChatId,
}: {
  events: AgentEventRow[];
  chats: ChatListItem[];
  activeChatId: string | null;
}) {
  const now = useNow();

  // Resolved once here instead of one lookup per row.
  const names = new Map(chats.map((chat) => [chat.id, chatDisplayName(chat)]));

  return (
    <aside className="flex max-h-[40vh] shrink-0 flex-col overflow-hidden border-t border-zinc-200 bg-white lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l xl:w-96 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          AI Agents
        </h2>
        <span className="text-[11px] text-zinc-400">
          {events.length === 0 ? 'No activity yet' : 'Live activity'}
        </span>
      </header>

      <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        {AGENTS.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            latest={events.find((event) => event.agent === agent.name)}
            status={statusOf(
              events.find((event) => event.agent === agent.name),
              now,
            )}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
            কাস্টমার মেসেজ পাঠালে এখানে এজেন্টদের কাজ দেখা যাবে।
          </p>
        ) : (
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                chatName={event.chat_id ? names.get(event.chat_id) : undefined}
                isActiveChat={
                  event.chat_id !== null && event.chat_id === activeChatId
                }
              />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function AgentCard({
  agent,
  latest,
  status,
}: {
  agent: (typeof AGENTS)[number];
  latest: AgentEventRow | undefined;
  status: AgentStatus;
}) {
  const Icon = agent.icon;

  const tone =
    status === 'working'
      ? 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40'
      : status === 'attention'
        ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
        : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/40';

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tone}`}>
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            agent.name === 'support_sales'
              ? 'bg-emerald-600 text-white'
              : 'bg-sky-600 text-white'
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {agent.label}
          </p>
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {agent.role}
          </p>
        </div>

        <StatusPill status={status} />
      </div>

      <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        {latest ? latest.title : 'এখনো কিছু করেনি'}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: AgentStatus }) {
  if (status === 'working') {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
        <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
        Working
      </span>
    );
  }

  if (status === 'attention') {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
        <TriangleAlert className="h-3 w-3" aria-hidden />
        Attention
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" aria-hidden />
      Idle
    </span>
  );
}

function EventRow({
  event,
  chatName,
  isActiveChat,
}: {
  event: AgentEventRow;
  chatName: string | undefined;
  isActiveChat: boolean;
}) {
  const { icon: Icon, tone } = visualsFor(event.event_type);

  return (
    <li
      className={`flex gap-2.5 px-4 py-2.5 ${
        isActiveChat ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : ''
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${tone}`}>
        <Icon
          className={`h-3.5 w-3.5 ${
            event.event_type === 'thinking' ? 'animate-spin' : ''
          }`}
          aria-hidden
        />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200">
          {event.title}
        </p>

        {event.detail ? (
          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {event.detail}
          </p>
        ) : null}

        <p className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
          <span
            className={`font-semibold ${
              event.agent === 'support_sales'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-sky-600 dark:text-sky-400'
            }`}
          >
            {event.agent === 'support_sales' ? 'Agent 1' : 'Agent 2'}
          </span>
          {chatName ? <span className="truncate">· {chatName}</span> : null}
          <span className="ml-auto shrink-0">{formatTime(event.created_at)}</span>
        </p>
      </div>
    </li>
  );
}

function visualsFor(eventType: AgentEventType): {
  icon: typeof Headphones;
  tone: string;
} {
  switch (eventType) {
    case 'started':
      return { icon: Zap, tone: 'text-sky-500' };
    case 'thinking':
      return { icon: LoaderCircle, tone: 'text-sky-500' };
    case 'sent':
      return { icon: Send, tone: 'text-emerald-600 dark:text-emerald-400' };
    case 'order_placed':
      return {
        icon: ShoppingCart,
        tone: 'text-emerald-600 dark:text-emerald-400',
      };
    case 'order_failed':
      return { icon: CircleX, tone: 'text-red-600 dark:text-red-400' };
    case 'alert':
    case 'error':
      return { icon: TriangleAlert, tone: 'text-red-600 dark:text-red-400' };
    case 'skipped':
      return { icon: CircleSlash, tone: 'text-zinc-400' };
    default:
      return { icon: CircleCheckBig, tone: 'text-zinc-400' };
  }
}

function statusOf(
  latest: AgentEventRow | undefined,
  now: number | null,
): AgentStatus {
  if (!latest) return 'idle';
  if (PROBLEM_TYPES.includes(latest.event_type)) return 'attention';

  // `now` is null during SSR and on the very first client render, which keeps
  // both renders identical (idle) and avoids a hydration mismatch.
  if (
    now !== null &&
    WORKING_TYPES.includes(latest.event_type) &&
    now - Date.parse(latest.created_at) < WORKING_WINDOW_MS
  ) {
    return 'working';
  }

  return 'idle';
}

/**
 * A ticking clock for the "Working" window.
 *
 * Read through useSyncExternalStore rather than useEffect + setState: a bare
 * `Date.now()` during render differs between the server and the browser and
 * trips a hydration error, and the effect-based version re-renders on mount for
 * no reason. React calls this hook's server snapshot on both the server and
 * during hydration, so the two always agree, and swaps in the real clock only
 * once the component is live.
 *
 * The snapshot is quantised to the tick and memoised because React compares
 * getSnapshot() results by identity — returning a fresh Date.now() on every call
 * would re-render forever.
 */
const CLOCK_TICK_MS = 5_000;
let clockBucket = 0;

function subscribeToClock(onChange: () => void): () => void {
  const timer = setInterval(onChange, CLOCK_TICK_MS);
  return () => clearInterval(timer);
}

function getClockSnapshot(): number {
  const bucket = Math.floor(Date.now() / CLOCK_TICK_MS) * CLOCK_TICK_MS;
  if (bucket !== clockBucket) clockBucket = bucket;
  return clockBucket;
}

/** The server has no clock to report, and "unknown" must render as idle. */
function getServerClockSnapshot(): null {
  return null;
}

function useNow(): number | null {
  return useSyncExternalStore<number | null>(
    subscribeToClock,
    getClockSnapshot,
    getServerClockSnapshot,
  );
}
