import { formatTime } from '@/lib/dashboard/format';
import type { MessageRow } from '@/types/database';

/**
 * One chat bubble. `sender_role` drives everything: the customer sits on the
 * left, everything the store says sits on the right — with the bot and the
 * human visually distinct so you can tell at a glance who answered.
 */
export function MessageBubble({ message }: { message: MessageRow }) {
  const isCustomer = message.sender_role === 'user';
  const isBot = message.sender_role === 'bot';

  const bubble = isCustomer
    ? 'rounded-bl-sm border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
    : isBot
      ? 'rounded-br-sm bg-emerald-600 text-white'
      : 'rounded-br-sm bg-sky-600 text-white';

  return (
    <div className={isCustomer ? 'flex justify-start' : 'flex justify-end'}>
      <div className="flex max-w-[80%] flex-col">
        <span
          className={`mb-1 px-1 text-[11px] font-medium ${
            isCustomer
              ? 'text-zinc-500 dark:text-zinc-400'
              : isBot
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-sky-600 dark:text-sky-400'
          } ${isCustomer ? '' : 'text-right'}`}
        >
          {isCustomer ? 'Customer' : isBot ? 'AI assistant' : 'You'}
        </span>

        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${bubble}`}
        >
          {message.content}
        </div>

        <span
          className={`mt-1 px-1 text-[10px] text-zinc-400 ${isCustomer ? '' : 'text-right'}`}
        >
          {formatTime(message.created_at)}
        </span>
      </div>
    </div>
  );
}
