export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_EVENT_TYPES = ['placed', 'status_changed', 'note_added'] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

/** Open like the actor types of the auth module: a timeline entry only records who acted. */
export type ActorType = string;

/**
 * Copied at checkout, never referenced. A price change or a renamed product must not rewrite
 * an invoice, so every field an order line shows is its own — `variantId` survives only so a
 * cancellation knows which stock to put back.
 */
export interface OrderItem {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderEvent {
  id: string;
  type: OrderEventType;
  actorType: ActorType;
  actorId: string | null;
  message: string | null;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  createdAt: Date;
}

export interface Order {
  id: string;
  reference: string;
  customerId: string;
  status: OrderStatus;
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
  placedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
  timeline: OrderEvent[];
}

/**
 * Allowed status transitions. Encoding them here rather than as scattered `if`s means an
 * illegal move is rejected identically wherever it comes from, and adding a state is a
 * one-line change with a compiler-checked exhaustive key set.
 *
 * There is no way back from `shipped`: once a parcel is with a courier the shop no longer
 * controls what happens to it, and a cancellation that puts the stock back would be a lie.
 */
export const STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Stock leaves the shelf when the order is placed, not when it is paid: reserving at checkout
 * is what stops two customers buying the last unit. So every status that has not shipped is
 * still holding stock, and cancelling from there has to give it back.
 */
export function releasesStock(from: OrderStatus, to: OrderStatus): boolean {
  return to === 'cancelled' && from !== 'shipped' && from !== 'delivered';
}

/**
 * The subset of an order a status change is allowed to stamp. Deliberately not `Partial<Order>`:
 * those fields are nullable in the row, and a patch that may carry `null` would let a status
 * change erase a date it never meant to touch.
 */
export interface OrderTimestamps {
  paidAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
}

/** Timestamps are derived from the status, never sent by a client. */
export function timestampFor(status: OrderStatus, at: Date): OrderTimestamps {
  switch (status) {
    case 'paid':
      return { paidAt: at };
    case 'shipped':
      return { shippedAt: at };
    case 'delivered':
      return { deliveredAt: at };
    case 'cancelled':
      return { cancelledAt: at };
    case 'pending_payment':
    case 'preparing':
      return {};
  }
}
