import { sendMetaMessage } from '@/lib/meta/graph';
import { getAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/messages/send
 *
 * Sends a manual reply from the dashboard to a customer via the Meta Graph API
 * and records it in `messages` as `human_admin`.
 *
 * Body: { chat_id: string, content: string }
 * Header: x-admin-key: <ADMIN_API_KEY>
 *
 * Note this works regardless of `bot_active` — the admin can always take over.
 * The dashboard does not use this route: it calls the sendAdminReply Server
 * Action instead, so ADMIN_API_KEY never reaches the browser. This endpoint is
 * kept for external or scripted use.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { chat_id?: unknown; content?: unknown };
  try {
    body = (await request.json()) as { chat_id?: unknown; content?: unknown };
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const chatId = typeof body.chat_id === 'string' ? body.chat_id.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';

  if (!chatId || !content) {
    return Response.json(
      { error: 'Both "chat_id" and "content" are required' },
      { status: 400 },
    );
  }

  const supabase = getAdminClient();

  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id, platform, customer_id')
    .eq('id', chatId)
    .single();

  if (chatError || !chat) {
    return Response.json({ error: 'Chat not found' }, { status: 404 });
  }

  let graphResult: { messageId: string | null };
  try {
    graphResult = await sendMetaMessage({
      platform: chat.platform,
      recipientId: chat.customer_id,
      text: content,
    });
  } catch (error) {
    // 502: we are fine, the upstream Graph API rejected us. The most common
    // cause is being outside Meta's 24-hour messaging window.
    return Response.json(
      { error: error instanceof Error ? error.message : 'Meta send failed' },
      { status: 502 },
    );
  }

  // Storing Meta's returned message id means the webhook echo of this same
  // message can never be inserted a second time.
  const { data: message, error: insertError } = await supabase
    .from('messages')
    .insert({
      chat_id: chat.id,
      sender_role: 'human_admin',
      content,
      external_message_id: graphResult.messageId,
    })
    .select()
    .single();

  if (insertError) {
    // The customer already received the message, so report the partial success
    // rather than pretending the whole operation failed.
    return Response.json(
      {
        error: `Message sent to Meta but not saved: ${insertError.message}`,
        delivered: true,
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, message });
}

/**
 * Fails CLOSED: if ADMIN_API_KEY is unset, every request is rejected. That way
 * a misconfigured deployment exposes an unreachable endpoint rather than an
 * open one that can message your customers.
 */
function isAuthorized(request: Request): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;

  return request.headers.get('x-admin-key') === expected;
}
