import { sortChats, type ChatListItem } from '@/lib/dashboard/types';
import { getAdminClient } from '@/lib/supabase/admin';
import type { AgentEventRow, MessageRow } from '@/types/database';

/** Messages loaded when a conversation is opened. */
const THREAD_LIMIT = 200;

/**
 * Agent events loaded into the activity feed.
 *
 * Small on purpose: the feed is a rolling "what is happening right now" panel,
 * not an audit log, and it is re-sent on every 3-second poll.
 */
const AGENT_EVENT_LIMIT = 60;

/**
 * How many of the newest messages are scanned to build each conversation's
 * preview line.
 *
 * The provided schema declares no relationship metadata, so PostgREST embeds
 * (`messages(...)` inside a chats select) are not type-safe here, and one query
 * per chat would mean N round-trips. Instead we pull one window of recent
 * messages and reduce it in memory. Because the list is sorted by recency, the
 * preview is accurate for every conversation that is actually active; a chat
 * untouched for longer than this window simply shows no preview.
 */
const PREVIEW_SCAN_LIMIT = 1000;

export async function listChats(): Promise<ChatListItem[]> {
  const supabase = getAdminClient();

  const { data: chats, error: chatsError } = await supabase
    .from('chats')
    .select('id, platform, customer_id, customer_name, bot_active, updated_at');

  if (chatsError) throw chatsError;
  if (!chats || chats.length === 0) return [];

  const { data: recent, error: messagesError } = await supabase
    .from('messages')
    .select('chat_id, content, created_at')
    .in(
      'chat_id',
      chats.map((chat) => chat.id),
    )
    .order('created_at', { ascending: false })
    .limit(PREVIEW_SCAN_LIMIT);

  if (messagesError) throw messagesError;

  // Newest first, so the first row seen for a chat is its latest message.
  const latestByChat = new Map<string, { content: string; created_at: string }>();
  for (const message of recent ?? []) {
    if (!latestByChat.has(message.chat_id)) {
      latestByChat.set(message.chat_id, {
        content: message.content,
        created_at: message.created_at,
      });
    }
  }

  return sortChats(
    chats.map((chat) => {
      const latest = latestByChat.get(chat.id);

      return {
        ...chat,
        last_message: latest?.content ?? null,
        last_message_at: latest?.created_at ?? null,
      };
    }),
  );
}

export async function listMessages(chatId: string): Promise<MessageRow[]> {
  const { data, error } = await getAdminClient()
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    // Newest first so the LIMIT keeps the tail of a long conversation...
    .order('created_at', { ascending: false })
    .limit(THREAD_LIMIT);

  if (error) throw error;

  // ...then flipped back into reading order for the UI.
  return (data ?? []).reverse();
}

/**
 * The newest agent events across every conversation, newest first.
 *
 * Deliberately global rather than scoped to the open chat: the panel answers
 * "what are my two agents doing right now", which spans all conversations. The
 * caller resolves `chat_id` to a readable customer name from the chat list it
 * has already fetched, so no join is needed here.
 *
 * A missing `agent_events` table (the migration has not been applied yet)
 * returns an empty feed instead of throwing. Telemetry is not the critical
 * path: the inbox, the AI replies and the orders all have to keep working for a
 * store owner who has not run supabase/migrations/20261022000000_agent_events.sql
 * yet, so the failure is logged rather than turned into a dead dashboard.
 */
export async function listAgentEvents(): Promise<AgentEventRow[]> {
  const { data, error } = await getAdminClient()
    .from('agent_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(AGENT_EVENT_LIMIT);

  if (error) {
    console.error('[dashboard] agent activity feed unavailable', { error });
    return [];
  }

  return data ?? [];
}
