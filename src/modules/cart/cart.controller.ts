import { inject } from 'tsyringe';

import { Controller, Delete, Get, HttpCode, Patch, Post, Validate } from '@core/decorators';
import { HttpStatus } from '@core/http/http-status';
import type { TypedRequest } from '@core/http/typed-request';
import { requireCustomerId } from '@modules/customer/customer.principal';
import { addCartItemSchema, setQuantitySchema, variantIdParamsSchema } from './cart.schemas';
import type { AddCartItemInput, SetQuantityInput } from './cart.schemas';
import { CartService } from './cart.service';
import type { CartView } from './cart.types';

interface VariantParams {
  variantId: string;
}

/**
 * The cart belongs to the signed-in customer and to nobody else, so there is no cart id in any
 * path: it is derived from the access token. Every route answers with the whole cart, because
 * a client that changed one line still has to redraw the totals and the availability of the
 * rest — and a second round trip to learn that is a round trip nobody needs.
 */
@Controller('/cart')
export class CartController {
  constructor(@inject(CartService) private readonly service: CartService) {}

  @Get('/')
  async view(): Promise<CartView> {
    return this.service.view(requireCustomerId());
  }

  @Post('/items')
  @HttpCode(HttpStatus.OK)
  @Validate({ body: addCartItemSchema })
  async addItem(req: TypedRequest<AddCartItemInput>): Promise<CartView> {
    return this.service.addItem(requireCustomerId(), req.body);
  }

  @Patch('/items/:variantId')
  @Validate({ params: variantIdParamsSchema, body: setQuantitySchema })
  async setQuantity(
    req: TypedRequest<SetQuantityInput, unknown, VariantParams>,
  ): Promise<CartView> {
    return this.service.setQuantity(requireCustomerId(), req.params.variantId, req.body);
  }

  @Delete('/items/:variantId')
  @HttpCode(HttpStatus.OK)
  @Validate({ params: variantIdParamsSchema })
  async removeItem(req: TypedRequest<unknown, unknown, VariantParams>): Promise<CartView> {
    return this.service.removeItem(requireCustomerId(), req.params.variantId);
  }

  @Delete('/')
  @HttpCode(HttpStatus.OK)
  async clear(): Promise<CartView> {
    return this.service.clear(requireCustomerId());
  }
}
