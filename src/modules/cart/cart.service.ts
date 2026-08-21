import { inject, injectable } from 'tsyringe';

import { ConflictError, NotFoundError } from '@core/errors/app-error';
import { CatalogService } from '@modules/catalog/catalog.service';
import { MAX_QUANTITY } from '@modules/catalog/catalog.types';
import type { SellableVariant } from '@modules/catalog/catalog.types';
import { SHARED_TOKENS } from '@shared/tokens';
import type { IdService } from '@shared/utils-services/id.service';
import type { CartRepository } from './cart.repository';
import { CART_REPOSITORY } from './cart.repository';
import type { AddCartItemInput, SetQuantityInput } from './cart.schemas';
import type { Cart, CartLine, CartView, CartWithItems } from './cart.types';

const DEFAULT_CURRENCY = 'XOF';

/**
 * The cart. It reads the catalogue through `CatalogService` rather than through the catalogue's
 * tables, which is the seam that would become an HTTP call if the two modules were ever split.
 *
 * Every stock check here is advisory: it stops a customer filling a cart with something the
 * shop plainly does not have, but between this check and checkout anything can happen. What
 * actually protects the stock is the transaction in the order module and the CHECK constraint
 * under it.
 */
@injectable()
export class CartService {
  constructor(
    @inject(CART_REPOSITORY) private readonly repository: CartRepository,
    @inject(CatalogService) private readonly catalog: CatalogService,
    @inject(SHARED_TOKENS.Id) private readonly ids: IdService,
  ) {}

  async view(customerId: string): Promise<CartView> {
    const cart = await this.repository.findWithItems(customerId);

    if (cart === null) {
      return this.emptyView(await this.open(customerId, DEFAULT_CURRENCY));
    }

    return this.render(cart);
  }

  async addItem(customerId: string, input: AddCartItemInput): Promise<CartView> {
    const variant = await this.requireSellable(input.variantId);
    const cart = await this.open(customerId, variant.currency);
    const items = (await this.repository.findWithItems(customerId))?.items ?? [];

    await this.alignCurrency(cart, items.length, variant.currency);

    const current = items.find((item) => item.variantId === variant.variantId)?.quantity ?? 0;
    const quantity = current + input.quantity;

    this.assertQuantity(variant, quantity);

    await this.repository.upsertItem({
      id: this.ids.uuid(),
      cartId: cart.id,
      variantId: variant.variantId,
      quantity,
      // Re-snapshotted on every add: the customer is looking at the price right now, so that
      // is the one the line should carry.
      unitPriceCents: variant.priceCents,
    });

    return this.view(customerId);
  }

  async setQuantity(
    customerId: string,
    variantId: string,
    input: SetQuantityInput,
  ): Promise<CartView> {
    const cart = await this.requireCart(customerId);
    const variant = await this.requireSellable(variantId);

    this.assertQuantity(variant, input.quantity);

    if (!(await this.repository.setQuantity(cart.id, variantId, input.quantity))) {
      throw new NotFoundError('This item is not in the cart');
    }

    return this.render(await this.requireCart(customerId));
  }

  async removeItem(customerId: string, variantId: string): Promise<CartView> {
    const cart = await this.requireCart(customerId);

    if (!(await this.repository.removeItem(cart.id, variantId))) {
      throw new NotFoundError('This item is not in the cart');
    }

    return this.render(await this.requireCart(customerId));
  }

  async clear(customerId: string): Promise<CartView> {
    const cart = await this.requireCart(customerId);

    await this.repository.clear(cart.id);

    return this.render(await this.requireCart(customerId));
  }

  private async open(customerId: string, currency: string): Promise<Cart> {
    return this.repository.findOrCreate({ id: this.ids.uuid(), customerId, currency });
  }

  private async requireCart(customerId: string): Promise<CartWithItems> {
    const cart = await this.repository.findWithItems(customerId);

    if (cart === null) {
      throw new NotFoundError('The cart is empty');
    }

    return cart;
  }

  private async requireSellable(variantId: string): Promise<SellableVariant> {
    const variant = (await this.catalog.sellable([variantId])).get(variantId);

    if (variant === undefined) {
      // Deactivated, unpublished and never-existed all answer the same way: what the shop is
      // not selling is not something a shopper needs an explanation for.
      throw new NotFoundError('This item is not available');
    }

    return variant;
  }

  private assertQuantity(variant: SellableVariant, quantity: number): void {
    if (quantity > MAX_QUANTITY) {
      throw new ConflictError(`A line cannot exceed ${String(MAX_QUANTITY)} units`);
    }

    if (quantity > variant.stock) {
      throw new ConflictError(
        `Only ${String(variant.stock)} unit(s) of "${variant.variantName}" are left`,
      );
    }
  }

  /**
   * A cart holds one currency, because a subtotal made of two of them is not a number. The
   * first line decides it; while the cart is empty the choice is still free.
   */
  private async alignCurrency(cart: Cart, itemCount: number, currency: string): Promise<void> {
    if (cart.currency === currency) {
      return;
    }

    if (itemCount > 0) {
      throw new ConflictError(
        `This cart is in ${cart.currency}; empty it before adding a ${currency} item`,
      );
    }

    await this.repository.setCurrency(cart.id, currency);
  }

  private emptyView(cart: Cart): CartView {
    return {
      id: cart.id,
      currency: cart.currency,
      items: [],
      subtotalCents: 0,
      needsAttention: false,
      updatedAt: cart.updatedAt,
    };
  }

  private async render(cart: CartWithItems): Promise<CartView> {
    // One catalogue read for the whole cart, not one per line: a batch here is the difference
    // between a cart page that costs one query and one that costs a query per item.
    const live = await this.catalog.sellable(cart.items.map((item) => item.variantId));

    const items: CartLine[] = cart.items.map((item) => {
      const variant = live.get(item.variantId);

      return {
        variantId: item.variantId,
        sku: variant?.sku ?? null,
        productName: variant?.productName ?? null,
        variantName: variant?.variantName ?? null,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        livePriceCents: variant?.priceCents ?? null,
        lineTotalCents: item.unitPriceCents * item.quantity,
        available: variant !== undefined && variant.stock >= item.quantity,
        priceChanged: variant !== undefined && variant.priceCents !== item.unitPriceCents,
        stock: variant?.stock ?? null,
      };
    });

    return {
      id: cart.id,
      currency: cart.currency,
      items,
      subtotalCents: items
        .filter((item) => item.available)
        .reduce((total, item) => total + item.lineTotalCents, 0),
      needsAttention: items.some((item) => !item.available || item.priceChanged),
      updatedAt: cart.updatedAt,
    };
  }
}
