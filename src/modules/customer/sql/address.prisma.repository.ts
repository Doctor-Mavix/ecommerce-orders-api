import { Prisma } from '@prisma-client';
import type { Address as AddressRow } from '@prisma-client';

import { definedOnly } from '@core/database/sql/patch';
import type { SqlClient } from '@core/database/sql/prisma.adapter';
import type { AddressPatch, AddressRepository, NewAddress } from '../customer.repository';
import type { Address } from '../customer.types';

const RECORD_NOT_FOUND = 'P2025';

function toAddress(row: AddressRow): Address {
  return {
    id: row.id,
    customerId: row.customerId,
    label: row.label,
    recipient: row.recipient,
    phone: row.phone,
    city: row.city,
    district: row.district,
    line1: row.line1,
    notes: row.notes,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function errorCodeOf(error: unknown): string | undefined {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

/**
 * "At most one default address per customer" is not a constraint the schema can carry — a
 * partial unique index on `is_default` cannot be expressed in the Prisma schema — so it is held
 * by writing both halves of the change in one transaction. Between two separate statements, a
 * list read would show a customer with two default addresses, or with none.
 */
export class PrismaAddressRepository implements AddressRepository {
  constructor(private readonly client: SqlClient) {}

  async create(data: NewAddress): Promise<Address> {
    if (!data.isDefault) {
      return toAddress(await this.client.address.create({ data }));
    }

    return this.client.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { customerId: data.customerId, isDefault: true },
        data: { isDefault: false },
      });

      return toAddress(await tx.address.create({ data }));
    });
  }

  async listFor(customerId: string): Promise<Address[]> {
    const rows = await this.client.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map(toAddress);
  }

  async findFor(customerId: string, id: string): Promise<Address | null> {
    // Scoped by customerId, not only by id: an address belongs to whoever created it, and a
    // row that is not theirs must read exactly like a row that does not exist.
    const row = await this.client.address.findFirst({ where: { id, customerId } });

    return row === null ? null : toAddress(row);
  }

  async update(customerId: string, id: string, patch: AddressPatch): Promise<Address | null> {
    const data = definedOnly(patch);

    try {
      if (patch.isDefault !== true) {
        return toAddress(await this.client.address.update({ where: { id, customerId }, data }));
      }

      return await this.client.$transaction(async (tx) => {
        await tx.address.updateMany({
          where: { customerId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });

        return toAddress(await tx.address.update({ where: { id, customerId }, data }));
      });
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  async remove(customerId: string, id: string): Promise<boolean> {
    try {
      // The extension already scopes this update to a row that is still alive, so deleting
      // twice raises P2025 instead of silently touching a dead row.
      await this.client.address.update({
        where: { id, customerId },
        data: { deletedAt: new Date() },
      });

      return true;
    } catch (error) {
      if (errorCodeOf(error) === RECORD_NOT_FOUND) {
        return false;
      }
      throw error;
    }
  }
}
