import { logger } from "../config/logger.js";
import { LabelProduct, Product } from "../models/catalogue.model.js";
import { syncProductLabelCosts } from "../services/catalogue.service.js";

/**
 * The workbook's Inputs sheet: the six products and the seven label components
 * they're printed with (Laundry Liquid 700 has separate Front and Back labels,
 * which is why label cost is a sum, not a single figure).
 *
 * Rates seeded here are starting values — they're editable under
 * Rates & settings, and re-running the seed never overwrites edited rates.
 */
const PRODUCTS = [
  { key: "dw200", name: "Dishwash Liquid 200", short_name: "DW 200", sort_order: 1, selling_price: 95, production_cost: 63, packaging_cost: 7.5, unit: "Pouch" },
  { key: "dw350", name: "Dishwash Liquid 350", short_name: "DW 350", sort_order: 2, selling_price: 175, production_cost: 108, packaging_cost: 23.86, unit: "Jar" },
  { key: "dw480", name: "Dishwash Liquid 480", short_name: "DW 480", sort_order: 3, selling_price: 235, production_cost: 148.5, packaging_cost: 23.86, unit: "Jar" },
  { key: "ll500", name: "Laundry Liquid 500", short_name: "LL 500", sort_order: 4, selling_price: 305, production_cost: 189, packaging_cost: 41.07, unit: "Can" },
  { key: "ll700", name: "Laundry Liquid 700", short_name: "LL 700", sort_order: 5, selling_price: 435, production_cost: 270, packaging_cost: 58.83, unit: "Can" },
  { key: "tc60", name: "Toilet Cleaner 60", short_name: "TC 60", sort_order: 6, selling_price: 40, production_cost: 22, packaging_cost: 0, unit: "Bottle" },
];

const LABEL_PRODUCTS = [
  { key: "dw200", name: "Dishwash Liquid 200", short_name: "DW 200", sort_order: 1, product_key: "dw200", labels_per_sheet: 8, sheet_cost: 16, low_stock_threshold: 16 },
  { key: "dw350", name: "Dishwash Liquid 350", short_name: "DW 350", sort_order: 2, product_key: "dw350", labels_per_sheet: 10, sheet_cost: 16, low_stock_threshold: 15 },
  { key: "dw480", name: "Dishwash Liquid 480", short_name: "DW 480", sort_order: 3, product_key: "dw480", labels_per_sheet: 10, sheet_cost: 16, low_stock_threshold: 15 },
  { key: "ll500", name: "Laundry Liquid 500", short_name: "LL 500", sort_order: 4, product_key: "ll500", labels_per_sheet: 7, sheet_cost: 16, low_stock_threshold: 15 },
  { key: "ll700front", name: "Laundry Liquid 700 (Front)", short_name: "LL 700 F", sort_order: 5, product_key: "ll700", labels_per_sheet: 4, sheet_cost: 22, low_stock_threshold: 15 },
  { key: "ll700back", name: "Laundry Liquid 700 (Back)", short_name: "LL 700 B", sort_order: 6, product_key: "ll700", labels_per_sheet: 12, sheet_cost: 16, low_stock_threshold: 15 },
  { key: "tc60", name: "Toilet Cleaner 60", short_name: "TC 60", sort_order: 7, product_key: "tc60", labels_per_sheet: 7, sheet_cost: 22, low_stock_threshold: 42 },
];

export async function seedCatalogue(): Promise<void> {
  for (const product of PRODUCTS) {
    await Product.updateOne(
      { key: product.key },
      { $setOnInsert: product },
      { upsert: true },
    );
  }

  const products = await Product.find({}, { key: 1 }).lean();
  const idByKey = new Map(products.map((p) => [p.key, p._id]));

  for (const { product_key: productKey, ...label } of LABEL_PRODUCTS) {
    const product_id = idByKey.get(productKey);
    if (!product_id) continue;
    await LabelProduct.updateOne(
      { key: label.key },
      { $setOnInsert: { ...label, product_id } },
      { upsert: true },
    );
  }

  await syncProductLabelCosts();
  logger.info(`Catalogue ready: ${PRODUCTS.length} products, ${LABEL_PRODUCTS.length} labels`);
}
