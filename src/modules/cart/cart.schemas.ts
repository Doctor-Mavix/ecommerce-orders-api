import { z } from 'zod';

import { MAX_QUANTITY } from '@modules/catalog/catalog.types';

/**
 * A quantity of zero is not "remove this line", it is a request that does not say what it
 * wants. Removing a line has its own verb, and the CHECK constraint on `cart_items` says the
 * same thing one layer down.
 */
const quantitySchema = z.number().int().min(1).max(MAX_QUANTITY);

export const addCartItemSchema = z.strictObject({
  variantId: z.uuid(),
  quantity: quantitySchema.default(1),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const setQuantitySchema = z.strictObject({
  quantity: quantitySchema,
});

export type SetQuantityInput = z.infer<typeof setQuantitySchema>;

export const variantIdParamsSchema = z.strictObject({ variantId: z.uuid() });
