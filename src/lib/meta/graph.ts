import { requireEnv } from '@/lib/env';
import type { Platform } from '@/types/database';

/** Pinned so a Meta-side default change can never silently break sends. */
const DEFAULT_GRAPH_VERSION = 'v23.0';

function graphVersion(): string {
  return process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
}

/**
 * Instagram DMs are sent with the Instagram-scoped token; Messenger with the
 * Page token. Falls back to the Page token, which also works for Instagram when
 * the IG account is linked to the Page.
 */
function accessTokenFor(platform: Platform): string {
  if (platform === 'instagram') {
    return process.env.META_IG_ACCESS_TOKEN || requireEnv('META_PAGE_ACCESS_TOKEN');
  }

  return requireEnv('META_PAGE_ACCESS_TOKEN');
}

export interface SendMetaMessageResult {
  /** Meta's id for the message we just sent, or null if it was not returned. */
  messageId: string | null;
  recipientId: string | null;
}

/**
 * Sends a plain-text message to a customer via the Meta Graph API.
 *
 * `messaging_type: 'RESPONSE'` is required when replying to a customer and is
 * only valid inside Meta's 24-hour customer service window. Outside that window
 * the Graph API rejects the call (error code 10 / 2018278) unless you use a
 * message tag or a paid template — surfaced here as a thrown Error.
 */
export async function sendMetaMessage(params: {
  platform: Platform;
  recipientId: string;
  text: string;
}): Promise<SendMetaMessageResult> {
  const { platform, recipientId, text } = params;

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion()}/me/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessTokenFor(platform)}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        text,
      }),
      // Never let Next.js cache a POST.
      cache: 'no-store',
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | { message_id?: string; recipient_id?: string; error?: unknown }
    | null;

  if (!response.ok) {
    throw new Error(
      `Meta Graph API send failed (HTTP ${response.status}): ${JSON.stringify(payload)}`,
    );
  }

  return {
    messageId: payload?.message_id ?? null,
    recipientId: payload?.recipient_id ?? null,
  };
}
