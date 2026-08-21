import { inject, injectable } from 'tsyringe';

import type { CursorPage } from '@core/database/pagination';
import { ConflictError, NotFoundError } from '@core/errors/app-error';
import { requestContext } from '@core/http/request-context';
import type { MediaService, UploadedFile } from '@shared/media/media.service';
import type { Media, MediaUrls } from '@shared/media/media.types';
import { SHARED_TOKENS } from '@shared/tokens';
import type { IdService } from '@shared/utils-services/id.service';
import type { SlugService } from '@shared/utils-services/slug.service';
import type { CatalogRepository } from './catalog.repository';
import { CATALOG_REPOSITORY } from './catalog.repository';
import type {
  CreateCategoryInput,
  CreateProductInput,
  CreateVariantInput,
  ListProductsQuery,
  UpdateCategoryInput,
  UpdateProductInput,
  UpdateVariantInput,
} from './catalog.schemas';
import type {
  Category,
  Product,
  ProductDetail,
  ProductStatus,
  ProductVariant,
  SellableVariant,
} from './catalog.types';

/** Names the module in one place: the media owner type of every product image. */
const MODULE_NAME = 'product';

/** The role the back office runs under. A shopper is never one. */
const ADMIN_ROLE = 'admin';

const orNull = <T>(value: T | undefined): T | null => value ?? null;

export type ProductImage = Media & { urls: MediaUrls };

export interface ProductView extends ProductDetail {
  images: ProductImage[];
}

/**
 * All the business rules of the catalog. It talks to `CatalogRepository` only, and it is also
 * the seam the cart and the order modules go through — they call `sellable()` rather than
 * reaching into another module's tables, so extracting the catalog into its own service means
 * replacing this class with an HTTP client and nothing else.
 */
@injectable()
export class CatalogService {
  constructor(
    @inject(CATALOG_REPOSITORY) private readonly repository: CatalogRepository,
    @inject(SHARED_TOKENS.Media) private readonly media: MediaService,
    @inject(SHARED_TOKENS.Slug) private readonly slugs: SlugService,
    @inject(SHARED_TOKENS.Id) private readonly ids: IdService,
  ) {}

  async listCategories(): Promise<Category[]> {
    return this.repository.listCategories();
  }

  async createCategory(input: CreateCategoryInput): Promise<Category> {
    if (input.parentId !== undefined) {
      await this.requireCategory(input.parentId);
    }

    return this.repository.createCategory({
      id: this.ids.uuid(),
      slug: await this.resolveSlug(input.slug, input.name, (candidate) =>
        this.repository.categorySlugExists(candidate),
      ),
      name: input.name,
      description: orNull(input.description),
      parentId: orNull(input.parentId),
      position: input.position ?? 0,
    });
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<Category> {
    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === id) {
        throw new ConflictError('A category cannot be its own parent');
      }
      await this.requireCategory(input.parentId);
    }

    const updated = await this.repository.updateCategory(id, input);

    if (updated === null) {
      throw new NotFoundError('Category not found');
    }

