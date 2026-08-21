import { inject, injectable } from 'tsyringe';

import { NotFoundError } from '@core/errors/app-error';
import { SHARED_TOKENS } from '@shared/tokens';
import type { IdService } from '@shared/utils-services/id.service';
import type { AddressRepository } from './customer.repository';
import { ADDRESS_REPOSITORY } from './customer.repository';
import type { CreateAddressInput, UpdateAddressInput } from './customer.schemas';
import type { Address } from './customer.types';

const orNull = <T>(value: T | undefined): T | null => value ?? null;

@injectable()
export class CustomerService {
  constructor(
    @inject(ADDRESS_REPOSITORY) private readonly addresses: AddressRepository,
    @inject(SHARED_TOKENS.Id) private readonly ids: IdService,
  ) {}

  async listAddresses(customerId: string): Promise<Address[]> {
    return this.addresses.listFor(customerId);
  }

  async getAddress(customerId: string, id: string): Promise<Address> {
    const address = await this.addresses.findFor(customerId, id);

    if (address === null) {
      throw new NotFoundError('Address not found');
    }

    return address;
  }

  async createAddress(customerId: string, input: CreateAddressInput): Promise<Address> {
    const existing = await this.addresses.listFor(customerId);

    return this.addresses.create({
      id: this.ids.uuid(),
      customerId,
      label: input.label,
      recipient: input.recipient,
      phone: input.phone,
      city: input.city,
      district: orNull(input.district),
      line1: input.line1,
      notes: orNull(input.notes),
      // The first address is the default whether the customer said so or not: checkout has to
      // have something to pre-select, and asking someone to tick a box on their only address
      // is a question with one possible answer.
      isDefault: input.isDefault ?? existing.length === 0,
    });
  }

  async updateAddress(customerId: string, id: string, input: UpdateAddressInput): Promise<Address> {
    const updated = await this.addresses.update(customerId, id, input);

    if (updated === null) {
      throw new NotFoundError('Address not found');
    }

    return updated;
  }

  async removeAddress(customerId: string, id: string): Promise<void> {
    if (!(await this.addresses.remove(customerId, id))) {
      throw new NotFoundError('Address not found');
    }
  }
}
