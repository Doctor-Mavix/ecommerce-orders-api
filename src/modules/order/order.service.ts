import { inject, injectable } from 'tsyringe';

import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { ConflictError, ForbiddenError, NotFoundError } from '@core/errors/app-error';
import { requestContext } from '@core/http/request-context';
import { CartService } from '@modules/cart/cart.service';
import { CatalogService } from '@modules/catalog/catalog.service';
import type { SellableVariant } from '@modules/catalog/catalog.types';
import { CustomerService } from '@modules/customer/customer.service';
import { shippingDetailsOf } from '@modules/customer/customer.types';
import type { AuthRepository } from '@modules/auth/auth.repository';
import { AUTH_REPOSITORY } from '@modules/auth/auth.repository';
import { NOTIFICATION_SERVICE } from '@shared/notifications/notification.tokens';
import type { NotificationService } from '@shared/notifications/notification.service';
import type { RealtimeGateway } from '@shared/realtime/realtime.types';
import { rooms } from '@shared/realtime/realtime.types';
import { SHARED_TOKENS } from '@shared/tokens';
import type { I18nService } from '@shared/utils-services/i18n.service';
import type { IdService } from '@shared/utils-services/id.service';
import type { NewOrderEvent, NewOrderItem, OrderPatch, OrderRepository } from './order.repository';
import { ORDER_REPOSITORY } from './order.repository';
import type {
  AddNoteInput,
  CancelOrderInput,
  ChangeStatusInput,
  CheckoutInput,
  ListOrdersQuery,
} from './order.schemas';
import type { Order, OrderDetail, OrderStatus } from './order.types';
import { canTransition, releasesStock, timestampFor } from './order.types';

const ADMIN_ROLE = 'admin';
const REFERENCE_PREFIX = 'CMD';

/**
 * Shipping is a flat fee, waived above a threshold. A real shop computes it per zone and per
 * weight; what matters for the template is that the customer never sends it — a total the
 * client is allowed to name is a total the client is allowed to choose.
 */
const SHIPPING_FLAT_CENTS = 150_000;
const FREE_SHIPPING_ABOVE_CENTS = 5_000_000;

/**
 * The order module. It owns the two things the rest of the shop is not allowed to own: the
 * checkout transaction and the status machine.
 *
 * Everything a line shows is copied here from the catalogue at the moment of purchase, and the
 * cart's prices are compared against the live ones rather than trusted — a cart is a draft that
 * may be days old, and a price that moved must stop the sale rather than pick a side.
 */
@injectable()
export class OrderService {
  constructor(
    @inject(ORDER_REPOSITORY) private readonly repository: OrderRepository,
    @inject(CartService) private readonly carts: CartService,
    @inject(CatalogService) private readonly catalog: CatalogService,
    @inject(CustomerService) private readonly customers: CustomerService,
    @inject(AUTH_REPOSITORY) private readonly actors: AuthRepository,
    @inject(NOTIFICATION_SERVICE) private readonly notifications: NotificationService,
    @inject(SHARED_TOKENS.Realtime) private readonly realtime: RealtimeGateway,
    @inject(SHARED_TOKENS.I18n) private readonly i18n: I18nService,
    @inject(SHARED_TOKENS.Id) private readonly ids: IdService,
  ) {}

  async checkout(customerId: string, input: CheckoutInput): Promise<OrderDetail> {
    const cart = await this.carts.view(customerId);

    if (cart.items.length === 0) {
      throw new ConflictError('The cart is empty');
    }

    const address = await this.customers.getAddress(customerId, input.addressId);
    const live = await this.catalog.sellable(cart.items.map((item) => item.variantId));

    const items: NewOrderItem[] = cart.items.map((line) => {
      const variant = this.requireStillSellable(live, line.variantId);

      if (variant.priceCents !== line.unitPriceCents) {
        throw new ConflictError(
          `The price of "${variant.productName}" has changed; review your cart before ordering`,
        );
      }

      return {
        id: this.ids.uuid(),
        variantId: variant.variantId,
        sku: variant.sku,
        productName: variant.productName,
        variantName: variant.variantName,
        unitPriceCents: variant.priceCents,
        quantity: line.quantity,
        lineTotalCents: variant.priceCents * line.quantity,
      };
    });

    const subtotalCents = items.reduce((total, item) => total + item.lineTotalCents, 0);
    const shippingCents = subtotalCents >= FREE_SHIPPING_ABOVE_CENTS ? 0 : SHIPPING_FLAT_CENTS;
    const shipping = shippingDetailsOf(address);

    const order = await this.repository.checkout({
      cartId: cart.id,
      order: {
        id: this.ids.uuid(),
        reference: this.ids.reference(REFERENCE_PREFIX),
        customerId,
        currency: cart.currency,
        subtotalCents,
        shippingCents,
        totalCents: subtotalCents + shippingCents,
        shipRecipient: shipping.recipient,
        shipPhone: shipping.phone,
        shipCity: shipping.city,
        shipDistrict: shipping.district,
        shipLine1: shipping.line1,
        shipNotes: input.notes ?? shipping.notes,
      },
      items,
      event: {
        id: this.ids.uuid(),
        type: 'placed',
        actorType: 'customer',
        actorId: customerId,
        message: null,
        fromStatus: null,
        toStatus: 'pending_payment',
      },
    });

    await this.announcePlaced(order);

    return order;
  }

  async listForCustomer(customerId: string, query: ListOrdersQuery): Promise<CursorPage<Order>> {
    return this.repository.list(this.pageOf(query), {
      customerId,
      status: query.status ?? null,
    });
  }

  async listAll(query: ListOrdersQuery): Promise<CursorPage<Order>> {
    return this.repository.list(this.pageOf(query), {
      customerId: query.customerId ?? null,
      status: query.status ?? null,
    });
  }

