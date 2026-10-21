/**
 * Subset of the Meta webhook payload that this app actually consumes.
 *
 * Messenger and Instagram DM webhooks share this shape; they differ only by the
 * top-level `object` value. Unhandled keys (delivery, read, reaction, referral,
 * standby, ...) are intentionally omitted rather than typed as `unknown`.
 */
export interface MetaWebhookPayload {
  /** 'page' = Messenger, 'instagram' = Instagram Direct. */
  object: 'page' | 'instagram' | string;
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  /** Page id or Instagram account id. */
  id: string;
  time: number;
  messaging?: MetaMessagingEvent[];
}

export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  /** Absent on delivery/read/postback/reaction events. */
  message?: MetaInboundMessage;
  postback?: { title?: string; payload?: string };
}

export interface MetaInboundMessage {
  /** Meta's globally unique message id. Used for idempotency. */
  mid: string;
  text?: string;
  /** True when this is YOUR OWN outgoing message being echoed back to you. */
  is_echo?: boolean;
  attachments?: Array<{
    type?: string;
    payload?: { url?: string };
  }>;
}
