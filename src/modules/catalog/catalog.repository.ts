import type { InjectionToken } from 'tsyringe';

import type { CursorPage, CursorQuery } from '@core/database/pagination';
import type {
  Category,
  Product,
  ProductDetail,
  ProductStatus,
  ProductVariant,
  SellableVariant,
  VariantAttributes,
} from './catalog.types';

/** Complete rows, as the service hands them to a repository. Identity is domain-owned. */
export interface NewCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  position: number;
}

/**
 * Only the fields an update may touch. `| undefined` is spelled out on every one of them:
 * `exactOptionalPropertyTypes` makes an absent key and an explicit `undefined` two different
 * types, and these patches are built by spreading a Zod `.partial()` body, which produces the
 * second.
 */
export interface CategoryPatch {
  slug?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  parentId?: string | null | undefined;
  position?: number | undefined;
}

export interface NewProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  brand: string | null;
  categoryId: string;
  status: ProductStatus;
  basePriceCents: number;
  currency: string;
}

export interface ProductPatch {
  slug?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  brand?: string | null | undefined;
  categoryId?: string | undefined;
  status?: ProductStatus | undefined;
  basePriceCents?: number | undefined;
  currency?: string | undefined;
}

export interface NewVariant {
  id: string;
  productId: string;
  sku: string;
  name: string;
  priceCents: number;
  stock: number;
  attributes: VariantAttributes;
  weightGrams: number | null;
  isActive: boolean;
}

export interface VariantPatch {
  name?: string | undefined;
  priceCents?: number | undefined;
  stock?: number | undefined;
  attributes?: VariantAttributes | undefined;
  weightGrams?: number | null | undefined;
  isActive?: boolean | undefined;
}

export interface ProductFilter {
  categoryId: string | null;
  status: ProductStatus | null;
  search: string | null;
}

export interface CatalogRepository {
  createCategory(data: NewCategory): Promise<Category>;
  /**
   * No cursor, deliberately. A shop has tens of categories and a navigation menu needs all of
   * them at once; paginating that would make every client reassemble the tree page by page.
   */
  listCategories(): Promise<Category[]>;
  findCategoryById(id: string): Promise<Category | null>;
  categorySlugExists(slug: string): Promise<boolean>;
  updateCategory(id: string, patch: CategoryPatch): Promise<Category | null>;
  /** Soft delete. False when the category was already gone. */
  removeCategory(id: string): Promise<boolean>;
  /** Refuses to orphan a catalog: a category still holding products cannot be removed. */
  countProductsIn(categoryId: string): Promise<number>;

  createProduct(data: NewProduct): Promise<ProductDetail>;
  listProducts(query: CursorQuery, filter: ProductFilter): Promise<CursorPage<Product>>;
  findProductById(id: string): Promise<ProductDetail | null>;
  findProductBySlug(slug: string): Promise<ProductDetail | null>;
  productSlugExists(slug: string): Promise<boolean>;
  updateProduct(id: string, patch: ProductPatch): Promise<ProductDetail | null>;
  removeProduct(id: string): Promise<boolean>;

  createVariant(data: NewVariant): Promise<ProductVariant>;
  updateVariant(
    productId: string,
    variantId: string,
    patch: VariantPatch,
  ): Promise<ProductVariant | null>;
  /** Hard delete: a variant carries no `deletedAt`, and past orders snapshot what they sold. */
  removeVariant(productId: string, variantId: string): Promise<boolean>;

  /**
   * The read the cart and the order modules depend on. Returns a row only when the variant is
   * active and its product is published, so "not sellable" and "does not exist" are the same
   * answer — a shopper has no business telling the two apart.
   */
  findSellable(variantIds: readonly string[]): Promise<SellableVariant[]>;
}

/**
 * Module-local token: the catalog can be lifted into its own service without dragging a
 * core-wide token registry along with it.
 */
export const CATALOG_REPOSITORY = Symbol('CatalogRepository') as InjectionToken<CatalogRepository>;
