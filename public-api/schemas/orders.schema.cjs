'use strict';

const { z } = require('zod');

const orderItemSchema = z.object({
  product_id: z.union([z.string(), z.number()]).transform(String),
  quantity: z.union([z.number(), z.string()]).transform((v) => Number.parseInt(String(v), 10)),
});

const createOrderBodySchema = z
  .object({
    items: z.array(orderItemSchema).min(1),
    payment_method: z.enum(['payme', 'click', 'cash']),
    delivery_method: z.string().optional(),
    delivery_address: z.string().optional(),
    phone: z.string().min(1),
    note: z.string().optional().nullable(),
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
      })
      .optional()
      .nullable(),
    promo_code: z.string().optional().nullable(),
    loyalty_points: z.union([z.number(), z.string()]).optional().nullable(),
  })
  .passthrough();

const orderIdParamsSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => Number.parseInt(String(v), 10)),
});

const ratingBodySchema = z.object({
  rating: z.union([z.number(), z.string()]).transform((v) => Number.parseInt(String(v), 10)),
  feedback: z.string().max(1000).optional().nullable(),
});

module.exports = {
  createOrderBodySchema,
  orderIdParamsSchema,
  ratingBodySchema,
};
