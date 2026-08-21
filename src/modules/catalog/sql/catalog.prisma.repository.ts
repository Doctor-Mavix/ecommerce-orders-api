import { Prisma } from '@prisma-client';
import type {
  Category as CategoryRow,
  Product as ProductRow,
  ProductVariant as VariantRow,
} from '@prisma-client';

import type { CursorPage, CursorQuery } from '@core/database/pagination';
import { buildCursorPage } from '@core/database/pagination';
import { definedOnly } from '@core/database/sql/patch';
import type { SqlClient } from '@core/database/sql/prisma.adapter';
import { ConflictError } from '@core/errors/app-error';
import type {
  CatalogRepository,
  CategoryPatch,
  NewCategory,
  NewProduct,
  NewVariant,
  ProductFilter,
  ProductPatch,
  VariantPatch,
} from '../catalog.repository';
import type {
  Category,
  Product,
  ProductDetail,
  ProductVariant,
  SellableVariant,
  VariantAttributes,
} from '../catalog.types';

/** Prisma error codes: https://www.prisma.io/docs/orm/reference/error-reference */
const UNIQUE_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';
const FOREIGN_KEY_VIOLATION = 'P2003';

const DETAIL = {
  category: true,
  variants: { orderBy: { createdAt: 'asc' } },
} as const;

type DetailRow = ProductRow & { category: CategoryRow; variants: VariantRow[] };

function errorCodeOf(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

/**
 * A unique violation is a client mistake, not a server fault: two products cannot share a slug
 * and two variants cannot share a SKU. Naming the field is what turns a 409 into something the
 * caller can act on. Anything else is handed back untouched.
 */
function domainError(error: unknown, subject: string): Error {
  if (errorCodeOf(error) === UNIQUE_VIOLATION) {
    // `meta` is typed as an open record, so the target is narrowed rather than stringified:
    // Prisma sends an array of column names for Postgres, but the shape is driver-dependent.
    const target: unknown = (error as Prisma.PrismaClientKnownRequestError).meta?.['target'];
    const fields = Array.isArray(target)
      ? target.filter((name): name is string => typeof name === 'string').join(', ')
      : typeof target === 'string'
        ? target
        : 'a unique field';

    return new ConflictError(`Another ${subject} already uses this ${fields}`, { cause: error });
  }

  return error instanceof Error ? error : new Error(String(error));
}

/**
 * `attributes` is a JSON column, so Prisma types it as `JsonValue` — anything at all. Narrowing
 * it here is what stops that `unknown`-shaped value from reaching the service: the domain says
 * a string map, and a row that says otherwise loses the entries that do not fit rather than
 * handing a caller a shape their types promised could not happen.
 */
function toAttributes(value: Prisma.JsonValue): VariantAttributes {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'string' ? [[key, entry] as const] : [],
    ),
  );
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    parentId: row.parentId,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVariant(row: VariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    priceCents: row.priceCents,
    stock: row.stock,
    attributes: toAttributes(row.attributes),
    weightGrams: row.weightGrams,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    brand: row.brand,
    categoryId: row.categoryId,
    status: row.status,
    basePriceCents: row.basePriceCents,
    currency: row.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: DetailRow): ProductDetail {
  return {
    ...toProduct(row),
    category: toCategory(row.category),
    variants: row.variants.map(toVariant),
  };
}

/** Keyset predicate: everything strictly after (or before) the last row of the previous page. */
function cursorWhere(query: CursorQuery): Prisma.ProductWhereInput | undefined {
  if (query.cursor === null) {
    return undefined;
  }

  const createdAt = new Date(query.cursor.value);
  const ascending = query.direction === 'asc';
  const bound = ascending ? { gt: createdAt } : { lt: createdAt };
  const idBound = ascending ? { gt: query.cursor.id } : { lt: query.cursor.id };

  // The tie-break on id is what keeps rows sharing a createdAt from being skipped or repeated.
  return { OR: [{ createdAt: bound }, { createdAt, id: idBound }] };
}

