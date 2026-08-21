import { inject } from 'tsyringe';

import { Controller, Delete, Get, Patch, Post, Validate } from '@core/decorators';
import type { TypedRequest } from '@core/http/typed-request';
import { requireCustomerId } from './customer.principal';
import {
  addressIdParamsSchema,
  createAddressSchema,
  updateAddressSchema,
} from './customer.schemas';
import type { CreateAddressInput, UpdateAddressInput } from './customer.schemas';
import { CustomerService } from './customer.service';
import type { Address } from './customer.types';

interface IdParams {
  id: string;
}

/**
 * No route is `@Public()`: an address book belongs to one account. There is no id in any path
 * that identifies the customer either — it is read from the verified access token, so a caller
 * cannot list somebody else's addresses by changing a number in the URL.
 */
@Controller('/me/addresses')
export class AddressController {
  constructor(@inject(CustomerService) private readonly service: CustomerService) {}

  @Get('/')
  async list(): Promise<Address[]> {
    return this.service.listAddresses(requireCustomerId());
  }

  @Post('/')
  @Validate({ body: createAddressSchema })
  async create(req: TypedRequest<CreateAddressInput>): Promise<Address> {
    return this.service.createAddress(requireCustomerId(), req.body);
  }

  @Get('/:id')
  @Validate({ params: addressIdParamsSchema })
  async detail(req: TypedRequest<unknown, unknown, IdParams>): Promise<Address> {
    return this.service.getAddress(requireCustomerId(), req.params.id);
  }

  @Patch('/:id')
  @Validate({ params: addressIdParamsSchema, body: updateAddressSchema })
  async update(req: TypedRequest<UpdateAddressInput, unknown, IdParams>): Promise<Address> {
    return this.service.updateAddress(requireCustomerId(), req.params.id, req.body);
  }

  @Delete('/:id')
  @Validate({ params: addressIdParamsSchema })
  async remove(req: TypedRequest<unknown, unknown, IdParams>): Promise<void> {
    await this.service.removeAddress(requireCustomerId(), req.params.id);
  }
}
