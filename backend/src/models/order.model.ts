import { Schema, model } from "mongoose";

import { monthKey } from "../utils/date.js";
import { ISO_DATE_MATCH, schemaOptions, uuidId } from "./base.js";

/**
 * Orders, deliveries and label orders each embed their line items.
 *
 * In Postgres these were separate child tables joined on every read; in
 * MongoDB the lines are only ever read, written and deleted together with
 * their parent (there is no "list all order lines" screen), so embedding is
 * both the natural document boundary and one round trip instead of a join.
 * Reports that need per-product totals `$unwind` them in an aggregation, which
 * the indexes on `order_lines.product_id` support.
 *
 * `month` mirrors the old generated column: the first day of the parent
 * date's month, maintained by the pre-validate hooks below so no caller can
 * forget it.
 */
export const ORDER_STATUSES = ["Pending", "Delivered", "Cancelled"] as const;
export const DELIVERY_STATUSES = ["Pending", "Delivered", "Cancelled"] as const;
export const PAYMENT_STATUSES = ["Pending", "Received", "Partial"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type ProductLine = { product_id: string; qty: number };
export type LabelLine = { label_product_id: string; sheets: number; products: number };

export interface IOrder {
  _id: string;
  shop_id: string;
  order_no: number;
  order_date: string | null;
  delivery_date: string | null;
  month: string | null;
  status: OrderStatus;
  total_qty: number;
  notes: string | null;
  order_lines: ProductLine[];
  created_at?: Date;
  updated_at?: Date;
}

const productLineSchema = new Schema<ProductLine>(
  {
    product_id: { type: String, ref: "Product", required: true },
    qty: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    _id: uuidId,
    shop_id: { type: String, ref: "Shop", required: true },
    order_no: { type: Number, required: true, min: 1 },
    order_date: { type: String, default: null, match: ISO_DATE_MATCH },
    delivery_date: { type: String, default: null, match: ISO_DATE_MATCH },
    month: { type: String, default: null, match: ISO_DATE_MATCH },
    status: { type: String, enum: ORDER_STATUSES, default: "Pending" },
    total_qty: { type: Number, default: 0, min: 0 },
    notes: { type: String, default: null, maxlength: 500 },
    order_lines: { type: [productLineSchema], default: [] },
  },
  schemaOptions(),
);

orderSchema.index({ shop_id: 1, order_no: 1 }, { unique: true });
orderSchema.index({ month: 1, order_date: -1 });
orderSchema.index({ delivery_date: 1 });
orderSchema.index({ shop_id: 1, order_date: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ "order_lines.product_id": 1 });

orderSchema.pre("validate", function assignMonth(next) {
  this.month = monthKey(this.order_date);
  next();
});

export const Order = model<IOrder>("Order", orderSchema, "orders");

export interface IDelivery {
  _id: string;
  shop_id: string;
  /** One delivery per order, enforced by the unique index. */
  order_id: string;
  delivery_date: string | null;
  month: string | null;
  status: DeliveryStatus;
  total_qty: number;
  total_sales: number;
  labelling_cost: number;
  packaging_cost: number;
  production_cost: number;
  total_fixed_cost: number;
  profit: number;
  delivery_lines: ProductLine[];
  created_at?: Date;
  updated_at?: Date;
}

const deliverySchema = new Schema<IDelivery>(
  {
    _id: uuidId,
    shop_id: { type: String, ref: "Shop", required: true },
    order_id: { type: String, ref: "Order", required: true, unique: true },
    delivery_date: { type: String, default: null, match: ISO_DATE_MATCH },
    month: { type: String, default: null, match: ISO_DATE_MATCH },
    status: { type: String, enum: DELIVERY_STATUSES, default: "Delivered" },
    total_qty: { type: Number, default: 0, min: 0 },
    total_sales: { type: Number, default: 0 },
    labelling_cost: { type: Number, default: 0 },
    packaging_cost: { type: Number, default: 0 },
    production_cost: { type: Number, default: 0 },
    total_fixed_cost: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
    delivery_lines: { type: [productLineSchema], default: [] },
  },
  schemaOptions(),
);

deliverySchema.index({ month: 1, delivery_date: -1 });
deliverySchema.index({ shop_id: 1, delivery_date: -1 });
deliverySchema.index({ delivery_date: 1 });

deliverySchema.pre("validate", function assignMonth(next) {
  this.month = monthKey(this.delivery_date);
  next();
});

export const Delivery = model<IDelivery>("Delivery", deliverySchema, "deliveries");

export interface IPayment {
  _id: string;
  shop_id: string;
  order_id: string;
  payment_date: string | null;
  month: string | null;
  status: PaymentStatus;
  collected_by: string | null;
  /** The user account behind `collected_by`, when the collector has one. */
  collected_by_user_id: string | null;
  /** When the money actually arrived, distinct from payment_date. */
  collected_date: string | null;
  /** What the delivery is worth — the full bill for this order. */
  amount: number;
  /**
   * How much of `amount` the shopkeeper has actually handed over. Shops pay in
   * instalments, so this is the running total of what has come in and
   * `amount - amount_received` is the balance still owed. `status` is always
   * derived from the two by `derivePaymentStatus()` — never set on its own.
   */
  amount_received: number;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * A payment's status is a function of its two money figures, never an
 * independent field: nothing received is Pending, part of it is Partial, all
 * of it (or more) is Received. Every write path runs through here so a row can
 * never claim "Received" while money is still outstanding.
 */
export function derivePaymentStatus(amount: number, amountReceived: number): PaymentStatus {
  const due = Number(amount) || 0;
  const paid = Number(amountReceived) || 0;
  if (paid <= 0) return "Pending";
  if (paid >= due) return "Received";
  return "Partial";
}

const paymentSchema = new Schema<IPayment>(
  {
    _id: uuidId,
    shop_id: { type: String, ref: "Shop", required: true },
    order_id: { type: String, ref: "Order", required: true, unique: true },
    payment_date: { type: String, default: null, match: ISO_DATE_MATCH },
    month: { type: String, default: null, match: ISO_DATE_MATCH },
    status: { type: String, enum: PAYMENT_STATUSES, default: "Pending" },
    collected_by: { type: String, default: null, maxlength: 80, trim: true },
    collected_by_user_id: { type: String, ref: "User", default: null },
    collected_date: { type: String, default: null, match: ISO_DATE_MATCH },
    amount: { type: Number, default: 0, min: 0 },
    amount_received: { type: Number, default: 0, min: 0 },
  },
  schemaOptions(),
);

paymentSchema.index({ month: 1, payment_date: -1 });
paymentSchema.index({ shop_id: 1, payment_date: -1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ collected_by_user_id: 1 });

/** Keeps `status` honest however a caller chose to write the two amounts. */
paymentSchema.pre("validate", function syncStatus(next) {
  this.status = derivePaymentStatus(this.amount, this.amount_received);
  next();
});

paymentSchema.pre("validate", function assignMonth(next) {
  this.month = monthKey(this.payment_date);
  next();
});

export const Payment = model<IPayment>("Payment", paymentSchema, "payments");

export interface ILabelOrder {
  _id: string;
  shop_id: string;
  order_no: number;
  order_date: string | null;
  month: string | null;
  total_labels: number;
  label_order_lines: LabelLine[];
  created_at?: Date;
  updated_at?: Date;
}

const labelLineSchema = new Schema<LabelLine>(
  {
    label_product_id: { type: String, ref: "LabelProduct", required: true },
    sheets: { type: Number, default: 0, min: 0 },
    /** Labels produced = sheets x labels_per_sheet, frozen at order time. */
    products: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const labelOrderSchema = new Schema<ILabelOrder>(
  {
    _id: uuidId,
    shop_id: { type: String, ref: "Shop", required: true },
    order_no: { type: Number, required: true, min: 1 },
    order_date: { type: String, default: null, match: ISO_DATE_MATCH },
    month: { type: String, default: null, match: ISO_DATE_MATCH },
    total_labels: { type: Number, default: 0, min: 0 },
    label_order_lines: { type: [labelLineSchema], default: [] },
  },
  schemaOptions(),
);

labelOrderSchema.index({ shop_id: 1, order_no: 1 }, { unique: true });
labelOrderSchema.index({ month: 1, order_date: -1 });
labelOrderSchema.index({ shop_id: 1, order_date: -1 });
labelOrderSchema.index({ "label_order_lines.label_product_id": 1 });

labelOrderSchema.pre("validate", function assignMonth(next) {
  this.month = monthKey(this.order_date);
  next();
});

export const LabelOrder = model<ILabelOrder>("LabelOrder", labelOrderSchema, "label_orders");
