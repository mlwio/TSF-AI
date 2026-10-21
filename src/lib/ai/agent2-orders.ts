import { SupplierApiError, createSupplierOrder } from '@/lib/supplier';
import { getAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from '@/lib/telegram';
import type { OrderStatus, Platform } from '@/types/database';

/**
 * AGENT 2 — Dropshipping & Order Manager.
 *
 * This is not a conversational agent. It is a plain function that Agent 1 calls
 * through the `place_order` tool. It has no model of its own, which is the
 * point: order placement must be deterministic and auditable, never a prompt.
 *
 * Sequence: record -> push to supplier -> update status -> notify the owner.
 */

export interface OrderLineItem {
  name: string;
  sku?: string;
  qty: number;
  price: number;
}

/** Stored verbatim in orders.product_details (jsonb). */
export interface OrderProductDetails {
  items: OrderLineItem[];
  summary?: string;
}

export interface PlaceOrderInput {
  chatId: string;
  platform: Platform;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  /**
   * Collected by the courier on top of the product price (90 inside Dhaka,
   * 150 outside). Kept separate from the item price because BusinessKoro is
   * told the product price only and charges delivery itself.
   */
  deliveryCharge?: number;
  productDetails: OrderProductDetails;
  currency?: string;
  notes?: string;
}

export interface PlaceOrderResult {
  ok: boolean;
  orderId: string;
  status: OrderStatus;
  supplierOrderId: string | null;
  totalAmount: number;
  /** Plain-language outcome, fed back to Agent 1 as the tool result. */
  message: string;
}

/**
 * LLMs genuinely do repeat tool calls, and generateText retries failed steps on
 * its own. Placing a supplier order costs real money, so a second live order for
 * the same chat inside this window is refused and the existing one is returned.
 */
const DUPLICATE_ORDER_WINDOW_MINUTES = 15;

/** Orders in these states are already costing us money; never place another. */
const LIVE_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'placed',
  'processing',
  'shipped',
  'delivered',
];

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const supabase = getAdminClient();
  const currency = input.currency || 'BDT';
  const deliveryCharge = input.deliveryCharge ?? 0;
  // What the customer actually hands the courier: product + delivery.
  const totalAmount = sumLines(input.productDetails.items, deliveryCharge);

  const duplicate = await findRecentLiveOrder(input.chatId);
  if (duplicate) {
    return {
      ok: true,
      orderId: duplicate.id,
      status: duplicate.status,
      supplierOrderId: duplicate.supplier_order_id,
      totalAmount: duplicate.total_amount ?? totalAmount,
      message:
        'This order was already placed for this customer a moment ago, so no second order was created. ' +
        'Confirm the existing order with the customer; do not call this tool again.',
    };
  }

  // 1. Record the attempt BEFORE touching the supplier, so a crash mid-call
  //    still leaves a row to investigate instead of a silent charge.
  const { data: order, error: insertError } = await supabase
    .from('orders')
    .insert({
      chat_id: input.chatId,
      product_details: input.productDetails,
      status: 'pending',
      supplier_order_id: null,
      customer_name: input.customerName,
      customer_phone: input.customerPhone,
      customer_address: input.customerAddress,
      total_amount: totalAmount,
      currency,
    })
    .select('id')
    .single();

  if (insertError || !order) {
    throw insertError ?? new Error('orders insert returned no row');
  }

  // The first moment we learn who the customer is: Meta never sends a profile
  // name on the webhook, so without this the dashboard labels the conversation
  // "Messenger user a1b2c3" forever. Recorded before the supplier call so the
  // name survives even if the order itself fails.
  await rememberCustomerName(input.chatId, input.customerName);

  // 2. Push it to the dropshipping supplier.
  let supplierOrderId: string | null = null;
  try {
    const supplier = await createSupplierOrder({
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerAddress: input.customerAddress,
      items: input.productDetails.items,
      notes: input.notes,
    });
    supplierOrderId = supplier.supplierOrderId;
  } catch (error) {
    return failOrder({
      orderId: order.id,
      input,
      currency,
      totalAmount,
      error,
    });
  }

  // 3. Supplier accepted it — the order is live.
  const { error: updateError } = await supabase
    .from('orders')
    .update({ status: 'placed', supplier_order_id: supplierOrderId })
    .eq('id', order.id);

  // The supplier really does have the order, so report success even if our own
  // bookkeeping write failed — 'pending' + supplier_order_id is recoverable by
  // hand, whereas telling the customer it failed is not.
  if (updateError) {
    console.error('[agent2] supplier order placed but status update failed', {
      orderId: order.id,
      supplierOrderId,
      error: updateError,
    });
  }

  await notifyOwner(
    buildOrderNotification({
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerAddress: input.customerAddress,
      platform: input.platform,
      items: input.productDetails.items,
      currency,
      deliveryCharge,
      totalAmount,
      orderId: order.id,
      supplierOrderId,
      notes: input.notes,
    }),
  );

  return {
    ok: true,
    orderId: order.id,
    status: 'placed',
    supplierOrderId,
    totalAmount,
    message: supplierOrderId
      ? `Order placed successfully. BusinessKoro order id: ${supplierOrderId}. Total to collect on delivery: ${currency} ${totalAmount}. Send the customer a congratulatory confirmation quoting their name, their phone number, this order id and the total.`
      : `Order placed successfully, but the supplier returned no order id. Total to collect on delivery: ${currency} ${totalAmount}. Congratulate the customer and say a team member will share the order id shortly — do NOT invent one.`,
  };
}

