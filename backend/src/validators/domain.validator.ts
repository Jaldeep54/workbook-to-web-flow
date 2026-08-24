import { z } from "zod";

import { CASH_POSITION_PEOPLE, COST_TYPES } from "../models/finance.model.js";
import { ORDER_STATUSES, PAYMENT_STATUSES, DELIVERY_STATUSES } from "../models/order.model.js";
import { areaFilter, idString, isoDate, listQuery, monthString, shopFilter } from "./common.validator.js";

/* ------------------------------------------------------------------ shops */

export const shopBodySchema = z.object({
  code: z.string().trim().min(1, "Shop code is required").max(40),
  folder_name: z.string().trim().max(120).nullish(),
  shop_name: z.string().trim().min(1, "Shop name is required").max(200),
  label_name: z.string().trim().max(200).nullish(),
  bill_name: z.string().trim().max(200).nullish(),
  design_type: z.coerce.number().int().min(1).max(99).default(1),
  /** Required: every area filter in the app depends on it. */
  area_id: idString.refine((v) => v.length > 0, "Shop area is required"),
  address: z.string().trim().max(500).nullish(),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  mobile: z.string().trim().max(30).nullish(),
  handled_by: z.string().trim().max(120).nullish(),
  /** When set, the API overwrites `handled_by` with that user's name. */
  handled_by_user_id: idString.nullish(),
  joined_on: isoDate.nullish(),
  is_active: z.boolean().default(true),
  /** Products the shop works with — at least one, as the UI requires. */
  product_ids: z.array(idString).min(1, "Select at least one product for this shop"),
});

export const shopUpdateSchema = shopBodySchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  "Provide at least one field to update",
);

export const shopListQuery = listQuery.extend({
  areaId: areaFilter,
  isActive: z.enum(["true", "false"]).optional(),
});

export const shopAreaSchema = z.object({
  name: z.string().trim().min(1, "Area name cannot be empty").max(120),
});

/* --------------------------------------------------------------- catalogue */

export const productUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    short_name: z.string().trim().min(1).max(60).optional(),
    sort_order: z.coerce.number().int().min(0).optional(),
    selling_price: z.coerce.number().min(0).optional(),
    production_cost: z.coerce.number().min(0).optional(),
    packaging_cost: z.coerce.number().min(0).optional(),
    unit: z.string().trim().max(30).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

export const productCreateSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  short_name: z.string().trim().min(1).max(60),
  sort_order: z.coerce.number().int().min(0),
  selling_price: z.coerce.number().min(0).default(0),
  production_cost: z.coerce.number().min(0).default(0),
  packaging_cost: z.coerce.number().min(0).default(0),
  unit: z.string().trim().max(30).default(""),
  is_active: z.boolean().default(true),
});

export const labelProductCreateSchema = z.object({
  key: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  short_name: z.string().trim().min(1).max(60),
  sort_order: z.coerce.number().int().min(0),
  product_id: idString,
  labels_per_sheet: z.coerce.number().positive("Labels per sheet must be greater than zero"),
  sheet_cost: z.coerce.number().min(0),
  low_stock_threshold: z.coerce.number().int().min(0).default(15),
});

export const labelProductUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    short_name: z.string().trim().min(1).max(60).optional(),
    sort_order: z.coerce.number().int().min(0).optional(),
    product_id: idString.optional(),
    labels_per_sheet: z.coerce.number().positive().optional(),
    sheet_cost: z.coerce.number().min(0).optional(),
    low_stock_threshold: z.coerce.number().int().min(0).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

/* ------------------------------------------------------------------ orders */

const orderLine = z.object({
  product_id: idString,
  qty: z.coerce.number().min(0, "Quantities cannot be negative"),
});