    return updated;
  }

  /**
   * Removing a category that still holds products would leave those products pointing at
   * nothing a shopper can browse, so the shop is asked to move them first. The database says
   * the same thing through `onDelete: Restrict`, but only for a hard delete — this one is soft,
   * and a soft delete is an ordinary UPDATE the foreign key has no opinion about.
   */
  async removeCategory(id: string): Promise<void> {
    const products = await this.repository.countProductsIn(id);

    if (products > 0) {
      throw new ConflictError(
        `This category still holds ${String(products)} product(s); move them first`,
      );
    }

    if (!(await this.repository.removeCategory(id))) {
      throw new NotFoundError('Category not found');
    }
  }

  async listProducts(query: ListProductsQuery): Promise<CursorPage<Product>> {
    return this.repository.listProducts(
      { cursor: query.cursor, limit: query.limit, direction: query.direction },
      {
        categoryId: orNull(query.categoryId),
        status: this.visibleStatus(query.status),
        search: orNull(query.search),
      },
    );
  }

  /**
   * The public product page. Images are resolved here and nowhere else: presigning a URL is a
   * round trip to the storage, and doing it for every row of a list would be an N+1 nobody
   * notices until the catalogue grows.
   */
  async getBySlug(slug: string): Promise<ProductView> {
    const product = await this.repository.findProductBySlug(slug);

    if (product === null || !this.isVisible(product.status)) {
      // A draft answers exactly like a slug that was never used: whether a product is being
      // prepared is not something the shop publishes.
      throw new NotFoundError('Product not found');
    }

    return { ...product, images: await this.imagesOf(product.id) };
  }

  async getById(id: string): Promise<ProductDetail> {
    const product = await this.repository.findProductById(id);

    if (product === null) {
      throw new NotFoundError('Product not found');
    }

    return product;
  }

  async createProduct(input: CreateProductInput): Promise<ProductDetail> {
    const category = await this.requireCategory(input.categoryId);

    return this.repository.createProduct({
      id: this.ids.uuid(),
      slug: await this.resolveSlug(input.slug, input.name, (candidate) =>
        this.repository.productSlugExists(candidate),
      ),
      name: input.name,
      description: input.description,
      brand: orNull(input.brand),
      categoryId: category.id,
      // A product is born a draft: it has no variants yet, so publishing it on creation would
      // put something unbuyable in front of a shopper.
      status: input.status ?? 'draft',
      basePriceCents: input.basePriceCents,
      currency: input.currency ?? 'XOF',
    });
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<ProductDetail> {
    if (input.categoryId !== undefined) {
      await this.requireCategory(input.categoryId);
    }

    if (input.status === 'active') {
      const current = await this.getById(id);

      if (!current.variants.some((variant) => variant.isActive)) {
        throw new ConflictError('A product needs at least one active variant to be published');
      }
    }

    const updated = await this.repository.updateProduct(id, input);

    if (updated === null) {
      throw new NotFoundError('Product not found');
    }

    return updated;
  }

  async removeProduct(id: string): Promise<void> {
    if (!(await this.repository.removeProduct(id))) {
      throw new NotFoundError('Product not found');
    }
  }

  async addVariant(productId: string, input: CreateVariantInput): Promise<ProductVariant> {
    await this.getById(productId);

    return this.repository.createVariant({
      id: this.ids.uuid(),
      productId,
      sku: input.sku,
      name: input.name,
      priceCents: input.priceCents,
      stock: input.stock ?? 0,
      attributes: input.attributes ?? {},
      weightGrams: orNull(input.weightGrams),
      isActive: input.isActive ?? true,
    });
  }

  async updateVariant(
    productId: string,
    variantId: string,
    input: UpdateVariantInput,
  ): Promise<ProductVariant> {
    const updated = await this.repository.updateVariant(productId, variantId, input);

    if (updated === null) {
      throw new NotFoundError('Variant not found');
    }

    return updated;
  }

  async removeVariant(productId: string, variantId: string): Promise<void> {
    if (!(await this.repository.removeVariant(productId, variantId))) {
      throw new NotFoundError('Variant not found');
    }
  }

  /** Reading the product first means an upload against an unknown id stores nothing. */
  async addImage(productId: string, file: UploadedFile): Promise<Media> {
    await this.getById(productId);

    return this.media.upload(MODULE_NAME, productId, file);
  }

  async images(productId: string): Promise<ProductImage[]> {
    const product = await this.getById(productId);

    if (!this.isVisible(product.status)) {
      throw new NotFoundError('Product not found');
    }

    return this.imagesOf(productId);
  }

  /**
   * What the cart and the order modules buy against. Missing ids are simply absent from the
   * result — the caller decides whether that is a 404 or a line to drop, because "gone from
   * the catalogue" means something different in a cart than it does at checkout.
   */
  async sellable(variantIds: readonly string[]): Promise<Map<string, SellableVariant>> {
    const rows = await this.repository.findSellable(variantIds);

    return new Map(rows.map((row) => [row.variantId, row]));
  }

  private async imagesOf(productId: string): Promise<ProductImage[]> {
    const items = await this.media.listForOwner(MODULE_NAME, productId);

    return Promise.all(
      items.map(async (media) => ({ ...media, urls: await this.media.presign(media) })),
    );
  }

  private async requireCategory(id: string): Promise<Category> {
    const category = await this.repository.findCategoryById(id);

    if (category === null) {
      throw new NotFoundError('Category not found');
    }

    return category;
  }

  private async resolveSlug(
    requested: string | undefined,
    name: string,
    exists: (candidate: string) => Promise<boolean>,
  ): Promise<string> {
    if (requested !== undefined) {
      if (await exists(requested)) {
        throw new ConflictError(`The slug "${requested}" is already taken`);
      }

      return requested;
    }

    // Derived from the name and suffixed until it is free: two "Chemise en lin" are a normal
    // thing for a shop to sell, and neither of them should fail to be created because of it.
    return this.slugs.unique(name, exists);
  }

  /**
   * A shopper sees published products and nothing else, whatever they ask for. An agent may
   * filter by status, which is how the back office reaches drafts — the decision is taken from
   * the verified access token, never from the query string.
   */
  private visibleStatus(requested: ProductStatus | undefined): ProductStatus | null {
    if (!this.isAdmin()) {
      return 'active';
    }

    return orNull(requested);
  }

  private isVisible(status: ProductStatus): boolean {
    return status === 'active' || this.isAdmin();
  }

  private isAdmin(): boolean {
    return requestContext.principal()?.roles.includes(ADMIN_ROLE) ?? false;
  }
}
