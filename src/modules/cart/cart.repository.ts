import type { InjectionToken } from 'tsyringe';

import type { Cart, CartWithItems } from './cart.types';

export interface NewCart {
  id: string;
  customerId: string;
  currency: string;
}

export interface NewCartItem {
  id: string;
  cartId: string;
  variantId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CartRepository {
  /**
   * One open cart per customer, created on first use. Checkout empties it rather than closing
   * it, so there is never a second cart to reconcile — which is also why this returns the same
   * row forever and the unique index on `customer_id` can enforce it.
   */
  findOrCreate(cart: NewCart): Promise<Cart>;
  findWithItems(customerId: string): Promise<CartWithItems | null>;
  /** Adding the same variant twice raises the quantity of one line instead of creating a second. */
  upsertItem(item: NewCartItem): Promise<void>;
  setQuantity(cartId: string, variantId: string, quantity: number): Promise<boolean>;
  removeItem(cartId: string, variantId: string): Promise<boolean>;
  clear(cartId: string): Promise<void>;
  /** Only meaningful while the cart is empty; the service is what enforces that. */
  setCurrency(cartId: string, currency: string): Promise<void>;
}

export const CART_REPOSITORY = Symbol('CartRepository') as InjectionToken<CartRepository>;
