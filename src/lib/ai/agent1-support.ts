import { google } from '@ai-sdk/google';
import { generateText, isStepCount, type ModelMessage } from 'ai';

import { createPlaceOrderTool } from '@/lib/ai/tools';
import { recordAgentEvent, truncateDetail } from '@/lib/ai/agent-events';
import { sendMetaMessage } from '@/lib/meta/graph';
import { getAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from '@/lib/telegram';
import type { MessageRow } from '@/types/database';

/**
 * AGENT 1 — Customer Support & Sales.
 *
 * Triggered by the webhook whenever a genuinely new inbound customer message
 * arrives on a chat whose `bot_active` flag is still true. Its single job is to
 * produce one reply and send it back through the Meta Graph API.
 *
 * Runs inside after(), i.e. AFTER Meta has already been sent its 200, so slow
 * model calls never cause a webhook timeout/retry. That also means nothing is
 * awaited for us — every failure has to be caught and logged in here.
 */

/**
 * The model Agent 1 replies with.
 *
 * Deliberately not read from an env var. GEMINI_MODEL used to override this, a
 * stale value in it pointed at a model Google had retired, and every single
 * reply failed with a 404 — while the dashboard showed a perfectly healthy
 * inbox, because a reply that failed to generate and a customer nobody answered
 * look identical from the outside. One source of truth cannot drift like that.
 *
 * Google retires flash models for new keys ("1.5-flash" and "2.5-flash" now
 * both answer 404 "no longer available to new users"), so this needs revisiting
 * occasionally. List what the key is actually served:
 *   curl "https://generativelanguage.googleapis.com/v1beta/models?key=$KEY"
 * Then confirm the SDK can still drive tool calls with it — a model can answer
 * over plain REST and still hang once `tools` are attached.
 */
const MODEL = 'gemini-3.5-flash';

/** Messages replayed to the model as conversation context. */
const HISTORY_LIMIT = 20;

/**
 * Ceiling on model/tool round-trips per incoming message. generateText defaults
 * to isStepCount(1), which would stop the loop before the model could ever react
 * to a place_order result — so this must be raised for tools to work at all.
 */
const MAX_STEPS = 5;

/**
 * ---------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH FOR BUSINESS FACTS
 * ---------------------------------------------------------------------------
 * The database has no products/catalog table, so the agent's business knowledge
 * can only live here. Every price the bot quotes comes from this block, so any
 * change to pricing, delivery or payment terms must be made here and redeployed.
 */
const STORE_CONTEXT = `
Store Name: TSF Next Gear
Product: 5 in 1 Gaming Combo
Regular Price: 1750 TK
Offer Price: 1550 TK
Absolute Lowest Price: 1500 TK (কখনোই ১৫০০ টাকার নিচে সেল করা যাবে না)
Delivery Charge: Inside Dhaka 90 TK, Outside Dhaka 150 TK
Payment Method: Full Cash on Delivery (কোনো অগ্রিম পেমেন্ট লাগবে না)
`;

const SUPPORT_AGENT_INSTRUCTIONS = `
You are a warm, persuasive female sales executive at TSF Next Gear. Your goal is to convert inquiries for the "5 in 1 Gaming Combo" into cash-on-delivery orders.

PERSONALITY
- Sweet, polite, human-like (feminine Bangla/Banglish).
- No lists/headings/robotic phrases. Max 1-2 emojis.

PRICING & DELIVERY
- Regular: 1750 TK, Offer: 1550 TK.
- BOTTOM LIMIT: 1500 TK. Never go below.
- Delivery: Inside Dhaka 90 TK, Outside 150 TK.
- Payment: 100% Cash on Delivery (No advance).

FIRST REPLY (MUST match exactly if price/details asked):
"আসসালামু আলাইকুম, TSF Next Gear-এ স্বাগতম! ✨
5 in 1 gaming combo-তে চলছে ধামাকা অফার! ১৭৫০ টাকার প্রোডাক্ট এখন পাচ্ছেন মাত্র ১৫৫০ টাকায়। 
ঢাকার ভেতরে ডেলিভারি চার্জ ৯০ টাকা, আর ঢাকার বাইরে ১৫০ টাকা। সম্পূর্ণ ক্যাশ অন ডেলিভারি, কোনো অগ্রিম টাকা দিতে হবে না!
ডেলিভারি চার্জটি কনফার্ম করার জন্য, আপনি কোন জায়গা থেকে বলছেন জানাবেন কি?"

NEGOTIATION & ORDERING
- Negotiate down to 1500 TK only if insisted.
- Collect Name, Phone, and Address (one at a time).
- Confirm the full bill before calling place_order.
- Inside Dhaka = 90 TK, anywhere else = 150 TK.

POST-ORDER
- Confirm order_id, customer name, phone, and total amount clearly.
- Never invent order IDs or facts.

STORE FACTS:
${STORE_CONTEXT}

BOUNDARIES:
- Never mention tools, AI or models. You are human.
- Anything unknown? Say a human teammate will follow up.`;

export async function runSupportAgent(params: { chatId: string }): Promise<void> {
  try {
    await replyToLatestMessage(params.chatId);
  } catch (error) {
    // Runs in after(); an unhandled rejection here would be invisible.
    const reason = error instanceof Error ? error.message : String(error);

    console.error('[agent1] support agent failed', {
      chatId: params.chatId,
      error,
    });

    await recordAgentEvent({
      agent: 'support_sales',
      eventType: 'error',
      title: 'Agent 1 কাজ শেষ করতে পারেনি',
      detail: reason,
      chatId: params.chatId,
    });

    // A broken model (a retired name, an exhausted quota, a bad key) stops
    // every reply at once, and the customer just sees silence — the owner has
    // to hear about it from somewhere other than the customers themselves.
    await alertAdminOfFailedReply(
      params.chatId,
      `the reply could not be generated — ${reason}`,
    );
  }
}

async function replyToLatestMessage(chatId: string): Promise<void> {
  const supabase = getAdminClient();

  const { data: chat, error: chatError } = await supabase
    .from('chats')
    .select('id, platform, customer_id, bot_active')
    .eq('id', chatId)
    .single();

  if (chatError || !chat) {
    throw chatError ?? new Error(`Chat ${chatId} not found`);
  }

  // The webhook already checked this, but after() runs later — the admin may
  // have taken over in the meantime. Never talk over a human.
  if (!chat.bot_active) {
    await recordAgentEvent({
      agent: 'support_sales',
      eventType: 'skipped',
      title: 'AI pause ছিল, তাই কোনো উত্তর পাঠানো হয়নি',
      chatId,
    });
    return;
  }

  const { data: history, error: historyError } = await supabase
    .from('messages')
    .select('sender_role, content, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (historyError) throw historyError;

  // Queried newest-first so the LIMIT keeps the most recent messages, then
  // flipped back into chronological order for the model.
  const messages = toModelMessages((history ?? []).slice().reverse());
  if (messages.length === 0) return;

  // `history` is newest-first, so the first inbound row is what triggered this.
  const latestInbound = (history ?? []).find((row) => row.sender_role === 'user');

  await recordAgentEvent({
    agent: 'support_sales',
    eventType: 'started',
    title: 'নতুন কাস্টমার মেসেজ পেয়ে কাজ শুরু করেছে',
    detail: latestInbound ? truncateDetail(latestInbound.content, 160) : null,
    chatId,
  });

  await recordAgentEvent({
    agent: 'support_sales',
    eventType: 'thinking',
    title: 'কী উত্তর দেবে ভাবছে',
    chatId,
  });

  const { text } = await generateText({
    model: google(MODEL),
    instructions: SUPPORT_AGENT_INSTRUCTIONS,
    messages,
    tools: { place_order: createPlaceOrderTool(chatId, chat.platform) },
    stopWhen: isStepCount(MAX_STEPS),
    temperature: 0.4,
  });

  const reply = text.trim();

  if (!reply) {
    // The model answered with a tool call and no prose, or was cut off.
    // Meta rejects empty message text, so there is nothing safe to send.
    console.warn('[agent1] model produced no text, nothing sent', { chatId });

    await recordAgentEvent({
      agent: 'support_sales',
      eventType: 'skipped',
      title: 'কোনো টেক্সট তৈরি হয়নি, কিছু পাঠানো হয়নি',
      chatId,
    });
    return;
  }

  // Last chance to honour a "Pause AI" click that landed while Gemini was
  // thinking — the reply is already composed, but not yet visible to anyone.
  const { data: current } = await supabase
    .from('chats')
    .select('bot_active')
    .eq('id', chatId)
    .single();

  if (!current?.bot_active) {
    console.info('[agent1] AI paused mid-generation, reply dropped', { chatId });

    await recordAgentEvent({
      agent: 'support_sales',
      eventType: 'skipped',
      title: 'AI pause করা হয়েছিল, তৈরি করা উত্তর বাতিল হয়েছে',
      detail: truncateDetail(reply, 160),
      chatId,
    });
    return;
  }

  let messageId: string | null;

  try {
    const sent = await sendMetaMessage({
      platform: chat.platform,
      recipientId: chat.customer_id,
      text: reply,
    });
    messageId = sent.messageId;
  } catch (error) {
    // Nothing reaches the customer, and this runs inside after() — nobody is
    // waiting on the result, so a silent failure would look exactly like a
    // customer who simply did not write back. The usual cause is Meta's
    // 24-hour customer service window closing (error code 10), which only a
    // human replying from the app can fix, so the admin is told immediately.
    console.error('[agent1] failed to deliver the reply to the customer', {
      chatId,
      error,
    });

    await recordAgentEvent({
      agent: 'support_sales',
      eventType: 'alert',
      title: 'কাস্টমারের কাছে উত্তর পৌঁছায়নি',
      detail: error instanceof Error ? error.message : String(error),
      chatId,
    });

    await alertAdminOfFailedReply(
      chatId,
      `Meta rejected the reply — ${error instanceof Error ? error.message : String(error)}`,
    );

    return;
  }

  await recordAgentEvent({
    agent: 'support_sales',
    eventType: 'sent',
    title: 'কাস্টমারকে উত্তর পাঠানো হয়েছে',
    detail: truncateDetail(reply),
    chatId,
  });

  // Deliberately after sending: the customer must never receive a reply that
  // isn't in the dashboard. If this insert fails we log it rather than retry,
  // because a duplicate customer-facing message is worse than a missing row.
  const { error: insertError } = await supabase.from('messages').insert({
    chat_id: chatId,
    sender_role: 'bot',
    content: reply,
    external_message_id: messageId,
  });

  if (insertError) {
    console.error('[agent1] reply delivered but not saved to dashboard', {
      chatId,
      error: insertError,
    });
  }
}

/**
 * Tells the owner that a customer is sitting there unanswered, and why.
 *
 * Best-effort on purpose: if Telegram is down too, the original failure —
 * already logged — must not be swallowed by a second one.
 */
async function alertAdminOfFailedReply(
  chatId: string,
  reason: string,
): Promise<void> {
  try {
    await sendTelegramMessage(
      `AI failed to reply to Chat ID: ${chatId}\nReason: ${reason}`,
    );
  } catch (error) {
    console.error('[agent1] Telegram alert about the failed reply did not send', {
      chatId,
      error,
    });
  }
}

/**
 * `human_admin` messages map to the assistant role on purpose: the bot has to
 * see what the human already promised the customer, otherwise it would repeat
 * or contradict it once AI is switched back on.
 */
function toModelMessages(
  rows: Pick<MessageRow, 'sender_role' | 'content'>[],
): ModelMessage[] {
  return rows.map<ModelMessage>((row) =>
    row.sender_role === 'user'
      ? { role: 'user', content: row.content }
      : { role: 'assistant', content: row.content },
  );
}
