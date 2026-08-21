import { sqlClientOf } from '@core/database';
import { ConfigurationError } from '@core/errors/app-error';
import type { AppModule } from '@core/module';
import { CATALOG_REPOSITORY } from '@modules/catalog/catalog.repository';
import { CART_REPOSITORY } from './cart.repository';
import { CartController } from './cart.controller';
import { PrismaCartRepository } from './sql/cart.prisma.repository';

/**
 * No `softDeleteModels`: a cart line that is removed is removed. Keeping the ghost of an item
 * somebody decided against would mean every read of the cart had to filter it out, for a
 * history nobody has ever asked to see.
 */
export const cartModule: AppModule = {
  name: 'cart',
  controllers: [CartController],
  register({ container, adapter }) {
    // The cart prices its lines from the catalogue. Without that module the failure would
    // otherwise surface as an unresolvable token the first time somebody adds an item.
    if (!container.isRegistered(CATALOG_REPOSITORY, true)) {
      throw new ConfigurationError(
        'The cart module needs the catalog module — add "catalog" to MODULES_ENABLED.',
      );
    }

    container.registerInstance(CART_REPOSITORY, new PrismaCartRepository(sqlClientOf(adapter)));
  },
};
