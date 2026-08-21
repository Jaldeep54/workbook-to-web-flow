import { LabelProduct, Product } from "../models/catalogue.model.js";
import { round4 } from "../utils/date.js";

/**
 * "Label / unit" is never a manually entered figure: it is the sum of
 * `sheet_cost / labels_per_sheet` across *every* label component of a product.
 *
 * This is the rule that fixed Laundry Liquid 700 under-counting its cost —
 * it has separate Front and Back labels, and only the Front was being counted
 * when the figure was a single editable column. In Postgres this lived in
 * `compute_product_label_cost()` plus a trigger on `label_products`; here the
 * same two pieces are the functions below, called from the label-product
 * write paths and from the delivery calculation.
 */
export async function computeProductLabelCost(productId: string): Promise<number> {
  const labels = await LabelProduct.find(
    { product_id: productId },
    { sheet_cost: 1, labels_per_sheet: 1 },
  ).lean();

  return round4(
    labels.reduce(
      (sum, l) => sum + (l.labels_per_sheet ? Number(l.sheet_cost) / Number(l.labels_per_sheet) : 0),
      0,
    ),
  );
}

/** Live label cost for every product, keyed by product id. */
export async function labelCostByProduct(): Promise<Map<string, number>> {
  const rows = await LabelProduct.aggregate<{ _id: string; cost: number }>([
    {
      $group: {
        _id: "$product_id",
        cost: {
          $sum: {
            $cond: [
              { $gt: ["$labels_per_sheet", 0] },
              { $divide: ["$sheet_cost", "$labels_per_sheet"] },
              0,
            ],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, round4(r.cost)]));
}

/**
 * Refreshes the cached `products.label_cost_per_unit` for the given products
 * (or all of them). The cache exists so reads — the products list the whole
 * frontend holds, CSV exports, the Settings screen — don't need a second
 * aggregation just to display a rate. It is never the authority: delivery
 * costing calls labelCostByProduct() directly.
 */
export async function syncProductLabelCosts(productIds?: string[]): Promise<void> {
  const costs = await labelCostByProduct();
  const targets = productIds?.length
    ? productIds
    : (await Product.find({}, { _id: 1 }).lean()).map((p) => p._id);

  const operations = Array.from(new Set(targets)).map((id) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { label_cost_per_unit: costs.get(id) ?? 0 } },
    },
  }));

  if (operations.length) await Product.bulkWrite(operations);
}

/** Sequential shop code, mirroring the old `next_shop_code()` function. */
export async function nextShopCode(): Promise<string> {
  const { Shop } = await import("../models/shop.model.js");
  const [count, codes] = await Promise.all([
    Shop.countDocuments(),
    Shop.find({}, { code: 1 }).lean(),
  ]);
  const highestNumeric = codes.reduce((max, s) => {
    const digits = String(s.code ?? "").replace(/\D/g, "");
    const value = digits ? Number(digits) : 0;
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
  return String(Math.max(count, highestNumeric) + 1);
}
