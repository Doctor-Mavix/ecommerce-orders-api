import { sqlClientOf } from '@core/database';
import type { AppModule } from '@core/module';
import { CATALOG_REPOSITORY } from './catalog.repository';
import { CategoryController } from './category.controller';
import { ProductController } from './product.controller';
import { PrismaCatalogRepository } from './sql/catalog.prisma.repository';

/**
 * `Product` and `Category` carry a `deletedAt`: a shop stops selling things far more often
 * than it truly erases them, and an order line placed last year still has to name what it
 * pointed at. `ProductVariant` deliberately does not — an order snapshots its own labels,
 * so a variant is either sellable or deactivated, never a ghost row.
 */
export const catalogModule: AppModule = {
  name: 'catalog',
  controllers: [CategoryController, ProductController],
  softDeleteModels: ['Product', 'Category'],
  register({ container, adapter }) {
    container.registerInstance(
      CATALOG_REPOSITORY,
      new PrismaCatalogRepository(sqlClientOf(adapter)),
    );
  },
};
