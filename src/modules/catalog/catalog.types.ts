/**
 * The domain vocabulary of the catalog. Nothing here imports Prisma: the repository translates
 * rows into these shapes, which is what keeps the service and the controllers free of any ORM
 * type — including `Prisma.JsonValue`, which is why `attributes` is narrowed to a string map.
 */

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * Prices are integers in minor units. `Int` in PostgreSQL tops out at 2 147 483 647 and a line
 * total is a unit price times a quantity, so the ceiling below multiplied by the maximum
 * quantity still fits — the schemas enforce both ends of that arithmetic.
 */
export const MAX_PRICE_CENTS = 20_000_000;
export const MAX_QUANTITY = 100;

/**
 * Absent values are `null` rather than optional: `exactOptionalPropertyTypes` makes
 * `field?: string` and `field: undefined` two different things, and a column with no value
 * is an explicit null.
 */
export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Free-form axes such as `{ "color": "black", "size": "M" }`. Which axes exist is a decision
 * of the shop, so the schema stores JSON; values are strings because an axis is a label, and
 * accepting arbitrary JSON here would put an unvalidated shape in front of every client.
 */
export type VariantAttributes = Record<string, string>;

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  name: string;
  priceCents: number;
  stock: number;
  attributes: VariantAttributes;
  weightGrams: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  brand: string | null;
  categoryId: string;
  status: ProductStatus;
  basePriceCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductDetail extends Product {
  category: Category;
  variants: ProductVariant[];
}

/**
 * What the cart and the order modules need to know about a variant before selling it, in one
 * shape: the live price, the stock, and the labels an order line snapshots. Only variants that
 * are actually purchasable are ever returned under this type — an inactive variant, or one
 * whose product is a draft, is not sellable and comes back as absent rather than as a row
 * every caller would have to re-check.
 */
export interface SellableVariant {
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantName: string;
  priceCents: number;
  stock: number;
  currency: string;
}
