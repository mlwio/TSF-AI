'use server';

import { cookies } from 'next/headers';

import { DASHBOARD_SESSION_COOKIE, isValidSessionToken } from '@/lib/auth';
import { listChats, listMessages } from '@/lib/dashboard/queries';
import type { ChatListItem, ChatThread } from '@/lib/dashboard/types';
import { sendMetaMessage } from '@/lib/meta/graph';
import { getAdminClient } from '@/lib/supabase/admin';
import type { MessageRow } from '@/types/database';

/**
 * Every dashboard read AND write happens here, on the server, with the
 * service_role key. The browser never receives a key at all — not to read the
 * database, and certainly not to send messages to customers.
 *
 * SECURITY: Server Actions are plain POST endpoints. The Proxy blocks
 * unauthenticated page loads, but a matcher change can silently drop that
 * coverage, so every action below re-checks the session cookie itself and
 * fails closed if ADMIN_API_KEY is missing.
 */

/** Meta rejects text bodies longer than this for Messenger/Instagram DMs. */
const MAX_MESSAGE_LENGTH = 2000;

const NO_SESSION_ERROR = 'Your session expired. Reload the page and sign in again.';

/** Returns an error result when the caller is not signed in, otherwise null. */
async function rejectIfNotSignedIn(): Promise<{ ok: false; error: string } | null> {
  const store = await cookies();
  const token = store.get(DASHBOARD_SESSION_COOKIE)?.value;

  return isValidSessionToken(token) ? null : { ok: false, error: NO_SESSION_ERROR };
}

export type SendReplyResult =
  | { ok: true; message: MessageRow; botPaused: boolean }
  | { ok: false; error: string };

export async function sendAdminReply(input: {
  chatId: string;
  content: string;
}): Promise<SendReplyResult> {
  const denied = await rejectIfNotSignedIn();
  if (denied) return denied;

  const chatId = typeof input?.chatId === 'string' ? input.chatId : '';
  const content = typeof input?.content === 'string' ? input.content.trim() : '';

  if (!chatId || !content) {
    return { ok: false, error: 'Message cannot be empty.' };
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Message is too long for Meta (${content.length}/${MAX_MESSAGE_LENGTH} characters).`,
    };
  }

  const supabase = getAdminClient();

  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id, platform, customer_id')
    .eq('id', chatId)
    .single();

  if (chatError || !chat) {
    return { ok: false, error: 'Conversation not found.' };
  }

  let messageId: string | null;
  try {
    const sent = await sendMetaMessage({
      platform: chat.platform,
      recipientId: chat.customer_id,
      text: content,
    });
    messageId = sent.messageId;
  } catch (error) {
    // The customer never saw it, so nothing is recorded. The usual cause is
    // being outside Meta's 24-hour customer service window.
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Meta rejected the message.',
    };
  }

  // Storing Meta's returned id means the webhook echo of this message can never
  // be inserted a second time as a `user` message.
  const { data: message, error: insertError } = await supabase
    .from('messages')
    .insert({
      chat_id: chat.id,
      sender_role: 'human_admin',
      content,
      external_message_id: messageId,
    })
    .select()
    .single();

  if (insertError || !message) {
    // Delivered but not saved — say so rather than implying total failure, or
    // the admin will send it again and the customer will get it twice.
    return {
      ok: false,
      error: `Delivered to the customer, but saving it here failed: ${
        insertError?.message ?? 'unknown error'
      }`,
    };
  }

  // Stepping in by hand pauses the AI for this conversation, so Gemini cannot
  // talk over you on the customer's next message. You resume it with the
  // Toggle AI control when you are done.
  const { error: pauseError } = await supabase
    .from('chats')
    .update({ bot_active: false })
    .eq('id', chat.id);

  return { ok: true, message, botPaused: !pauseError };
}

export async function setBotActive(input: {
  chatId: string;
  botActive: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = await rejectIfNotSignedIn();
  if (denied) return denied;

  const chatId = typeof input?.chatId === 'string' ? input.chatId : '';

  if (!chatId || typeof input?.botActive !== 'boolean') {
    return { ok: false, error: 'Invalid request.' };
  }

  const { error } = await getAdminClient()
    .from('chats')
    .update({ bot_active: input.botActive })
    .eq('id', chatId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function loadChatMessages(
  chatId: string,
): Promise<{ ok: true; messages: MessageRow[] } | { ok: false; error: string }> {
  const denied = await rejectIfNotSignedIn();
  if (denied) return denied;

  if (typeof chatId !== 'string' || !chatId) {
    return { ok: false, error: 'Invalid conversation.' };
  }

  try {
    return { ok: true, messages: await listMessages(chatId) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not load messages.',
    };
  }
}

export type DashboardSnapshotResult =
  | { ok: true; chats: ChatListItem[]; thread: ChatThread | null }
  | { ok: false; error: string };

/**
 * One poll of the dashboard's live feed.
 *
 * Replaces the Supabase Realtime subscription: the same freshness, but the read
 * happens here with the service_role key instead of in the browser with a
 * publicly readable table and the anon key in the bundle.
 *
 * `newestMessageAt` is what the client already has on screen. When it matches
 * the chat's real newest message the thread is omitted, so a quiet conversation
 * costs one list query per poll instead of re-shipping 200 messages.
 */
export async function loadDashboardSnapshot(input: {
  chatId: string | null;
  newestMessageAt: string | null;
}): Promise<DashboardSnapshotResult> {
  const denied = await rejectIfNotSignedIn();
  if (denied) return denied;

  try {
    const chats = await listChats();

    const chatId =
      typeof input?.chatId === 'string' && input.chatId ? input.chatId : null;

    if (!chatId) return { ok: true, chats, thread: null };

    const chat = chats.find((candidate) => candidate.id === chatId);

    // The chat is gone (or was never visible) — nothing to open.
    if (!chat) return { ok: true, chats, thread: null };

    const known =
      typeof input?.newestMessageAt === 'string' ? input.newestMessageAt : null;

    if ((chat.last_message_at ?? null) === known) {
      return { ok: true, chats, thread: null };
    }

    return {
      ok: true,
      chats,
      thread: { chatId, messages: await listMessages(chatId) },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Could not refresh the inbox.',
    };
  }
}
