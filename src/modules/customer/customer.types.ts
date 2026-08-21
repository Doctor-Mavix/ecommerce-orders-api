/**
 * A delivery address, as the customer keeps it. An order does not reference one of these: it
 * copies the fields at checkout, so editing or deleting an address never changes where a past
 * order was sent. `ShippingDetails` is that copied shape, shared with the order module.
 */
export interface Address {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface ShippingDetails {
  recipient: string;
  phone: string;
  city: string;
  district: string | null;
  line1: string;
  notes: string | null;
}

export function shippingDetailsOf(address: Address): ShippingDetails {
  return {
    recipient: address.recipient,
    phone: address.phone,
    city: address.city,
    district: address.district,
    line1: address.line1,
    notes: address.notes,
  };
}
