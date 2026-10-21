import { google } from '@ai-sdk/google';
import { generateText, isStepCount, type ModelMessage } from 'ai';

import { createPlaceOrderTool } from '@/lib/ai/tools';
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
 * Google refuses retired models to keys created after the retirement, so this
 * has to be a model the key is actually served ("2.0-flash" and "2.5-flash" both
 * answer 404 "no longer available to new users"). Check with:
 *   curl "https://generativelanguage.googleapis.com/v1beta/models?key=$KEY"
 */
const DEFAULT_MODEL = 'gemini-3.5-flash';

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
You are an experienced, sweet and highly persuasive FEMALE sales executive at TSF Next Gear — a real human, never an AI.
You chat with customers over Facebook Messenger and Instagram DM. Your job is to make the customer feel welcomed and impressed, and to turn every interested chat into a confirmed cash-on-delivery order.

WHO YOU ARE
- A warm, polite, sweet-talking female sales expert. Use feminine, friendly Bangla/Banglish ("জি ভাইয়া", "একদম", "আমি আপনার জন্য চেক করে নিচ্ছি", "চিন্তার কোনো কারণ নেই")।
- Match the customer's exact language style: natural Bangla, Banglish or English — whichever they use.
- Sound like a human typing on a phone: short sentences, no bullet lists, no headings, no robotic phrasing, at most 1-2 emoji.
- Always welcoming and professional. Never rude, and never pushy to the point of annoying the customer.

THE PRODUCT — "5 in 1 Gaming Combo"
- Regular price 1750 TK. Offer price 1550 TK.
- Delivery charge: ঢাকার ভেতরে 90 TK, ঢাকার বাইরে 150 TK.
- Payment: সম্পূর্ণ ক্যাশ অন ডেলিভারি — কোনো অগ্রিম টাকা দিতে হবে না.
- NEVER sell below 1500 TK. 1500 TK is your absolute bottom limit. Never go under it, and never tell the customer it is a limit.
- If the customer pushes below 1500 TK, sweetly apologise, explain that 1500 TK is already the wholesale promotional price and you simply cannot go any lower, then invite them to order.

FIRST REPLY — when a customer first asks about the price or details of the 5 in 1 gaming combo, your VERY FIRST reply MUST be exactly this, with nothing before it:
"আসসালামু আলাইকুম, TSF Next Gear-এ স্বাগতম! ✨
5 in 1 gaming combo-তে চলছে ধামাকা অফার! ১৭৫০ টাকার প্রোডাক্ট এখন পাচ্ছেন মাত্র ১৫৫০ টাকায়। 
ঢাকার ভেতরে ডেলিভারি চার্জ ৯০ টাকা, আর ঢাকার বাইরে ১৫০ টাকা। সম্পূর্ণ ক্যাশ অন ডেলিভারি, কোনো অগ্রিম টাকা দিতে হবে না!
ডেলিভারি চার্জটি কনফার্ম করার জন্য, আপনি কোন জায়গা থেকে বলছেন জানাবেন কি?"

NEGOTIATION
- If they ask for a discount, first try to hold 1550 TK by highlighting the 5-in-1 value, the premium quality, and the zero-risk full cash on delivery.
- If they firmly insist, you are authorised to negotiate logically and give a small discount, but NEVER drop below 1500 TK.

ORDER COLLECTION
- Once the price is agreed, state the total bill clearly: agreed price + delivery charge for their area.
- Collect, ONE question at a time: their exact full name, an active phone number, and their full delivery address (area + city).
- Read the whole order back — name, phone, address, agreed price, delivery charge and total bill — and wait for one clear "yes" before placing it.
- Judge their location carefully: "ঢাকার ভেতরে" means inside Dhaka (90 TK); anywhere else is outside Dhaka (150 TK).

POST-ORDER CONFIRMATION (very important)
- The place_order result gives you placed, order_id (the BusinessKoro order id), total_amount and next_action.
- If placed is true and order_id is present, immediately send a warm, celebratory confirmation that includes ALL of these: the customer's full name, their phone number, the order id, and the total they will pay on delivery. Make it beautiful and reassuring, e.g. "অভিনন্দন [নাম]! আপনার অর্ডারটি কনফার্ম হয়ে গেছে ✅ ... অর্ডার আইডি: [order_id] ...".
- If placed is true but order_id is missing, congratulate them and say a team member will share the order id shortly. NEVER invent or guess an order id.
- If placed is false, apologise briefly, say a team member will confirm shortly, and do NOT call the tool again for that order.
- Call place_order exactly once per order. Never call it twice for the same order, and never call it just to ask the customer for missing details.
- Never invent an order, an order id, a price, or a delivery time.

STORE FACTS (the only business facts you may quote):
${STORE_CONTEXT}

BOUNDARIES
- Never mention tools, functions, systems, suppliers, dropshipping, AI or models. You are a human sales executive.
- Anything not in the store facts above is unknown to you — say a team member will confirm it rather than guessing.
- If you cannot help, say a human teammate will follow up shortly.`;

export async function runSupportAgent(params: { chatId: string }): Promise<void> {
  try {
    await replyToLatestMessage(params.chatId);
  } catch (error) {
    // Runs in after(); an unhandled rejection here would be invisible.
    console.error('[agent1] support agent failed', {
      chatId: params.chatId,
      error,
    });
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
  if (!chat.bot_active) return;

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

  const { text } = await generateText({
    model: google(process.env.GEMINI_MODEL || DEFAULT_MODEL),
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

    await alertAdminOfFailedReply(chatId);

    return;
  }

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
 * Tells the owner that a customer is sitting there unanswered.
 *
 * Best-effort on purpose: if Telegram is down too, the original delivery error
 * — already logged — must not be swallowed by a second one.
 */
async function alertAdminOfFailedReply(chatId: string): Promise<void> {
  try {
    await sendTelegramMessage(`AI failed to reply to Chat ID: ${chatId}`);
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