  async getForCustomer(customerId: string, id: string): Promise<OrderDetail> {
    const order = await this.repository.findForCustomer(customerId, id);

    if (order === null) {
      throw new NotFoundError('Order not found');
    }

    return order;
  }

  async getAsAgent(id: string): Promise<OrderDetail> {
    const order = await this.repository.findById(id);

    if (order === null) {
      throw new NotFoundError('Order not found');
    }

    return order;
  }

  /** A customer may only cancel, and only while the shop has not started shipping. */
  async cancel(customerId: string, id: string, input: CancelOrderInput): Promise<OrderDetail> {
    const order = await this.getForCustomer(customerId, id);

    return this.move(order, 'cancelled', input.reason ?? null, 'customer', customerId);
  }

  async changeStatus(id: string, input: ChangeStatusInput): Promise<OrderDetail> {
    const order = await this.getAsAgent(id);
    const principal = requestContext.requirePrincipal();

    return this.move(order, input.status, input.message ?? null, principal.actorType, principal.id);
  }

  async addNote(id: string, input: AddNoteInput): Promise<OrderDetail> {
    const principal = requestContext.requirePrincipal();

    const updated = await this.repository.addEvent(id, {
      id: this.ids.uuid(),
      type: 'note_added',
      actorType: principal.actorType,
      actorId: principal.id,
      message: input.message,
      fromStatus: null,
      toStatus: null,
    });

    if (updated === null) {
      throw new NotFoundError('Order not found');
    }

    return updated;
  }

  private async move(
    order: OrderDetail,
    to: OrderStatus,
    message: string | null,
    actorType: string,
    actorId: string,
  ): Promise<OrderDetail> {
    if (order.status === to) {
      throw new ConflictError(`This order is already ${to.replace('_', ' ')}`);
    }

    if (!canTransition(order.status, to)) {
      throw new ConflictError(`An order cannot go from ${order.status} to ${to}`);
    }

    if (to === 'cancelled' && actorType === 'customer' && order.status !== 'pending_payment') {
      // Once the shop has taken the money it also has a refund to run, a parcel to unpack and
      // a decision to make. That is a conversation, not a button.
      throw new ForbiddenError('Contact us to cancel an order that is already paid');
    }

    const patch: OrderPatch = { status: to, ...timestampFor(to, new Date()) };

    const event: NewOrderEvent = {
      id: this.ids.uuid(),
      type: 'status_changed',
      actorType,
      actorId,
      message,
      fromStatus: order.status,
      toStatus: to,
    };

    const updated = await this.repository.changeStatus(
      order.id,
      patch,
      event,
      releasesStock(order.status, to),
    );

    if (updated === null) {
      // The order was read a moment ago, so a miss here is not a missing row: somebody else
      // moved it in between, and the compare-and-set refused to write over their decision.
      throw new ConflictError('This order was modified meanwhile; read it again');
    }

    await this.announceStatus(updated, order.status);

    return updated;
  }

  private requireStillSellable(
    live: Map<string, SellableVariant>,
    variantId: string,
  ): SellableVariant {
    const variant = live.get(variantId);

    if (variant === undefined) {
      throw new ConflictError('An item in your cart is no longer available');
    }

    return variant;
  }

  private pageOf(query: ListOrdersQuery): CursorQuery {
    return { cursor: query.cursor, limit: query.limit, direction: query.direction };
  }

  private async announcePlaced(order: OrderDetail): Promise<void> {
    const email = await this.emailOf(order.customerId);

    await this.notifications.notify({
      recipient: { actorId: order.customerId, ...(email === null ? {} : { email }) },
      type: 'order.placed',
      title: this.i18n.translate('notification.order.placed.title'),
      body: this.i18n.translate('notification.order.placed.body', {
        reference: order.reference,
        total: this.money(order.totalCents, order.currency),
      }),
      data: { orderId: order.id, reference: order.reference },
      channels: ['in_app', 'email'],
    });

    // The back office is a room, not a list of recipients: whoever is signed in as an admin
    // right now sees the order appear, and nobody has to be looked up to make that happen.
    this.realtime.emitTo(rooms.role(ADMIN_ROLE), 'order.placed', {
      id: order.id,
      reference: order.reference,
      customerId: order.customerId,
      totalCents: order.totalCents,
      currency: order.currency,
      itemCount: order.items.length,
      placedAt: order.placedAt.toISOString(),
    });
  }

  private async announceStatus(order: OrderDetail, from: OrderStatus): Promise<void> {
    const email = await this.emailOf(order.customerId);

    await this.notifications.notify({
      recipient: { actorId: order.customerId, ...(email === null ? {} : { email }) },
      type: 'order.status',
      title: this.i18n.translate('notification.order.status.title'),
      body: this.i18n.translate('notification.order.status.body', {
        reference: order.reference,
        status: this.i18n.translate(`order.status.${order.status}`),
      }),
      data: { orderId: order.id, reference: order.reference, status: order.status },
      channels: ['in_app', 'email'],
    });

    this.realtime.emitTo(rooms.role(ADMIN_ROLE), 'order.status-changed', {
      id: order.id,
      reference: order.reference,
      fromStatus: from,
      toStatus: order.status,
    });
  }

  /**
   * The notification kit does not resolve an address from an actor id — it sends where it is
   * told. So the email is read here, and a customer whose account has since gone still gets
   * the in-app copy rather than losing the notification altogether.
   */
  private async emailOf(customerId: string): Promise<string | null> {
    return (await this.actors.findById(customerId))?.actor.email ?? null;
  }

  private money(cents: number, currency: string): string {
    return `${String(Math.round(cents / 100))} ${currency}`;
  }
}
