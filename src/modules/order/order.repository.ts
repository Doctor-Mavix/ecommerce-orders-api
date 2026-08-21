import type { InjectionToken } from 'tsyringe';

import type { CursorPage, CursorQuery } from '@core/database/pagination';
import type { ActorType, Order, OrderDetail, OrderEventType, OrderStatus } from './order.types';

export interface NewOrderItem {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface NewOrder {
  id: string;
  reference: string;
  customerId: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  shipRecipient: string;
  shipPhone: string;
  shipCity: string;
  shipDistrict: string | null;
  shipLine1: string;
  shipNotes: string | null;
}

export interface NewOrderEvent {
  id: string;
  type: OrderEventType;
  actorType: ActorType;
  actorId: string | null;
  message: string | null;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
}

export interface OrderPatch {
  status?: OrderStatus | undefined;
  paidAt?: Date | undefined;
  shippedAt?: Date | undefined;
  deliveredAt?: Date | undefined;
  cancelledAt?: Date | undefined;
}

export interface CheckoutRequest {
  order: NewOrder;
  items: NewOrderItem[];
  event: NewOrderEvent;
  /** Emptied in the same transaction: a placed order and a cart still holding it disagree. */
  cartId: string;
}

export interface OrderFilter {
  customerId: string | null;
  status: OrderStatus | null;
}

export interface OrderRepository {
  /**
   * The whole checkout, as one transaction: reserve the stock, write the order and its lines,
   * empty the cart. It spans three modules' tables on purpose — a transaction is defined by
   * what has to succeed or fail together, and that boundary does not follow module boundaries.
   *
   * Raises a `ConflictError` naming the line when the stock is no longer there, which is the
   * only outcome a caller has to handle: everything else has already been rolled back.
   */
  checkout(request: CheckoutRequest): Promise<OrderDetail>;
  findById(id: string): Promise<OrderDetail | null>;
  /** Scoped: an order that is not this customer's reads exactly like one that does not exist. */
  findForCustomer(customerId: string, id: string): Promise<OrderDetail | null>;
  list(query: CursorQuery, filter: OrderFilter): Promise<CursorPage<Order>>;
  /**
   * The status change and its timeline entry are one write, so history can never describe a
   * change that did not happen. `restoreStock` puts the reserved units back in the same
   * transaction — a cancellation that only half-happened is how a shop loses inventory.
   */
  changeStatus(
    id: string,
    patch: OrderPatch,
    event: NewOrderEvent,
    restoreStock: boolean,
  ): Promise<OrderDetail | null>;
  addEvent(id: string, event: NewOrderEvent): Promise<OrderDetail | null>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository') as InjectionToken<OrderRepository>;
