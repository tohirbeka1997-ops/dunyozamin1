'use strict';

const { z } = require('zod');

const staffLoginBodySchema = z.object({
  tenant: z.string().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  device_id: z.string().max(128).optional().nullable(),
  platform: z.string().max(32).optional().nullable(),
});

const staffRefreshBodySchema = z.object({
  refresh_token: z.string().min(1).optional(),
});

const staffLogoutBodySchema = z.object({
  refresh_token: z.string().optional().nullable(),
});

const staffSaleItemSchema = z.object({
  product_id: z.union([z.string(), z.number()]).transform(String),
  quantity: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  discount_amount: z.union([z.number(), z.string()]).optional(),
});

const staffSaleCreateBodySchema = z.object({
  items: z.array(staffSaleItemSchema).min(1),
  payment_method: z.enum(['cash', 'card', 'credit']),
  customer_id: z.union([z.string(), z.number()]).optional().nullable(),
  amount_tendered: z.union([z.number(), z.string()]).optional().nullable(),
  apply_prepaid: z.union([z.boolean(), z.number(), z.string()]).optional(),
  notes: z.string().max(500).optional().nullable(),
  order_uuid: z.string().optional().nullable(),
  due_date: z.string().max(10).optional().nullable(),
});

const staffSaleHoldBodySchema = z.object({
  items: z.array(staffSaleItemSchema).min(1),
  customer_id: z.union([z.string(), z.number()]).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  order_uuid: z.string().optional().nullable(),
  shift_id: z.union([z.string(), z.number()]).optional().nullable(),
  device_id: z.string().max(128).optional().nullable(),
});

const staffCustomerCreateBodySchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const staffCustomerPatchBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    phone: z.string().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field required' });

const staffShiftOpenBodySchema = z.object({
  opening_cash: z.union([z.number(), z.string()]).optional(),
  notes: z.string().max(500).optional().nullable(),
});

const staffShiftCloseBodySchema = z.object({
  closing_cash: z.union([z.number(), z.string()]).optional(),
  notes: z.string().max(500).optional().nullable(),
});

const staffReturnItemSchema = z.object({
  order_item_id: z.union([z.string(), z.number()]).transform(String),
  quantity: z.union([z.number(), z.string()]).transform((v) => Number(v)),
});

const staffReturnCreateBodySchema = z.object({
  order_id: z.union([z.string(), z.number()]).transform(String),
  items: z.array(staffReturnItemSchema).min(1),
  refund_method: z.string().optional(),
  reason: z.string().max(500).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const staffExpenseCreateBodySchema = z.object({
  category_id: z.string().min(1),
  amount: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  expense_date: z.string().optional().nullable(),
  payment_method: z.string().optional(),
});

const staffOrderStatusPatchBodySchema = z.object({
  status: z.string().min(1),
});

module.exports = {
  staffLoginBodySchema,
  staffRefreshBodySchema,
  staffLogoutBodySchema,
  staffSaleCreateBodySchema,
  staffSaleHoldBodySchema,
  staffCustomerCreateBodySchema,
  staffCustomerPatchBodySchema,
  staffShiftOpenBodySchema,
  staffShiftCloseBodySchema,
  staffReturnCreateBodySchema,
  staffExpenseCreateBodySchema,
  staffOrderStatusPatchBodySchema,
};
