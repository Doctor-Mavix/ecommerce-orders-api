import { inject } from 'tsyringe';

import { Controller, Delete, Get, Patch, Post, Public, Roles, Validate } from '@core/decorators';
import type { TypedRequest } from '@core/http/typed-request';
import { CatalogService } from './catalog.service';
import { createCategorySchema, idParamsSchema, updateCategorySchema } from './catalog.schemas';
import type { CreateCategoryInput, UpdateCategoryInput } from './catalog.schemas';
import type { Category } from './catalog.types';

interface IdParams {
  id: string;
}

/**
 * Reading the category tree is public — it is the navigation of the shop — and everything that
 * changes it belongs to the back office.
 */
@Controller('/categories')
export class CategoryController {
  constructor(@inject(CatalogService) private readonly service: CatalogService) {}

  @Get('/')
  @Public()
  async list(): Promise<Category[]> {
    return this.service.listCategories();
  }

  @Post('/')
  @Roles('admin')
  @Validate({ body: createCategorySchema })
  async create(req: TypedRequest<CreateCategoryInput>): Promise<Category> {
    return this.service.createCategory(req.body);
  }

  @Patch('/:id')
  @Roles('admin')
  @Validate({ params: idParamsSchema, body: updateCategorySchema })
  async update(req: TypedRequest<UpdateCategoryInput, unknown, IdParams>): Promise<Category> {
    return this.service.updateCategory(req.params.id, req.body);
  }

  @Delete('/:id')
  @Roles('admin')
  @Validate({ params: idParamsSchema })
  async remove(req: TypedRequest<unknown, unknown, IdParams>): Promise<void> {
    await this.service.removeCategory(req.params.id);
  }
}
