import { Schema, model } from "mongoose";
import { monthKey } from "../utils/date.js";
import { ISO_DATE_MATCH, schemaOptions, uuidId } from "./base.js";

export const DIRECT_SALE_PAYMENT_STATUSES = [
  "paid",
  "partial",
  "unpaid",
] as const;
export type DirectSalePaymentStatus =
  (typeof DIRECT_SALE_PAYMENT_STATUSES)[number];

export interface IDirectSale {
  _id: string;
  product_id: string;
  product_name: string;
  sold_by: string;
  sold_date: string;
  month: string | null;
  quantity: number;
  selling_price: number; // total (qty × unit price)
  production_cost: number; // total
  label_cost: number; // total
  jar_pouch_cost: number; // total
  profit: number; // selling_price - production_cost - label_cost - jar_pouch_cost
  payment_amount: number;
  payment_status: DirectSalePaymentStatus;
  created_at?: Date;
  updated_at?: Date;
}

const directSaleSchema = new Schema<IDirectSale>(
  {
    _id: uuidId,
    product_id: { type: String, ref: "Product", required: true },
    product_name: { type: String, required: true, trim: true },
    sold_by: { type: String, required: true, trim: true },
    sold_date: { type: String, required: true, match: ISO_DATE_MATCH },
    month: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    selling_price: { type: Number, default: 0, min: 0 },
    production_cost: { type: Number, default: 0, min: 0 },
    label_cost: { type: Number, default: 0, min: 0 },
    jar_pouch_cost: { type: Number, default: 0, min: 0 },
    profit: { type: Number, default: 0 },
    payment_amount: { type: Number, default: 0, min: 0 },
    payment_status: {
      type: String,
      default: "unpaid",
      enum: DIRECT_SALE_PAYMENT_STATUSES,
    },
  },
  schemaOptions(),
);

directSaleSchema.index({ month: 1, sold_date: -1 });
directSaleSchema.index({ sold_by: 1 });
directSaleSchema.index({ product_id: 1 });

directSaleSchema.pre("validate", function (next) {
  this.month = monthKey(this.sold_date);
  this.profit = +(
    this.selling_price -
    this.production_cost -
    this.label_cost -
    this.jar_pouch_cost
  ).toFixed(2);
  next();
});

export const DirectSale = model<IDirectSale>(
  "DirectSale",
  directSaleSchema,
  "direct_sales",
);
