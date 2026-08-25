'use strict';

const { z } = require('zod');

const adminLoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const adminRefreshBodySchema = z.object({
  refresh_token: z.string().min(1).optional(),
});

const adminLogoutBodySchema = z.object({
  refresh_token: z.string().optional().nullable(),
});

const adminOrderStatusPatchBodySchema = z.object({
  status: z.string().min(1),
});

const adminProductPatchBodySchema = z
  .object({
    name: z.string().optional(),
    sale_price: z.union([z.number(), z.string()]).optional(),
    is_active: z.union([z.boolean(), z.number()]).optional(),
  })
  .passthrough();

const adminProductVisibilityPatchBodySchema = z.object({
  show_in_marketplace: z.union([z.boolean(), z.number(), z.string()]),
});

module.exports = {
  adminLoginBodySchema,
  adminRefreshBodySchema,
  adminLogoutBodySchema,
  adminOrderStatusPatchBodySchema,
  adminProductPatchBodySchema,
  adminProductVisibilityPatchBodySchema,
};
