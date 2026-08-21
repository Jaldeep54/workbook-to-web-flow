import { Schema, model } from "mongoose";

import { schemaOptions, uuidId } from "./base.js";

/**
 * The workbook's "Inputs" sheet: products and their label components.
 *
 * `label_cost_per_unit` is a cached figure, kept in sync by
 * services/catalogue.service.ts as the sum of `sheet_cost / labels_per_sheet`
 * across every label belonging to the product — the same rule the old
 * `compute_product_label_cost()` / `sync_product_label_cost()` trigger pair
 * enforced. It is never user-editable.
 */
export interface IProduct {
  _id: string;
  key: string;
  name: string;
  short_name: string;
  sort_order: number;
  selling_price: number;
  production_cost: number;
  packaging_cost: number;
  label_cost_per_unit: number;
  /** Unit of sale printed on bills — Pouch / Jar / Can / Bottle. */
  unit: string;
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
}

const productSchema = new Schema<IProduct>(
  {
    _id: uuidId,
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    short_name: { type: String, required: true, trim: true },
    sort_order: { type: Number, required: true },
    selling_price: { type: Number, default: 0, min: 0 },
    production_cost: { type: Number, default: 0, min: 0 },
    packaging_cost: { type: Number, default: 0, min: 0 },
    label_cost_per_unit: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: "", trim: true },
    is_active: { type: Boolean, default: true },
  },
  schemaOptions(),
);

productSchema.index({ sort_order: 1 });

export const Product = model<IProduct>("Product", productSchema, "products");

export interface ILabelProduct {
  _id: string;
  key: string;
  name: string;
  short_name: string;
  sort_order: number;
  product_id: string;
  labels_per_sheet: number;
  sheet_cost: number;
  low_stock_threshold: number;
  created_at?: Date;
  updated_at?: Date;
}

const labelProductSchema = new Schema<ILabelProduct>(
  {
    _id: uuidId,
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    short_name: { type: String, required: true, trim: true },
    sort_order: { type: Number, required: true },
    product_id: { type: String, ref: "Product", required: true },
    labels_per_sheet: { type: Number, required: true, min: 0 },
    sheet_cost: { type: Number, required: true, min: 0 },
    low_stock_threshold: { type: Number, default: 15, min: 0 },
  },
  schemaOptions(),
);

labelProductSchema.index({ sort_order: 1 });
labelProductSchema.index({ product_id: 1 });

export const LabelProduct = model<ILabelProduct>("LabelProduct", labelProductSchema, "label_products");
