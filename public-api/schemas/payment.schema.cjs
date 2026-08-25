'use strict';

const { z } = require('zod');

const paymentCreateBodySchema = z.object({
  order_id: z.union([z.number(), z.string()]).transform((v) => Number.parseInt(String(v), 10)),
  return_url: z.string().optional().nullable(),
});

const paymentOrderIdParamsSchema = z.object({
  orderId: z.union([z.number(), z.string()]).transform((v) => Number.parseInt(String(v), 10)),
});

module.exports = {
  paymentCreateBodySchema,
  paymentOrderIdParamsSchema,
};
