import { tool } from 'ai';
import { z } from 'zod';

import { placeOrder } from '@/lib/ai/agent2-orders';
import type { Platform } from '@/types/database';

/**
 * The bridge between the two agents: Agent 1 (Gemini) can only reach Agent 2 by
 * emitting a tool call that matches this schema. Because the schema is enforced
 * by Zod before `execute` runs, Agent 2 never receives half-filled order data.
 */

const orderItemSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe('Product name exactly as the customer referred to it'),
  sku: z.string().min(1).optional().describe('Only if the customer gave a SKU'),
  qty: z.number().int().positive().describe('Number of units ordered'),
  price: z.number().nonnegative().describe('Unit price in the store currency'),
});

/**
 * `chatId`/`platform` are captured in the closure rather than exposed as tool
 * inputs — the model must not be able to order on behalf of another customer.
 */
export function createPlaceOrderTool(chatId: string, platform: Platform) {
  return tool({
    description:
      "Place a confirmed order with the BusinessKoro dropshipping supplier. Call this ONLY once you have collected all four required fields — the item with its quantity, the customer's full name, a reachable phone number, and a complete delivery address — AND the customer has explicitly agreed to the price and total bill. Never call it to ask for missing details; ask the customer in plain text instead.",
    inputSchema: z.object({
      items: z
        .array(orderItemSchema)
        .length(1)
        .describe(
          'The single product this order is for. The supplier takes one product per order, so never send more than one.',
        ),
      customer_name: z.string().min(2).describe('Full name of the recipient'),
      customer_phone: z
        .string()
        .min(6)
        .describe('Phone number the delivery agent will call'),
      customer_address: z
        .string()
        .min(10)
        .describe('Complete delivery address including area and city'),
      delivery_charge: z
        .number()
        .nonnegative()
        .optional()
        .describe(
          'Delivery charge in BDT you agreed with the customer: 90 inside Dhaka, 150 outside Dhaka. It is collected by the courier on top of the product price, so never add it to the item price.',
        ),
      currency: z
        .string()
        .min(1)
        .optional()
        .describe('ISO code or symbol; defaults to BDT when omitted'),
      summary: z
        .string()
        .optional()
        .describe('One-line human description of the order for the owner'),
      notes: z
        .string()
        .optional()
        .describe('Delivery instructions the customer mentioned'),
    }),
    execute: async (input) => {
      const result = await placeOrder({
        chatId,
        platform,
        customerName: input.customer_name,
        customerPhone: input.customer_phone,
        customerAddress: input.customer_address,
        deliveryCharge: input.delivery_charge,
        productDetails: {
          items: input.items,
          summary: input.summary,
        },
        currency: input.currency,
        notes: input.notes,
      });

      // Shaped for the model, not for us. `order_id` is BusinessKoro's own
      // order id — it is the reference the customer is told to quote, and the
      // only order id they should ever hear. Our internal UUID stays here.
      return {
        placed: result.ok,
        order_id: result.supplierOrderId,
        total_amount: result.totalAmount,
        next_action: result.message,
      };
    },
  });
}
