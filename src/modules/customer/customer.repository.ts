import type { InjectionToken } from 'tsyringe';

import type { Address } from './customer.types';

export interface NewAddress {
  id: string;
  customerId: string;
  label: string;
  recipient: string;
  phone: string;
  city: string;
  district: string | null;
  line1: string;
  notes: string | null;
  isDefault: boolean;
}

export interface AddressPatch {
  label?: string | undefined;
  recipient?: string | undefined;
  phone?: string | undefined;
  city?: string | undefined;
  district?: string | null | undefined;
  line1?: string | undefined;
  notes?: string | null | undefined;
  isDefault?: boolean | undefined;
}

export interface AddressRepository {
  /**
   * Every method is scoped by `customerId` rather than trusting the id in the URL. An id is
   * guessable in a way an ownership check is not, and "not yours" and "does not exist" should
   * be the same answer anyway.
   */
  create(data: NewAddress): Promise<Address>;
  listFor(customerId: string): Promise<Address[]>;
  findFor(customerId: string, id: string): Promise<Address | null>;
  update(customerId: string, id: string, patch: AddressPatch): Promise<Address | null>;
  /** Soft delete. False when the address was already gone. */
  remove(customerId: string, id: string): Promise<boolean>;
}

export const ADDRESS_REPOSITORY = Symbol('AddressRepository') as InjectionToken<AddressRepository>;
