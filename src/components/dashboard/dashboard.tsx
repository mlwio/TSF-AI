'use client';

import { useEffect, useState } from 'react';

import { loadChatMessages, sendAdminReply, setBotActive } from '@/app/actions';
import { logoutAction } from '@/app/login/actions';
import { AgentActivityPanel } from '@/components/dashboard/agent-activity-panel';
import { ChatList } from '@/components/dashboard/chat-list';
import { ChatThread } from '@/components/dashboard/chat-thread';
import { useDashboardPolling } from '@/hooks/use-dashboard-polling';
import { sortChats, type ChatListItem, type LiveStatus } from '@/lib/dashboard/types';
import type { AgentEventRow, MessageRow } from '@/types/database';

/**
 * The thread is stored together with the chat it belongs to, so "which
 * messages are on screen" is derived rather than reset: switching conversation
 * shows the loading state on its own, and a late fetch can never paint one
 * chat's history into another chat's window.
 */
interface LoadedThread {
  chatId: string;
  messages: MessageRow[];
}

/**
 * The whole human-in-the-loop surface.
 *
 * Server-rendered once with the initial conversation list, then kept current by
 * polling a Server Action every few seconds (see use-dashboard-polling). That
 * replaced a Supabase Realtime subscription on purpose: Realtime needs the
 * table to be readable by the `anon` role, which meant the public key sat in
 * the browser bundle and the whole database was exposed. Polling reads with the
 * service_role key on the server and ships nothing but rows the signed-in
 * operator is allowed to see.
 */
export function Dashboard({
  initialChats,
  initialEvents,
}: {
  initialChats: ChatListItem[];
  initialEvents: AgentEventRow[];
}) {
  const [chats, setChats] = useState(initialChats);
  const [events, setEvents] = useState(initialEvents);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    initialChats[0]?.id ?? null,
  );
  const [loaded, setLoaded] = useState<LoadedThread | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [togglingBot, setTogglingBot] = useState(false);

  // A poll only ever returns messages that changed, so the back catalogue of a
  // conversation still has to be fetched every time you switch to it.
  useEffect(() => {
    if (!activeChatId) return;

    let cancelled = false;

    void (async () => {
      const result = await loadChatMessages(activeChatId);
      if (cancelled) return;

      if (result.ok) {
        setLoaded({ chatId: activeChatId, messages: result.messages });
      } else {
        setLoaded({ chatId: activeChatId, messages: [] });
        setError(result.error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const messages = loaded?.chatId === activeChatId ? loaded.messages : [];
  const loadingThread = activeChatId !== null && loaded?.chatId !== activeChatId;
  const newestMessageAt = messages.at(-1)?.created_at ?? null;

  useDashboardPolling({
    activeChatId,
    newestMessageAt,

    onSnapshot: (snapshot) => {
      // The server sends the list already sorted by recency, so it replaces the
      // local one outright — there is no partial payload to merge any more.
      setChats(snapshot.chats);
      setEvents(snapshot.events);

      // A snapshot can land after you have switched conversation; never paint
      // one chat's history into another chat's window.
      if (snapshot.thread && snapshot.thread.chatId === activeChatId) {
        setLoaded({
          chatId: snapshot.thread.chatId,
          messages: snapshot.thread.messages,
        });
      }
    },

    onStatusChange: setStatus,
  });

  async function handleSend(content: string): Promise<boolean> {
    if (!activeChatId) return false;

    const result = await sendAdminReply({ chatId: activeChatId, content });

    if (!result.ok) {
      setError(result.error);
      return false;
    }

    const { message, botPaused } = result;
    const chatId = message.chat_id;

    setLoaded((previous) =>
      previous?.messages.some((existing) => existing.id === message.id)
        ? previous
        : {
            chatId,
            messages: [...(previous?.messages ?? []), message],
          },
    );
    // Replying by hand pauses the AI server-side; mirror that here so the
    // Toggle AI control is honest before the next poll arrives.
    setChats((previous) =>
      sortChats(
        previous.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                bot_active: botPaused ? false : chat.bot_active,
                last_message: message.content,
                last_message_at: message.created_at,
              }
            : chat,
        ),
      ),
    );

    setError(
      botPaused
        ? null
        : 'Reply delivered, but the AI could not be paused. Turn it off manually before the customer writes back.',
    );

    return true;
  }

  async function handleToggleBot() {
    if (!activeChat || togglingBot) return;

    const previousValue = activeChat.bot_active;
    const nextValue = !previousValue;

    // Optimistic: this control has to feel instant. The next poll confirms the
    // write from the database, and we roll back if it fails.
    setChats((previous) =>
      previous.map((chat) =>
        chat.id === activeChat.id ? { ...chat, bot_active: nextValue } : chat,
      ),
    );
    setTogglingBot(true);
    setError(null);

    const result = await setBotActive({
      chatId: activeChat.id,
      botActive: nextValue,
    });

    setTogglingBot(false);

    if (!result.ok) {
      setChats((previous) =>
        previous.map((chat) =>
          chat.id === activeChat.id
            ? { ...chat, bot_active: previousValue }
            : chat,
        ),
      );
      setError(result.error);
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          TSF Admin Panel
        </h1>

        <div className="flex items-center gap-4">
          <span
            className={`flex items-center gap-1.5 text-xs font-medium ${
              status === 'live'
                ? 'text-emerald-600 dark:text-emerald-400'
                : status === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === 'live'
                  ? 'bg-emerald-500'
                  : status === 'error'
                    ? 'bg-red-500'
                    : 'bg-zinc-400'
              }`}
              aria-hidden
            />
            {status === 'live'
              ? 'Live'
              : status === 'error'
                ? 'Disconnected'
                : 'Connecting...'}
          </span>

          <form action={logoutAction}>
            <button
              type="submit"
              className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-4 border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          <span className="break-words">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {status === 'error' ? (
        <div
          role="alert"
          className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          Live updates are paused, so this view may be out of date. It retries on
          its own — if it stays like this, reload the page and sign in again.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex max-h-[40vh] shrink-0 flex-col overflow-hidden border-b border-zinc-200 bg-white lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r xl:w-80 dark:border-zinc-800 dark:bg-zinc-900">
          <ChatList
            chats={chats}
            activeChatId={activeChatId}
            onSelect={setActiveChatId}
          />
        </aside>

        {activeChat ? (
          <ChatThread
            chat={activeChat}
            messages={messages}
            loading={loadingThread}
            togglingBot={togglingBot}
            onToggleBot={() => void handleToggleBot()}
            onSend={handleSend}
          />
        ) : (
          <section className="flex min-h-0 flex-1 items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-950">
            <p className="max-w-sm text-center text-sm text-zinc-500 dark:text-zinc-400">
              No conversations yet. As soon as a customer messages your Facebook
              Page or Instagram account, their conversation appears here.
            </p>
          </section>
        )}

        <AgentActivityPanel
          events={events}
          chats={chats}
          activeChatId={activeChatId}
        />
      </div>
    </div>
  );
}
