import { Schema, model } from "mongoose";

import { ISO_DATE_MATCH, schemaOptions, uuidId } from "./base.js";

/**
 * Shop areas are a normalized lookup (not free text on the shop) so every
 * module filters by the same value. `name_key` is the lowercased, trimmed name
 * with a unique index — the MongoDB equivalent of the old
 * `UNIQUE (lower(btrim(name)))` index that stopped "Varachha", "varachha " and
 * "VARACHHA" becoming three areas.
 */
export interface IShopArea {
  _id: string;
  name: string;
  name_key: string;
  created_at?: Date;
  updated_at?: Date;
}

const shopAreaSchema = new Schema<IShopArea>(
  {
    _id: uuidId,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    name_key: { type: String, required: true, unique: true },
  },
  schemaOptions(),
);

shopAreaSchema.index({ name: 1 });

shopAreaSchema.pre("validate", function assignNameKey(next) {
  if (this.name) this.name_key = this.name.trim().toLowerCase();
  next();
});

export const ShopArea = model<IShopArea>("ShopArea", shopAreaSchema, "shop_areas");

export interface IShop {
  _id: string;
  code: string;
  folder_name: string | null;
  shop_name: string;
  label_name: string | null;
  /** Name printed on invoices/challans; falls back to shop_name when unset. */
  bill_name: string | null;
  design_type: number;
  area_id: string | null;
  /** Storage key of the shop photo (see services/file.service.ts). */
  image_path: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  mobile: string | null;
  handled_by: string | null;
  joined_on: string | null;
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
}

const shopSchema = new Schema<IShop>(
  {
    _id: uuidId,
    code: { type: String, required: true, unique: true, trim: true },
    folder_name: { type: String, default: null, trim: true },
    shop_name: { type: String, required: true, trim: true, maxlength: 200 },
    label_name: { type: String, default: null, trim: true },
    bill_name: { type: String, default: null, trim: true },
    design_type: { type: Number, default: 1, min: 1 },
    area_id: { type: String, ref: "ShopArea", default: null },
    image_path: { type: String, default: null },
    address: { type: String, default: null, trim: true },
    latitude: { type: Number, default: null, min: -90, max: 90 },
    longitude: { type: Number, default: null, min: -180, max: 180 },
    mobile: { type: String, default: null, trim: true },
    handled_by: { type: String, default: null, trim: true },
    joined_on: { type: String, default: null, match: ISO_DATE_MATCH },
    is_active: { type: Boolean, default: true },
  },
  schemaOptions(),
);

shopSchema.index({ is_active: 1, shop_name: 1 });
shopSchema.index({ area_id: 1 });
shopSchema.index({ shop_name: 1 });
shopSchema.index({ latitude: 1, longitude: 1 });

export const Shop = model<IShop>("Shop", shopSchema, "shops");

/** Which products a shop works with — the definition of an "active product". */
export interface IShopProduct {
  _id: string;
  shop_id: string;
  product_id: string;
  created_at?: Date;
  updated_at?: Date;
}

const shopProductSchema = new Schema<IShopProduct>(
  {
    _id: uuidId,
    shop_id: { type: String, ref: "Shop", required: true },
    product_id: { type: String, ref: "Product", required: true },
  },
  schemaOptions(),
);

shopProductSchema.index({ shop_id: 1, product_id: 1 }, { unique: true });
shopProductSchema.index({ product_id: 1 });

export const ShopProduct = model<IShopProduct>("ShopProduct", shopProductSchema, "shop_products");
