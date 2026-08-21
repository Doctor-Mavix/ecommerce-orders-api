import { inject } from 'tsyringe';

import { Controller, Get, HttpCode, Post, Validate } from '@core/decorators';
import { ApiPayload } from '@core/http/api-response';
import { HttpStatus } from '@core/http/http-status';
import type { TypedRequest } from '@core/http/typed-request';
import { requireCustomerId } from '@modules/customer/customer.principal';
import {
  cancelOrderSchema,
  checkoutSchema,
  listOrdersSchema,
  orderIdParamsSchema,
} from './order.schemas';
import type { CancelOrderInput, CheckoutInput, ListOrdersQuery } from './order.schemas';
import { OrderService } from './order.service';
import type { Order, OrderDetail } from './order.types';

interface IdParams {
  id: string;
}

/**
 * The customer's own orders. There is no customer id in any path here either: an order that is
 * not this customer's answers 404 rather than 403, so the endpoint cannot be used to find out
 * which order references exist.
 */
@Controller('/orders')
export class OrderController {
  constructor(@inject(OrderService) private readonly service: OrderService) {}

  @Post('/')
  @Validate({ body: checkoutSchema })
  async checkout(req: TypedRequest<CheckoutInput>): Promise<OrderDetail> {
    return this.service.checkout(requireCustomerId(), req.body);
  }

  @Get('/')
  @Validate({ query: listOrdersSchema })
  async list(req: TypedRequest<unknown, ListOrdersQuery>): Promise<ApiPayload<Order[]>> {
    const page = await this.service.listForCustomer(requireCustomerId(), req.query);

    return ApiPayload.of(page.items, {
      meta: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: req.query.limit },
    });
  }

  @Get('/:id')
  @Validate({ params: orderIdParamsSchema })
  async detail(req: TypedRequest<unknown, unknown, IdParams>): Promise<OrderDetail> {
    return this.service.getForCustomer(requireCustomerId(), req.params.id);
  }

  @Post('/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Validate({ params: orderIdParamsSchema, body: cancelOrderSchema })
  async cancel(req: TypedRequest<CancelOrderInput, unknown, IdParams>): Promise<OrderDetail> {
    return this.service.cancel(requireCustomerId(), req.params.id, req.body);
  }
}
