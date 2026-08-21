import type { InjectionToken } from 'tsyringe';

import { sqlClientOf } from '@core/database';
import { ConfigurationError } from '@core/errors/app-error';
import type { AppModule } from '@core/module';
import { CART_REPOSITORY } from '@modules/cart/cart.repository';
import { CATALOG_REPOSITORY } from '@modules/catalog/catalog.repository';
import { ADDRESS_REPOSITORY } from '@modules/customer/customer.repository';
import { NOTIFICATION_SERVICE } from '@shared/notifications/notification.tokens';
import { AdminOrderController } from './admin-order.controller';
import { OrderController } from './order.controller';
import { ORDER_REPOSITORY } from './order.repository';
import { PrismaOrderRepository } from './sql/order.prisma.repository';

const REQUIRED: readonly (readonly [string, InjectionToken<unknown>])[] = [
  ['catalog', CATALOG_REPOSITORY],
  ['cart', CART_REPOSITORY],
  ['customer', ADDRESS_REPOSITORY],
  ['notifications', NOTIFICATION_SERVICE],
];

/**
 * No `softDeleteModels`: an order is the shop's accounting record. Hiding one from a query is
 * how a month's takings stop adding up, and a customer who wants an order gone is asking for a
 * cancellation, which the status machine already has a name for.
 */
export const orderModule: AppModule = {
  name: 'order',
  controllers: [OrderController, AdminOrderController],
  register({ container, adapter }) {
    for (const [name, token] of REQUIRED) {
      if (!container.isRegistered(token, true)) {
        throw new ConfigurationError(
          `The order module needs the ${name} module — add "${name}" to MODULES_ENABLED.`,
        );
      }
    }

    container.registerInstance(ORDER_REPOSITORY, new PrismaOrderRepository(sqlClientOf(adapter)));
  },
};
