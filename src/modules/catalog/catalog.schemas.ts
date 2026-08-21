import { z } from 'zod';

import { cursorQuerySchema } from '@core/database/pagination';
import { MAX_PRICE_CENTS, PRODUCT_STATUSES } from './catalog.types';

const idSchema = z.uuid();

/**
 * A slug is what a URL is built from, so it is restricted to what survives one: lowercase,
 * digits and single hyphens. Clients may leave it out — the service derives it from the name.
 */
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a slug such as "chemise-en-lin"');

const priceSchema = z.number().int().min(0).max(MAX_PRICE_CENTS);

/** ISO 4217. Stored per product, so a shop can price in XOF and in EUR at the same time. */
const currencySchema = z.string().trim().toUpperCase().length(3);

const attributesSchema = z.record(z.string().trim().min(1).max(40), z.string().trim().max(120));

/**
 * Bodies are strict: an unknown key is a rejected request, not a silently dropped one. That
 * closes mass-assignment — a caller posting `stock` on a product, or `createdAt` anywhere —
 * by construction instead of relying on every handler remembering to pick fields.
 */
export const createCategorySchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema.optional(),
  description: z.string().trim().min(1).max(2_000).optional(),
  parentId: idSchema.optional(),
  position: z.number().int().min(0).max(9_999).optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/**
 * Every field optional, and `.nullable()` where clearing the value is meaningful: sending
 * `parentId: null` moves a category back to the root, which is not the same request as not
 * mentioning `parentId` at all.
 */
export const updateCategorySchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120),
    slug: slugSchema,
    description: z.string().trim().min(1).max(2_000).nullable(),
    parentId: idSchema.nullable(),
    position: z.number().int().min(0).max(9_999),
  })
  .partial();

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const createProductSchema = z.strictObject({
  name: z.string().trim().min(2).max(200),
  slug: slugSchema.optional(),
  description: z.string().trim().min(10).max(10_000),
  brand: z.string().trim().min(1).max(120).optional(),
  categoryId: idSchema,
  status: z.enum(PRODUCT_STATUSES).optional(),
  basePriceCents: priceSchema,
  currency: currencySchema.optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(200),
    slug: slugSchema,
    description: z.string().trim().min(10).max(10_000),
    brand: z.string().trim().min(1).max(120).nullable(),
    categoryId: idSchema,
    status: z.enum(PRODUCT_STATUSES),
    basePriceCents: priceSchema,
    currency: currencySchema,
  })
  .partial();

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsSchema = cursorQuerySchema.extend({
  categoryId: idSchema.optional(),
  /**
   * Honoured only for an agent. A shopper always sees the active products and nothing else,
   * so this parameter cannot be used to read a draft that is not published yet.
   */
  status: z.enum(PRODUCT_STATUSES).optional(),
  search: z.string().trim().min(2).max(120).optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsSchema>;

/**
 * A SKU is scanned, typed and pasted between systems, so it is uppercased on the way in:
 * "abc-1" and "ABC-1" must not become two rows the unique index accepts.
 */
export const createVariantSchema = z.strictObject({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(64)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'must be an alphanumeric SKU'),
  name: z.string().trim().min(1).max(120),
  priceCents: priceSchema,
  stock: z.number().int().min(0).max(1_000_000).optional(),
  attributes: attributesSchema.optional(),
  weightGrams: z.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
});

export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    priceCents: priceSchema,
    stock: z.number().int().min(0).max(1_000_000),
    attributes: attributesSchema,
    weightGrams: z.number().int().min(0).max(1_000_000).nullable(),
    isActive: z.boolean(),
  })
  .partial();

export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const idParamsSchema = z.strictObject({ id: idSchema });

export const slugParamsSchema = z.strictObject({ slug: slugSchema });

export const productIdParamsSchema = z.strictObject({ productId: idSchema });

export const variantParamsSchema = z.strictObject({
  productId: idSchema,
  variantId: idSchema,
});
