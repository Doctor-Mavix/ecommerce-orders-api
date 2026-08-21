import type { AppModule } from '@core/module';
import { notificationModule } from '@shared/notifications/notification.module';
import { authModule } from './auth/auth.module';
import { cartModule } from './cart/cart.module';
import { catalogModule } from './catalog/catalog.module';
import { customerModule } from './customer/customer.module';
import { healthModule } from './health/health.module';
import { orderModule } from './order/order.module';

/**
 * Registration order matters: a module resolves the tokens the earlier ones registered.
 * Cart and order both read the catalog, and order reads the cart.
 */
export const APP_MODULES: readonly AppModule[] = [
  healthModule,
  notificationModule,
  authModule,
  customerModule,
  catalogModule,
  cartModule,
  orderModule,
];
