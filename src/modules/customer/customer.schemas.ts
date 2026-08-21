import { z } from 'zod';

/**
 * Deliveries in Benin are addressed by district and landmark rather than by street number, so
 * `line1` takes free text and `notes` exists for the "behind the pharmacy" a driver actually
 * needs. Only the fields a courier cannot do without are required.
 */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 .-]{6,19}$/, 'must be a phone number');

export const createAddressSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  recipient: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  city: z.string().trim().min(2).max(120),
  district: z.string().trim().min(1).max(120).optional(),
  line1: z.string().trim().min(3).max(240),
  notes: z.string().trim().min(1).max(500).optional(),
  isDefault: z.boolean().optional(),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(60),
    recipient: z.string().trim().min(2).max(120),
    phone: phoneSchema,
    city: z.string().trim().min(2).max(120),
    district: z.string().trim().min(1).max(120).nullable(),
    line1: z.string().trim().min(3).max(240),
    notes: z.string().trim().min(1).max(500).nullable(),
    isDefault: z.boolean(),
  })
  .partial();

export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;

export const addressIdParamsSchema = z.strictObject({ id: z.uuid() });