/**
 * SQL implementation. Soft delete and the `deletedAt IS NULL` scoping are not written here for
 * the models the extension knows about — with one exception, marked below: the extension
 * rewrites the top-level `where` of a query, and a filter that reaches a soft-deletable model
 * *through a relation* is outside its reach.
 */
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly client: SqlClient) {}

  async createCategory(data: NewCategory): Promise<Category> {
    try {
      return toCategory(await this.client.category.create({ data }));
    } catch (error) {
      throw domainError(error, 'category');
    }
  }

  async listCategories(): Promise<Category[]> {
    const rows = await this.client.category.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });

    return rows.map(toCategory);
  }

  async findCategoryById(id: string): Promise<Category | null> {
    // findFirst rather than findUnique: the extension adds `deletedAt: null` to the filter,
    // which findUnique refuses because it only accepts unique fields.
    const row = await this.client.category.findFirst({ where: { id } });

    return row === null ? null : toCategory(row);
  }

  async categorySlugExists(slug: string): Promise<boolean> {
    return this.slugTaken('categories', slug);
  }

  async updateCategory(id: string, patch: CategoryPatch): Promise<Category | null> {
    try {
      return toCategory(
        await this.client.category.update({ where: { id }, data: definedOnly(patch) }),
      );
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return null;
      }
      throw domainError(error, 'category');
    }
  }

  async removeCategory(id: string): Promise<boolean> {
    try {
      await this.client.category.update({ where: { id }, data: { deletedAt: new Date() } });

      return true;
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return false;
      }
      throw error;
    }
  }

  async countProductsIn(categoryId: string): Promise<number> {
    return this.client.product.count({ where: { categoryId } });
  }

  async createProduct(data: NewProduct): Promise<ProductDetail> {
    try {
      return toDetail(await this.client.product.create({ data, include: DETAIL }));
    } catch (error) {
      throw domainError(error, 'product');
    }
  }

  async listProducts(query: CursorQuery, filter: ProductFilter): Promise<CursorPage<Product>> {
    const rows = await this.client.product.findMany({
      where: {
        ...(filter.categoryId === null ? {} : { categoryId: filter.categoryId }),
        ...(filter.status === null ? {} : { status: filter.status }),
        ...(filter.search === null
          ? {}
          : {
              // Two columns, one term. `mode: 'insensitive'` is a PostgreSQL ILIKE; this is a
              // shop catalogue of a few thousand rows, not a search engine, and pretending
              // otherwise would mean shipping one alongside the API.
              OR: [
                { name: { contains: filter.search, mode: 'insensitive' as const } },
                { brand: { contains: filter.search, mode: 'insensitive' as const } },
              ],
            }),
        ...cursorWhere(query),
      },
      orderBy: [{ createdAt: query.direction }, { id: query.direction }],
      // One row more than asked, so `hasMore` costs no extra query.
      take: query.limit + 1,
    });

    return buildCursorPage(rows.map(toProduct), query.limit, (item) => ({
      value: item.createdAt.toISOString(),
      id: item.id,
    }));
  }

  async findProductById(id: string): Promise<ProductDetail | null> {
    const row = await this.client.product.findFirst({ where: { id }, include: DETAIL });

    return row === null ? null : toDetail(row);
  }

  async findProductBySlug(slug: string): Promise<ProductDetail | null> {
    const row = await this.client.product.findFirst({ where: { slug }, include: DETAIL });

    return row === null ? null : toDetail(row);
  }

  async productSlugExists(slug: string): Promise<boolean> {
    return this.slugTaken('products', slug);
  }

  async updateProduct(id: string, patch: ProductPatch): Promise<ProductDetail | null> {
    try {
      return toDetail(
        await this.client.product.update({
          where: { id },
          data: definedOnly(patch),
          include: DETAIL,
        }),
      );
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return null;
      }
      throw domainError(error, 'product');
    }
  }

  async removeProduct(id: string): Promise<boolean> {
    try {
      await this.client.product.update({ where: { id }, data: { deletedAt: new Date() } });

      return true;
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return false;
      }
      throw error;
    }
  }

  async createVariant(data: NewVariant): Promise<ProductVariant> {
    try {
      return toVariant(await this.client.productVariant.create({ data }));
    } catch (error) {
      throw domainError(error, 'variant');
    }
  }

  async updateVariant(
    productId: string,
    variantId: string,
    patch: VariantPatch,
  ): Promise<ProductVariant | null> {
    try {
      // The productId in the filter is not redundant: it is what makes the nested route mean
      // what it reads as, so a variant id from another product cannot be edited through it.
      return toVariant(
        await this.client.productVariant.update({
          where: { id: variantId, productId },
          data: definedOnly(patch),
        }),
      );
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return null;
      }
      throw domainError(error, 'variant');
    }
  }

  async removeVariant(productId: string, variantId: string): Promise<boolean> {
    try {
      await this.client.productVariant.delete({ where: { id: variantId, productId } });

      return true;
    } catch (error) {
      const code = errorCodeOf(error);

      if (code === RECORD_NOT_FOUND) {
        return false;
      }
      if (code === FOREIGN_KEY_VIOLATION) {
        // `onDelete: Restrict` on order lines. Deleting a variant somebody has already bought
        // would rewrite an invoice, so the database refuses and the shop archives instead.
        throw new ConflictError(
          'This variant has already been ordered; deactivate it instead of deleting it',
          { cause: error },
        );
      }
      throw error;
    }
  }

  async findSellable(variantIds: readonly string[]): Promise<SellableVariant[]> {
    if (variantIds.length === 0) {
      return [];
    }

    const rows = await this.client.productVariant.findMany({
      where: {
        id: { in: [...variantIds] },
        isActive: true,
        // `deletedAt: null` is written by hand here. The soft-delete extension rewrites the
        // top-level `where` of the model being queried, and this one queries variants, which
        // carry no `deletedAt` — the filter on the product is a relation filter the extension
        // never sees. Leaving it out would keep selling a deleted product.
        product: { status: 'active', deletedAt: null },
      },
      include: { product: true },
    });

    return rows.map((row) => ({
      variantId: row.id,
      productId: row.productId,
      sku: row.sku,
      productName: row.product.name,
      variantName: row.name,
      priceCents: row.priceCents,
      stock: row.stock,
      currency: row.product.currency,
    }));
  }

  /**
   * Counts rows the soft-delete extension hides. A `slug` column is unique across the whole
   * table, deleted rows included, so a check that only sees live rows reports a taken slug as
   * free and the insert fails on the index instead. Raw SQL is what steps around the extension;
   * the alternative — a partial unique index on `deleted_at IS NULL` — cannot be expressed in
   * the Prisma schema and would show up as permanent migration drift.
   */
  private async slugTaken(table: 'categories' | 'products', slug: string): Promise<boolean> {
    const rows =
      table === 'categories'
        ? await this.client.$queryRaw<
            { taken: boolean }[]
          >`SELECT EXISTS (SELECT 1 FROM "categories" WHERE "slug" = ${slug}) AS taken`
        : await this.client.$queryRaw<
            { taken: boolean }[]
          >`SELECT EXISTS (SELECT 1 FROM "products" WHERE "slug" = ${slug}) AS taken`;

    return rows[0]?.taken ?? false;
  }
}