export const orderCreateSchema = z
  .object({
    shop_id: idString,
    order_date: isoDate,
    delivery_date: isoDate,
    notes: z.string().trim().max(500).nullish(),
    order_lines: z.array(orderLine).min(1, "Enter at least one product quantity"),
  })
  .refine((body) => body.delivery_date >= body.order_date, {
    message: "Delivery date cannot be before the order date",
    path: ["delivery_date"],
  })
  .refine((body) => body.order_lines.some((l) => l.qty > 0), {
    message: "Enter at least one product quantity",
    path: ["order_lines"],
  });

export const orderUpdateSchema = orderCreateSchema;

export const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  delivery_date: isoDate.optional(),
});

export const orderListQuery = listQuery.extend({
  month: monthString.optional(),
  shopId: shopFilter,
  areaId: areaFilter,
  date: isoDate.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  /** `?pending=true` lists orders that have no delivery yet. */
  pending: z.enum(["true", "false"]).optional(),
});

export const deliverySheetQuery = z.object({
  date: isoDate,
  areaId: areaFilter,
});

export const dueDatesQuery = z.object({
  financialYear: z.string().regex(/^\d{4}$/, "Expected a 4-digit financial year"),
});

/* -------------------------------------------------------------- deliveries */

export const deliveryCreateSchema = z.object({
  order_id: idString,
  delivery_date: isoDate,
  status: z.enum(DELIVERY_STATUSES).default("Delivered"),
});

export const deliveryUpdateSchema = z.object({
  status: z.enum(DELIVERY_STATUSES).optional(),
  delivery_date: isoDate.optional(),
});

export const monthListQuery = listQuery.extend({
  month: monthString.optional(),
  shopId: shopFilter,
  areaId: areaFilter,
});

/* ---------------------------------------------------------------- payments */

export const paymentUpdateSchema = z
  .object({
    status: z.enum(PAYMENT_STATUSES).optional(),
    collected_by: z.string().trim().max(80).nullish(),
    collected_date: isoDate.nullish(),
    amount: z.coerce.number().min(0).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

/* ------------------------------------------------------------ label orders */

const labelOrderLine = z.object({
  label_product_id: idString,
  sheets: z.coerce.number().min(0),
});

export const labelOrderCreateSchema = z.object({
  shop_id: idString,
  order_date: isoDate,
  lines: z.array(labelOrderLine).min(1, "Enter sheets for at least one label"),
});

/** "Place selected orders" from the suggestion screen — many shops at once. */
export const labelOrderBulkSchema = z.object({
  order_date: isoDate,
  orders: z
    .array(
      z.object({
        shop_id: idString,
        lines: z.array(labelOrderLine).min(1),
      }),
    )
    .min(1, "Select at least one shop"),
});

export const labelSuggestionQuery = z.object({
  historyMonths: z.coerce.number().int().min(1).max(24).optional(),
});

/* ------------------------------------------------------------------- costs */

export const costCreateSchema = z.object({
  cost_date: isoDate,
  cost_type: z.enum(COST_TYPES).or(z.string().trim().min(1).max(60)),
  amount: z.coerce.number().min(0),
  note: z.string().trim().max(500).nullish(),
});

export const costUpdateSchema = costCreateSchema.partial().refine(
  (body) => Object.keys(body).length > 0,
  "Provide at least one field to update",
);

/* --------------------------------------------------------- cash position */

export const investmentSchema = z.object({
  investment_date: isoDate,
  amount: z.coerce.number().min(0),
  done_by: z.enum(CASH_POSITION_PEOPLE),
});

export const payoutSchema = z.object({
  payout_date: isoDate,
  amount: z.coerce.number().min(0),
  done_by: z.enum(CASH_POSITION_PEOPLE),
});

/* --------------------------------------------------------------- dashboard */

export const dashboardQuery = z.object({
  month: monthString,
  areaId: areaFilter,
});

export const shopAnalysisQuery = z.object({
  months: z.coerce.number().int().min(1).max(24).optional(),
});

/* ------------------------------------------------------------------- bills */

export const billsSchema = z.object({
  orderIds: z.array(idString).min(1, "Select at least one order").max(200),
});
