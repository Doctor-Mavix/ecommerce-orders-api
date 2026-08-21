import { sqlClientOf } from '@core/database';
import type { AppModule } from '@core/module';
import { AddressController } from './address.controller';
import { ADDRESS_REPOSITORY } from './customer.repository';
import { PrismaAddressRepository } from './sql/address.prisma.repository';

/**
 * The account itself belongs to the auth module — this one owns what a customer accumulates
 * around it. Today that is the address book; loyalty points or saved payment methods would
 * land here too.
 */
export const customerModule: AppModule = {
  name: 'customer',
  controllers: [AddressController],
  softDeleteModels: ['Address'],
  register({ container, adapter }) {
    container.registerInstance(
      ADDRESS_REPOSITORY,
      new PrismaAddressRepository(sqlClientOf(adapter)),
    );
  },
};
