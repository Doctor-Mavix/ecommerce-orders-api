export interface Cart {
  id: string;
  customerId: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `unitPriceCents` is a snapshot taken when the line was added. It is what the cart shows, so
 * the total never changes under the customer while they are still shopping; checkout re-reads
 * the live price and refuses if it moved, which is the only place the two are compared.
 */
export interface CartItem {
  id: string;
  cartId: string;
  variantId: string;
  quantity: number;
  unitPriceCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartWithItems extends Cart {
  items: CartItem[];
}

/**
 * A line as the customer sees it, with the catalogue read back in. `available` is false when
 * the variant has been deactivated or its product unpublished since the line was added — the
 * line stays visible rather than vanishing silently, because a cart that quietly loses items
 * is worse than one that explains itself.
 */
export interface CartLine {
  variantId: string;
  sku: string | null;
  productName: string | null;
  variantName: string | null;
  quantity: number;
  unitPriceCents: number;
  livePriceCents: number | null;
  lineTotalCents: number;
  available: boolean;
  priceChanged: boolean;
  stock: number | null;
}

export interface CartView {
  id: string;
  currency: string;
  items: CartLine[];
  /** Sums the available lines only, at the price the customer was shown. */
  subtotalCents: number;
  /** True when at least one line can no longer be bought as it stands. */
  needsAttention: boolean;
  updatedAt: Date;
}
