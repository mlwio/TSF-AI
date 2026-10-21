'use client';

import { useEffect, useRef } from 'react';

import { BotToggle } from '@/components/dashboard/bot-toggle';
import { Composer } from '@/components/dashboard/composer';
import { MessageBubble } from '@/components/dashboard/message-bubble';
import {
  chatDisplayName,
  platformLabel,
  type ChatListItem,
} from '@/lib/dashboard/types';
import type { MessageRow } from '@/types/database';

export function ChatThread({
  chat,
  messages,
  loading,
  togglingBot,
  onToggleBot,
  onSend,
}: {
  chat: ChatListItem;
  messages: MessageRow[];
  loading: boolean;
  togglingBot: boolean;
  onToggleBot: () => void;
  onSend: (content: string) => Promise<boolean>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Jump to the newest message when the conversation changes or one arrives.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.id, messages.length]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {chatDisplayName(chat)}
          </h2>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {platformLabel(chat.platform)} · ID {chat.customer_id}
          </p>
        </div>

        <BotToggle
          botActive={chat.bot_active}
          pending={togglingBot}
          onToggle={onToggleBot}
        />
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Loading messages...
          </p>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No messages in this conversation yet.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <Composer onSend={onSend} />
    </section>
  );
}
