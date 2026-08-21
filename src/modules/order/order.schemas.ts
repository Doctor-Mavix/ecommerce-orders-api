import { z } from 'zod';

import { cursorQuerySchema } from '@core/database/pagination';
import { ORDER_STATUSES } from './order.types';

const idSchema = z.string().trim().min(1).max(64);

/**
 * Checkout carries an address id and nothing else. Everything else a customer might think of
 * sending — prices, totals, the lines themselves — is read on the server from the cart and the
 * catalogue, because a total a client is allowed to name is a total a client is allowed to
 * choose.
 */
export const checkoutSchema = z.strictObject({
  addressId: idSchema,
  notes: z.string().trim().max(500).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const listOrdersSchema = cursorQuerySchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  /** Honoured only for an agent: a customer always lists their own orders. */
  customerId: idSchema.optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersSchema>;

export const changeStatusSchema = z.strictObject({
  status: z.enum(ORDER_STATUSES),
  message: z.string().trim().max(500).optional(),
});

export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;

export const cancelOrderSchema = z.strictObject({
  reason: z.string().trim().max(500).optional(),
});

export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const addNoteSchema = z.strictObject({
  message: z.string().trim().min(1).max(500),
});

export type AddNoteInput = z.infer<typeof addNoteSchema>;

export const orderIdParamsSchema = z.strictObject({ id: idSchema });
