import type { MessageRow, Platform } from '@/types/database';

/**
 * A row of the dashboard's left-hand conversation list.
 *
 * The extra `last_message*` fields are derived, not columns: they are computed
 * server-side on every poll by src/lib/dashboard/queries.ts.
 */
export interface ChatListItem {
  id: string;
  platform: Platform;
  customer_id: string;
  customer_name: string | null;
  bot_active: boolean;
  updated_at: string;
  last_message: string | null;
  last_message_at: string | null;
}

/** One conversation's history, tagged with the chat it belongs to. */
export interface ChatThread {
  chatId: string;
  messages: MessageRow[];
}

/**
 * Everything one poll returns. `thread` is null when the open conversation has
 * not changed since the client's last snapshot, so an idle dashboard never
 * re-sends 200 messages for nothing.
 */
export interface DashboardSnapshot {
  chats: ChatListItem[];
  thread: ChatThread | null;
}

/**
 * Freshness of the dashboard's live feed, shown in the header. Without it there
 * is no way to tell a quiet inbox from a server that stopped responding, so it
 * is surfaced rather than hidden behind a spinner.
 */
export type LiveStatus = 'connecting' | 'live' | 'error';

export function chatDisplayName(chat: {
  customer_name: string | null;
  customer_id: string;
  platform: Platform;
}): string {
  if (chat.customer_name) return chat.customer_name;

  // Meta sends no profile data on the webhook itself, so until agent2 backfills
  // the name from a placed order the platform id is all we have.
  return `${platformLabel(chat.platform)} user ${chat.customer_id.slice(-6)}`;
}

export function platformLabel(platform: Platform): string {
  return platform === 'instagram' ? 'Instagram' : 'Messenger';
}

/** Newest conversation first, falling back to when the chat row last changed. */
export function sortChats(chats: ChatListItem[]): ChatListItem[] {
  return [...chats].sort((a, b) => {
    const aTime = a.last_message_at ?? a.updated_at;
    const bTime = b.last_message_at ?? b.updated_at;

    if (aTime === bTime) return 0;
    return aTime < bTime ? 1 : -1;
  });
}
