import { z } from 'zod';

// Any 8-4-4-4-12 hex layout, exactly like the Postgres uuid type. Zod's .uuid()
// enforces RFC version/variant bits and would reject the md5-derived permanent
// mapping ids (md5('adelaide-wholesale-tyres:' || website_product_id)::uuid).
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const availabilityRequestSchema = z.object({
  items: z.array(z.object({ inventoryMappingId: uuid })).min(1).max(25),
}).strict();

export const reservationLineSchema = z.object({
  inventoryMappingId: uuid,
  quantity: z.number().int().positive().max(1000),
}).strict();

export const reserveRequestSchema = z.object({
  orderReference: z.string().trim().min(1).max(120),
  expiresAt: z.string().datetime({ offset: true }),
  items: z.array(reservationLineSchema).min(1).max(25),
}).strict();

export const releaseRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

export const commitRequestSchema = z.object({
  reservationId: uuid,
  orderReference: z.string().trim().min(1).max(120),
}).strict();

export const orderStateRequestSchema = z.object({
  reservationId: uuid,
  orderReference: z.string().trim().min(1).max(120),
  paymentStatus: z.enum(['pending', 'paid', 'cancelled', 'refunded', 'disputed']),
  orderStatus: z.enum(['pending', 'confirmed', 'cancelled', 'refunded', 'manual_review']),
  /** The website's durable commit request id, so both sides commit under one identity. */
  commitRequestId: uuid.optional(),
}).strict();
