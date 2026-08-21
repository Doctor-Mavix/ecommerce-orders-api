import { inject } from 'tsyringe';

import {
  Consumes,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Public,
  Roles,
  Use,
  Validate,
} from '@core/decorators';
import { BadRequestError } from '@core/errors/app-error';
import { ApiPayload } from '@core/http/api-response';
import type { TypedRequest } from '@core/http/typed-request';
import type { Media } from '@shared/media/media.types';
import { singleFileUpload } from '@shared/media/upload.middleware';
import type { ProductImage, ProductView } from './catalog.service';
import { CatalogService } from './catalog.service';
import {
  createProductSchema,
  createVariantSchema,
  idParamsSchema,
  listProductsSchema,
  productIdParamsSchema,
  slugParamsSchema,
  updateProductSchema,
  updateVariantSchema,
  variantParamsSchema,
} from './catalog.schemas';
import type {
  CreateProductInput,
  CreateVariantInput,
  ListProductsQuery,
  UpdateProductInput,
  UpdateVariantInput,
} from './catalog.schemas';
import type { Product, ProductDetail, ProductVariant } from './catalog.types';

interface IdParams {
  id: string;
}

interface ProductIdParams {
  productId: string;
}

interface VariantParams {
  productId: string;
  variantId: string;
}

const IMAGE_FIELD = 'file';

/**
 * The storefront reads by slug, the back office writes by id. That is not decoration: a slug is
 * chosen for a URL and may be changed, while an id is what a cart line and an order point at
 * and must never move.
 */
@Controller('/products')
export class ProductController {
  constructor(@inject(CatalogService) private readonly service: CatalogService) {}

  @Get('/')
  @Public()
  @Validate({ query: listProductsSchema })
  async list(req: TypedRequest<unknown, ListProductsQuery>): Promise<ApiPayload<Product[]>> {
    const page = await this.service.listProducts(req.query);

    return ApiPayload.of(page.items, {
      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: req.query.limit },
    });
  }

  @Post('/')
  @Roles('admin')
  @Validate({ body: createProductSchema })
  async create(req: TypedRequest<CreateProductInput>): Promise<ProductDetail> {
    return this.service.createProduct(req.body);
  }

  /**
   * The back office reads a product it is still preparing, which has no published slug worth
   * knowing. Two segments, so it never collides with the storefront's `/:slug`.
   */
  @Get('/id/:id')
  @Roles('admin')
  @Validate({ params: idParamsSchema })
  async detailById(req: TypedRequest<unknown, unknown, IdParams>): Promise<ProductDetail> {
    return this.service.getById(req.params.id);
  }

  @Get('/:slug')
  @Public()
  @Validate({ params: slugParamsSchema })
  async detail(req: TypedRequest<unknown, unknown, { slug: string }>): Promise<ProductView> {
    return this.service.getBySlug(req.params.slug);
  }

  @Patch('/:id')
  @Roles('admin')
  @Validate({ params: idParamsSchema, body: updateProductSchema })
  async update(req: TypedRequest<UpdateProductInput, unknown, IdParams>): Promise<ProductDetail> {
    return this.service.updateProduct(req.params.id, req.body);
  }

  @Delete('/:id')
  @Roles('admin')
  @Validate({ params: idParamsSchema })
  async remove(req: TypedRequest<unknown, unknown, IdParams>): Promise<void> {
    await this.service.removeProduct(req.params.id);
  }

  @Post('/:productId/variants')
  @Roles('admin')
  @Validate({ params: productIdParamsSchema, body: createVariantSchema })
  async addVariant(
    req: TypedRequest<CreateVariantInput, unknown, ProductIdParams>,
  ): Promise<ProductVariant> {
    return this.service.addVariant(req.params.productId, req.body);
  }

  @Patch('/:productId/variants/:variantId')
  @Roles('admin')
  @Validate({ params: variantParamsSchema, body: updateVariantSchema })
  async updateVariant(
    req: TypedRequest<UpdateVariantInput, unknown, VariantParams>,
  ): Promise<ProductVariant> {
    return this.service.updateVariant(req.params.productId, req.params.variantId, req.body);
  }

  @Delete('/:productId/variants/:variantId')
  @Roles('admin')
  @Validate({ params: variantParamsSchema })
  async removeVariant(req: TypedRequest<unknown, unknown, VariantParams>): Promise<void> {
    await this.service.removeVariant(req.params.productId, req.params.variantId);
  }

  /**
   * Multipart, so `@Validate` cannot see the body: multer parses it and the file itself is
   * validated by its magic bytes in the media kit rather than by a trusted Content-Type header.
   */
  @Post('/:productId/images')
  @Roles('admin')
  @Consumes('multipart/form-data')
  @Use(singleFileUpload(IMAGE_FIELD))
  @Validate({ params: productIdParamsSchema })
  async addImage(req: TypedRequest<unknown, unknown, ProductIdParams>): Promise<Media> {
    const file = req.file;

    if (file === undefined) {
      throw new BadRequestError(`A file is required under the "${IMAGE_FIELD}" field`);
    }

    return this.service.addImage(req.params.productId, file);
  }

  @Get('/:productId/images')
  @Public()
  @Validate({ params: productIdParamsSchema })
  async images(req: TypedRequest<unknown, unknown, ProductIdParams>): Promise<ProductImage[]> {
    return this.service.images(req.params.productId);
  }
}
