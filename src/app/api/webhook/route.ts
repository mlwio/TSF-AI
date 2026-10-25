import { after } from 'next/server';

import { runSupportAgent } from '@/lib/ai/agent1-support';
import { requireEnv } from '@/lib/env';
import { verifyMetaSignature } from '@/lib/meta/verify';
import type {
  MetaInboundMessage,
  MetaMessagingEvent,
  MetaWebhookPayload,
} from '@/lib/meta/types';
import { getAdminClient } from '@/lib/supabase/admin';
import type { Platform } from '@/types/database';

/**
 * Meta sends every webhook to this one URL, for both Messenger and Instagram.
 * Which product it belongs to is decided by the top-level `object` field.
 */
const PLATFORM_BY_OBJECT: Record<string, Platform | undefined> = {
  page: 'messenger',
  instagram: 'instagram',
};

/**
 * Agent 1 runs inside after(), which is still billed against this function's
 * execution budget — a multi-step Gemini loop plus the Meta round-trip easily
 * outlives the platform default and would be killed mid-reply.
 */
export const maxDuration = 60;

/**
 * GET — Meta's webhook verification handshake.
 *
 * You paste META_VERIFY_TOKEN into the Meta dashboard; Meta calls this URL with
 * hub.mode=subscribe and expects the hub.challenge value echoed back as plain
 * text. Any other value, or a wrong token, must NOT return the challenge.
 *
 * Note: Next 16 removed `export const dynamic` (Cache Components is enabled),
 * so this handler stays request-time-evaluated by reading `request.url` — which
 * the docs list as a request-time API that stops prerendering.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (
    mode === 'subscribe' &&
    token !== null &&
    token === requireEnv('META_VERIFY_TOKEN')
  ) {
    return new Response(challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response('Forbidden', { status: 403 });
}

/**
 * POST — inbound customer messages, delivery receipts, echoes, ...
 *
 * Flow: verify signature -> parse -> persist -> ACK 200.
 *
 * The signature is checked against the RAW body, so `request.text()` must run
 * before any JSON parsing.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  const signatureValid = verifyMetaSignature({
    rawBody,
    signatureHeader: request.headers.get('x-hub-signature-256'),
    appSecret: requireEnv('META_APP_SECRET'),
  });

  if (!signatureValid) {
    // 401 (not 200) is deliberate: an unsigned request is not from Meta.
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const platform = PLATFORM_BY_OBJECT[payload.object] ?? 'messenger';

  // Failures are logged rather than thrown. Meta redelivers any non-200
  // response, and a retry storm of duplicate deliveries is worse than one
  // dropped message — real errors still surface in the Vercel function logs.
  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      try {
        await persistInboundMessage(platform, event);
      } catch (error) {
        console.error('[webhook] failed to persist event', {
          platform,
          event,
          error,
        });
      }
    }
  }

  // Meta only requires a 200. This literal body is Meta's own convention.
  return new Response('EVENT_RECEIVED', { status: 200 });
}

/**
 * Stores one inbound message and returns true when it was newly inserted.
 *
 * Returns false for events we deliberately ignore (receipts, echoes, redelivered
 * duplicates) — the caller uses that to decide whether to trigger the AI agent.
 */
async function persistInboundMessage(
  platform: Platform,
  event: MetaMessagingEvent,
): Promise<boolean> {
  const message = event.message;

  // No `message` key => delivery/read receipt/postback/reaction. Skip.
  // is_echo => our own outgoing message bouncing back. Skip, or we would
  // store every reply twice and re-trigger the agent.
  if (!message || message.is_echo) return false;

  const customerId = event.sender?.id;
  if (!customerId) return false;

  const supabase = getAdminClient();

  // 1. Ensure a chat row exists.
  //
  // ignoreDuplicates sends ON CONFLICT DO NOTHING, which is critical: a plain
  // upsert would SET bot_active = true on every incoming message and would
  // silently undo the human's "Pause AI" toggle. This way an existing chat is
  // never modified here.
  const { error: upsertChatError } = await supabase.from('chats').upsert(
    {
      platform,
      customer_id: customerId,
      customer_name: null,
      bot_active: true,
    },
    { onConflict: 'platform,customer_id', ignoreDuplicates: true },
  );

  if (upsertChatError) throw upsertChatError;

  // 2. Read it back (the upsert above returns nothing when the row already
  //    existed, so a separate select is required).
  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id, bot_active')
    .eq('platform', platform)
    .eq('customer_id', customerId)
    .single();

  if (chatError || !chat) {
    throw chatError ?? new Error('Chat row missing immediately after upsert');
  }

  // 3. Insert the message. external_message_id is UNIQUE, so a Meta redelivery
  //    of the same mid collapses into a no-op instead of a duplicate bubble.
  const { data: inserted, error: insertError } = await supabase
    .from('messages')
    .upsert(
      {
        chat_id: chat.id,
        sender_role: 'user',
        content: describeInboundContent(message),
        external_message_id: message.mid,
      },
      { onConflict: 'external_message_id', ignoreDuplicates: true },
    )
    .select('id');

  if (insertError) throw insertError;

  const wasInserted = (inserted?.length ?? 0) > 0;

  // ---- Step 4: hand off to Agent 1 ----
  //
  // Deferred with after() so Meta receives its 200 immediately. Meta redelivers
  // anything it considers slow or failed, and a retry storm of duplicate
  // deliveries is far worse than a reply that arrives a couple of seconds late.
  //
  // `wasInserted` guards against redelivered webhooks re-triggering the agent;
  // `bot_active` guards against the bot talking over a human who took over.
  if (wasInserted && chat.bot_active) {
    after(() => runSupportAgent({ chatId: chat.id }));
  }

  return wasInserted;
}

/**
 * Meta sends no text at all for image/audio/file messages, so give the admin
 * something readable (and a link they can click) instead of an empty bubble.
 */
function describeInboundContent(message: MetaInboundMessage): string {
  if (message.text) return message.text;

  const attachment = message.attachments?.[0];
  if (attachment) {
    const type = attachment.type ?? 'attachment';
    const url = attachment.payload?.url;

    return url ? `[${type}] ${url}` : `[${type}]`;
  }

  return '[unsupported message]';
}
