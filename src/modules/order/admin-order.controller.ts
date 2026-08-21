import { inject } from 'tsyringe';

import { Controller, Get, HttpCode, Post, Roles, Validate } from '@core/decorators';
import { ApiPayload } from '@core/http/api-response';
import { HttpStatus } from '@core/http/http-status';
import type { TypedRequest } from '@core/http/typed-request';
import {
  addNoteSchema,
  changeStatusSchema,
  listOrdersSchema,
  orderIdParamsSchema,
} from './order.schemas';
import type { AddNoteInput, ChangeStatusInput, ListOrdersQuery } from './order.schemas';
import { OrderService } from './order.service';
import type { Order, OrderDetail } from './order.types';

interface IdParams {
  id: string;
}

/**
 * The back office, on its own prefix rather than as extra branches inside the customer routes.
 * A separate controller means the authorisation of every route below is stated once, in the
 * decorator, instead of being re-derived from the principal in each handler.
 */
@Controller('/admin/orders')
@Roles('admin')
export class AdminOrderController {
  constructor(@inject(OrderService) private readonly service: OrderService) {}

  @Get('/')
  @Validate({ query: listOrdersSchema })
  async list(req: TypedRequest<unknown, ListOrdersQuery>): Promise<ApiPayload<Order[]>> {
    const page = await this.service.listAll(req.query);

    return ApiPayload.of(page.items, {
      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: req.query.limit },
    });
  }

  @Get('/:id')
  @Validate({ params: orderIdParamsSchema })
  async detail(req: TypedRequest<unknown, unknown, IdParams>): Promise<OrderDetail> {
    return this.service.getAsAgent(req.params.id);
  }

  @Post('/:id/status')
  @HttpCode(HttpStatus.OK)
  @Validate({ params: orderIdParamsSchema, body: changeStatusSchema })
  async changeStatus(
    req: TypedRequest<ChangeStatusInput, unknown, IdParams>,
  ): Promise<OrderDetail> {
    return this.service.changeStatus(req.params.id, req.body);
  }

  @Post('/:id/notes')
  @HttpCode(HttpStatus.OK)
  @Validate({ params: orderIdParamsSchema, body: addNoteSchema })
  async addNote(req: TypedRequest<AddNoteInput, unknown, IdParams>): Promise<OrderDetail> {
    return this.service.addNote(req.params.id, req.body);
  }
}
