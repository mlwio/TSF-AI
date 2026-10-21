'use client';

import { MessageCircle } from 'lucide-react';

import { formatDate } from '@/lib/dashboard/format';
import {
  chatDisplayName,
  platformLabel,
  type ChatListItem,
} from '@/lib/dashboard/types';

export function ChatList({
  chats,
  activeChatId,
  onSelect,
}: {
  chats: ChatListItem[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
}) {
  if (chats.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No conversations yet.
      </p>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto">
      {chats.map((chat) => {
        const isActive = chat.id === activeChatId;

        return (
          <li key={chat.id}>
            <button
              type="button"
              onClick={() => onSelect(chat.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`flex w-full flex-col gap-1 border-l-2 px-4 py-3 text-left transition-colors ${
                isActive
                  ? 'border-l-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                  : 'border-l-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {chatDisplayName(chat)}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-400">
                  {formatDate(chat.last_message_at ?? chat.updated_at)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {chat.last_message ?? 'No messages yet'}
                </span>

                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    chat.bot_active
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                  }`}
                >
                  {chat.bot_active ? 'AI' : 'PAUSED'}
                </span>
              </div>

              <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                <MessageCircle className="h-3 w-3" aria-hidden />
                {platformLabel(chat.platform)}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
