import { Prisma } from '@prisma-client';
import type {
  Order as OrderRow,
  OrderEvent as OrderEventRow,
  OrderItem as OrderItemRow,
} from '@prisma-client';

import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { buildCursorPage } from '@core/database/pagination';
import { definedOnly } from '@core/database/sql/patch';
import type { SqlClient } from '@core/database/sql/prisma.adapter';
import { ConflictError } from '@core/errors/app-error';
import type {
  CheckoutRequest,
  NewOrderEvent,
  OrderFilter,
  OrderPatch,
  OrderRepository,
} from '../order.repository';
import type { Order, OrderDetail, OrderEvent, OrderItem } from '../order.types';

const UNIQUE_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';

const DETAIL = {
  items: { orderBy: { id: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
} as const;

type DetailRow = OrderRow & { items: OrderItemRow[]; events: OrderEventRow[] };

function errorCodeOf(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

function toItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    variantId: row.variantId,
    sku: row.sku,
    productName: row.productName,
    variantName: row.variantName,
    unitPriceCents: row.unitPriceCents,
    quantity: row.quantity,
    lineTotalCents: row.lineTotalCents,
  };
}

function toEvent(row: OrderEventRow): OrderEvent {
  return {
    id: row.id,
    type: row.type,
    actorType: row.actorType,
    actorId: row.actorId,
    message: row.message,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    createdAt: row.createdAt,
  };
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customerId,
    status: row.status,
    currency: row.currency,
    subtotalCents: row.subtotalCents,
    shippingCents: row.shippingCents,
    totalCents: row.totalCents,
    shipRecipient: row.shipRecipient,
    shipPhone: row.shipPhone,
    shipCity: row.shipCity,
    shipDistrict: row.shipDistrict,
    shipLine1: row.shipLine1,
    shipNotes: row.shipNotes,
    placedAt: row.placedAt,
    paidAt: row.paidAt,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: DetailRow): OrderDetail {
  return { ...toOrder(row), items: row.items.map(toItem), timeline: row.events.map(toEvent) };
}

/** Keyset predicate: everything strictly after (or before) the last row of the previous page. */
function cursorWhere(query: CursorQuery): Prisma.OrderWhereInput | undefined {
  if (query.cursor === null) {
    return undefined;
  }

  const createdAt = new Date(query.cursor.value);
  const ascending = query.direction === 'asc';
  const bound = ascending ? { gt: createdAt } : { lt: createdAt };
  const idBound = ascending ? { gt: query.cursor.id } : { lt: query.cursor.id };

  return { OR: [{ createdAt: bound }, { createdAt, id: idBound }] };
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly client: SqlClient) {}

  async checkout(request: CheckoutRequest): Promise<OrderDetail> {
    try {
      return await this.client.$transaction(async (tx) => {
        for (const item of request.items) {
          /**
           * The reservation, and the reason a checkout is safe under concurrency. The `gte` in
           * the filter makes reading the stock and lowering it a single statement, so two
           * checkouts racing for the last unit are serialised by the row lock the UPDATE takes:
           * one matches, the other matches nothing and is told so.
           *
           * A read followed by a write would let both pass, and only the CHECK constraint below
           * would catch it — as a rolled-back transaction rather than a clean 409.
           */
          const reserved = await tx.productVariant.updateMany({
            where: { id: item.variantId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });

          if (reserved.count === 0) {
            throw new ConflictError(
              `"${item.productName}" is no longer available in that quantity`,
            );
          }
        }

        const order = await tx.order.create({
          data: {
            ...request.order,
            items: { create: request.items },
            events: { create: request.event },
          },
          include: DETAIL,
        });

        // The cart is emptied inside the same transaction: an order that exists next to a cart
        // still holding its lines is a customer about to buy the same thing twice.
        await tx.cartItem.deleteMany({ where: { cartId: request.cartId } });

        return toDetail(order);
      });
    } catch (error) {
      if (errorCodeOf(error) === UNIQUE_VIOLATION) {
        throw new ConflictError('This order reference is already taken', { cause: error });
      }
      throw error;
    }
  }

  async findById(id: string): Promise<OrderDetail | null> {
    const row = await this.client.order.findUnique({ where: { id }, include: DETAIL });

    return row === null ? null : toDetail(row);
  }

  async findForCustomer(customerId: string, id: string): Promise<OrderDetail | null> {
    const row = await this.client.order.findFirst({ where: { id, customerId }, include: DETAIL });

    return row === null ? null : toDetail(row);
  }

  async list(query: CursorQuery, filter: OrderFilter): Promise<CursorPage<Order>> {
    const rows = await this.client.order.findMany({
      where: {
        ...(filter.customerId === null ? {} : { customerId: filter.customerId }),
        ...(filter.status === null ? {} : { status: filter.status }),
        ...cursorWhere(query),
      },
      orderBy: [{ createdAt: query.direction }, { id: query.direction }],
      take: query.limit + 1,
    });

    return buildCursorPage(rows.map(toOrder), query.limit, (item) => ({
      value: item.createdAt.toISOString(),
      id: item.id,
    }));
  }

  async changeStatus(
    id: string,
    patch: OrderPatch,
    event: NewOrderEvent,
    restoreStock: boolean,
  ): Promise<OrderDetail | null> {
    try {
      return await this.client.$transaction(async (tx) => {
        if (restoreStock) {
          // Read the lines from the order rather than from the caller: what was reserved is
          // what the invoice says, and nothing in between is allowed to disagree with it.
          const items = await tx.orderItem.findMany({ where: { orderId: id } });

          for (const item of items) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }

        // Compare-and-set. The key is spelled in two branches rather than with `status:
        // fromStatus ?? undefined`, because a unique-where holding an explicit `undefined` is
        // not the same type as one missing the key, and Prisma only accepts the second.
        const where: Prisma.OrderWhereUniqueInput =
          event.fromStatus === null ? { id } : { id, status: event.fromStatus };

        const row = await tx.order.update({
          where,
          data: { ...definedOnly(patch), events: { create: event } },
          include: DETAIL,
        });

        return toDetail(row);
      });
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  async addEvent(id: string, event: NewOrderEvent): Promise<OrderDetail | null> {
    try {
      const row = await this.client.order.update({
        where: { id },
        data: { events: { create: event } },
        include: DETAIL,
      });

      return toDetail(row);
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }
}