/**
 * Best-effort: the name is cosmetic. A failure here must never change the
 * outcome of an order the customer has already agreed to.
 */
async function rememberCustomerName(chatId: string, name: string): Promise<void> {
  const customerName = name.trim();
  if (!customerName) return;

  const { error } = await getAdminClient()
    .from('chats')
    .update({ customer_name: customerName })
    .eq('id', chatId);

  if (error) {
    console.error('[agent2] could not save the customer name to the chat', {
      chatId,
      error,
    });
  }
}

async function findRecentLiveOrder(chatId: string) {
  const since = new Date(
    Date.now() - DUPLICATE_ORDER_WINDOW_MINUTES * 60_000,
  ).toISOString();

  const { data, error } = await getAdminClient()
    .from('orders')
    .select('id, status, supplier_order_id, total_amount')
    .eq('chat_id', chatId)
    .in('status', LIVE_ORDER_STATUSES)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[agent2] duplicate-order check failed, continuing', {
      chatId,
      error,
    });
    return null;
  }

  return data;
}

/**
 * The supplier refused the order. Mark it failed, flag it to the owner, and
 * return a soft failure so Agent 1 can say something honest to the customer
 * instead of promising a delivery that will never arrive.
 */
async function failOrder(params: {
  orderId: string;
  input: PlaceOrderInput;
  currency: string;
  totalAmount: number;
  error: unknown;
}): Promise<PlaceOrderResult> {
  const { orderId, input, currency, totalAmount, error } = params;

  const reason =
    error instanceof SupplierApiError
      ? `supplier returned HTTP ${error.status}`
      : error instanceof Error
        ? error.message
        : String(error);

  console.error('[agent2] supplier rejected the order', {
    orderId,
    reason,
    error,
  });

  const { error: updateError } = await getAdminClient()
    .from('orders')
    .update({ status: 'failed' })
    .eq('id', orderId);

  if (updateError) {
    console.error('[agent2] could not mark order as failed', {
      orderId,
      error: updateError,
    });
  }

  await notifyOwner(
    [
      'ORDER FAILED — MANUAL ACTION NEEDED',
      '',
      'The supplier API rejected this order, so nothing was shipped or charged.',
      `Reason: ${reason}`,
      '',
      `Customer: ${input.customerName}`,
      `Phone: ${input.customerPhone}`,
      `Address: ${input.customerAddress}`,
      `Total: ${currency} ${totalAmount}`,
      `Order ref: ${orderId}`,
    ].join('\n'),
  );

  return {
    ok: false,
    orderId,
    status: 'failed',
    supplierOrderId: null,
    totalAmount,
    message:
      'Order placement failed and nothing has been charged or shipped. Apologise briefly and tell the customer a team member will confirm the order shortly. Do NOT call this tool again for this order.',
  };
}

/**
 * Best-effort: a Telegram outage must never change the outcome of a real order,
 * so failures are logged and swallowed.
 */
async function notifyOwner(text: string): Promise<void> {
  try {
    await sendTelegramMessage(text);
  } catch (error) {
    console.error('[agent2] Telegram notification failed', { error });
  }
}

function buildOrderNotification(params: {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  platform: Platform;
  items: OrderLineItem[];
  currency: string;
  deliveryCharge: number;
  totalAmount: number;
  orderId: string;
  supplierOrderId: string | null;
  notes?: string;
}): string {
  const lines = [
    'NEW ORDER',
    '',
    `Customer: ${params.customerName}`,
    `Phone: ${params.customerPhone}`,
    `Address: ${params.customerAddress}`,
    `Channel: ${platformLabel(params.platform)}`,
    '',
    'Items:',
    ...params.items.map(
      (item) =>
        `- ${item.qty} x ${item.name} @ ${params.currency} ${item.price}`,
    ),
  ];

  if (params.deliveryCharge > 0) {
    lines.push(`Delivery charge: ${params.currency} ${params.deliveryCharge}`);
  }

  lines.push(
    `Total (cash on delivery): ${params.currency} ${params.totalAmount}`,
    '',
    // The reference the customer is told to quote, so the owner can look the
    // order up in the BusinessKoro dashboard.
    `BusinessKoro Order ID: ${params.supplierOrderId ?? '(not returned — check the BusinessKoro dashboard)'}`,
    `Dashboard ref: ${params.orderId}`,
  );

  if (params.notes) {
    lines.push('', `Notes: ${params.notes}`);
  }

  return lines.join('\n');
}

function platformLabel(platform: Platform): string {
  return platform === 'instagram' ? 'Instagram DM' : 'Facebook Messenger';
}

/** Rounded to 2 decimals to match the numeric(12,2) column. */
function sumLines(items: OrderLineItem[], deliveryCharge: number): number {
  const products = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  return Math.round((products + deliveryCharge) * 100) / 100;
}
