import { requireEnv } from '@/lib/env';

/**
 * HTML is escaped manually because we send `parse_mode: 'HTML'` and customer
 * names / product text routinely contain `&`, `<`, `>` — Telegram rejects the
 * whole request with 400 if they are not escaped.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sends an order notification to your own Telegram chat via the Bot API.
 *
 * Throws on failure — the caller decides whether that should fail the order.
 */
export async function sendTelegramMessage(plainText: string): Promise<void> {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const chatId = requireEnv('TELEGRAM_CHAT_ID');

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: escapeHtml(plainText),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Telegram sendMessage failed (HTTP ${response.status}): ${body}`,
    );
  }
}
