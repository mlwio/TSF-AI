'use client';

import { Pause, Play } from 'lucide-react';

/**
 * The Human-in-the-Loop control.
 *
 * `bot_active` is the single switch the whole system obeys: Agent 1 checks it
 * before generating and again immediately before sending, and the webhook
 * refuses to wake the agent at all when it is false. Turning it off hands the
 * conversation to you; the bot will not speak again until you turn it back on.
 */
export function BotToggle({
  botActive,
  pending,
  onToggle,
}: {
  botActive: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
          botActive
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            botActive ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
          aria-hidden
        />
        {botActive ? 'AI is replying' : 'AI paused'}
      </span>

      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
          botActive
            ? 'bg-amber-600 hover:bg-amber-700'
            : 'bg-emerald-600 hover:bg-emerald-700'
        }`}
      >
        {botActive ? (
          <Pause className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden />
        )}
        {botActive ? 'Pause AI' : 'Resume AI'}
      </button>
    </div>
  );
}
