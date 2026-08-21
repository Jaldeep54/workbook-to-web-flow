import { LabelProduct } from "../models/catalogue.model.js";
import { LabelOrder, Order } from "../models/order.model.js";
import { Shop, ShopProduct } from "../models/shop.model.js";
import { addMonths, currentMonth, round2 } from "../utils/date.js";

/**
 * Label stock, straight from the workbook's formula:
 *
 *   stock = Σ labels received (label order lines) − Σ labels used (order lines
 *           for the product that label belongs to)
 *
 * This replaces the `label_stock_view` / `shop_label_stock_summary` views. The
 * numbers are derived, never stored, so they can't drift from the orders they
 * come from.
 */
export type LabelStockRow = {
  shop_id: string;
  shop_name: string;
  design_type: number;
  label_product_id: string;
  label_product_key: string;
  label_product_name: string;
  sort_order: number;
  low_stock_threshold: number;
  stock: number;
  is_low: boolean;
  /** False when the shop no longer carries the product this label belongs to. */
  shop_sells_product: boolean;
};

const cellKey = (shopId: string, labelProductId: string) => `${shopId}:${labelProductId}`;

/** Labels received per shop x label product. */
async function receivedLabels(): Promise<Map<string, number>> {
  const rows = await LabelOrder.aggregate<{ _id: { s: string; l: string }; total: number }>([
    { $unwind: "$label_order_lines" },
    {
      $group: {
        _id: { s: "$shop_id", l: "$label_order_lines.label_product_id" },
        total: { $sum: "$label_order_lines.products" },
      },
    },
  ]);
  return new Map(rows.map((r) => [cellKey(r._id.s, r._id.l), r.total]));
}

/** Product quantities ordered per shop x product (= labels consumed). */
async function usedQuantities(monthFilter?: { $gte: string; $lte: string }): Promise<
  Map<string, number>
> {
  const match = monthFilter ? [{ $match: { month: monthFilter } }] : [];
  const rows = await Order.aggregate<{ _id: { s: string; p: string }; total: number }>([
    ...match,
    { $unwind: "$order_lines" },
    {
      $group: {
        _id: { s: "$shop_id", p: "$order_lines.product_id" },
        total: { $sum: "$order_lines.qty" },
      },
    },
  ]);
  return new Map(rows.map((r) => [cellKey(r._id.s, r._id.p), r.total]));
}

export async function labelStock(): Promise<LabelStockRow[]> {
  const [shops, labelProducts, shopProducts, received, used] = await Promise.all([
    Shop.find({}, { shop_name: 1, design_type: 1 }).sort({ shop_name: 1 }).lean(),
    LabelProduct.find().sort({ sort_order: 1 }).lean(),
    ShopProduct.find({}, { shop_id: 1, product_id: 1 }).lean(),
    receivedLabels(),
    usedQuantities(),
  ]);

  const carries = new Set(shopProducts.map((sp) => cellKey(sp.shop_id, sp.product_id)));
  const rows: LabelStockRow[] = [];

  for (const shop of shops) {
    for (const lp of labelProducts) {
      const stock = round2(
        (received.get(cellKey(shop._id, lp._id)) ?? 0) -
          (used.get(cellKey(shop._id, lp.product_id)) ?? 0),
      );
      const sells = carries.has(cellKey(shop._id, lp.product_id));
      // Same scoping rule as the view: labels the shop carries, plus any label
      // it still holds a non-zero balance of after dropping the product.
      if (!sells && stock === 0) continue;

      rows.push({
        shop_id: shop._id,
        shop_name: shop.shop_name,
        design_type: shop.design_type,
        label_product_id: lp._id,
        label_product_key: lp.key,
        label_product_name: lp.name,
        sort_order: lp.sort_order,
        low_stock_threshold: lp.low_stock_threshold,
        stock,
        is_low: stock < lp.low_stock_threshold,
        shop_sells_product: sells,
      });
    }
  }

  return rows;
}

export type ShopLabelSummary = {
  shop_id: string;
  shop_name: string;
  design_type: number;
  low_stock_count: number;
  has_label_order: boolean;
  include_in_dashboard: boolean;
};

export async function labelStockSummary(): Promise<ShopLabelSummary[]> {
  const [rows, shopsWithOrders] = await Promise.all([
    labelStock(),
    LabelOrder.distinct("shop_id"),
  ]);
  const ordered = new Set(shopsWithOrders as string[]);
  const byShop = new Map<string, ShopLabelSummary>();

  for (const row of rows) {
    const entry = byShop.get(row.shop_id) ?? {
      shop_id: row.shop_id,
      shop_name: row.shop_name,
      design_type: row.design_type,
      low_stock_count: 0,
      has_label_order: ordered.has(row.shop_id),
      include_in_dashboard: false,
    };
    if (row.is_low) entry.low_stock_count += 1;
    byShop.set(row.shop_id, entry);
  }

  return Array.from(byShop.values())
    .map((entry) => ({
      ...entry,
      include_in_dashboard: entry.low_stock_count > 0 && entry.has_label_order,
    }))
    .sort((a, b) => a.shop_name.localeCompare(b.shop_name));
}

/**
 * Label Order Suggestion — threshold-based reorder advice.
 *
 *   1-month target   = low_stock_threshold + 1 x average monthly usage
 *   2-month target   = low_stock_threshold + 2 x average monthly usage
 *   suggested sheets = ceil(max(0, 2-month target − effective stock) / labels per sheet)
 *
 * Average monthly usage is the shop/product's ordered quantity over the last
 * `historyMonths` months divided by that fixed month count.
 *
 * Negative stock is a data/test inconsistency (received < used), never real
 * demand: every calculation runs off `effective stock = max(stock, 0)` so a
 * shop sitting at −40 is treated exactly like one sitting at 0, and the raw
 * figure is still returned with `has_stock_data_issue` so the UI can flag it.
 *
 * Status uses the same `low_stock_threshold` the stock table turns red on, so
 * the two indicators can never disagree about the same number.
 */
export type LabelSuggestionStatus = "urgent" | "recommended" | "monitor" | "no_order_required";

export type LabelOrderSuggestionRow = {
  shop_id: string;
  shop_name: string;
  shop_code: string;
  label_product_id: string;
  label_product_key: string;
  label_product_name: string;
  label_product_short_name: string;
  label_product_sort_order: number;
  product_id: string;
  labels_per_sheet: number;
  sheet_cost: number;
  low_stock_threshold: number;
  current_stock: number;
  has_stock_data_issue: boolean;
  avg_monthly_usage: number;
  one_month_target: number;
  two_month_target: number;
  additional_required: number;
  suggested_sheets: number;
  expected_stock_after_order: number;
  status: LabelSuggestionStatus;
};

export async function labelOrderSuggestions(historyMonths = 3): Promise<LabelOrderSuggestionRow[]> {
  const months = Math.max(1, historyMonths);
  const thisMonth = currentMonth();
  const windowFilter = { $gte: addMonths(thisMonth, -(months - 1)), $lte: thisMonth };

  const [shops, labelProducts, shopProducts, stockRows, usage] = await Promise.all([
    Shop.find({ is_active: true }, { shop_name: 1, code: 1 }).lean(),
    LabelProduct.find().sort({ sort_order: 1 }).lean(),
    ShopProduct.find({}, { shop_id: 1, product_id: 1 }).lean(),
    labelStock(),
    usedQuantities(windowFilter),
  ]);

  const stockByCell = new Map(stockRows.map((r) => [cellKey(r.shop_id, r.label_product_id), r.stock]));
  const labelsByProduct = new Map<string, typeof labelProducts>();
  for (const lp of labelProducts) {
    labelsByProduct.set(lp.product_id, [...(labelsByProduct.get(lp.product_id) ?? []), lp]);
  }
  const shopById = new Map(shops.map((s) => [s._id, s]));

  const rows: LabelOrderSuggestionRow[] = [];

  for (const link of shopProducts) {
    const shop = shopById.get(link.shop_id);
    if (!shop) continue; // inactive shop
    for (const lp of labelsByProduct.get(link.product_id) ?? []) {
      const current_stock = stockByCell.get(cellKey(shop._id, lp._id)) ?? 0;
      const effective = Math.max(current_stock, 0);
      const avg_monthly_usage = round2(
        (usage.get(cellKey(shop._id, link.product_id)) ?? 0) / months,
      );
      const one_month_target = round2(lp.low_stock_threshold + avg_monthly_usage);
      const two_month_target = round2(lp.low_stock_threshold + 2 * avg_monthly_usage);
      const additional_required = round2(Math.max(two_month_target - effective, 0));
      const suggested_sheets = lp.labels_per_sheet
        ? Math.ceil(additional_required / lp.labels_per_sheet)
        : 0;

      const status: LabelSuggestionStatus =
        effective < lp.low_stock_threshold
          ? "urgent"
          : effective < one_month_target
            ? "recommended"
            : effective < two_month_target
              ? "monitor"
              : "no_order_required";

      rows.push({
        shop_id: shop._id,
        shop_name: shop.shop_name,
        shop_code: shop.code,
        label_product_id: lp._id,
        label_product_key: lp.key,
        label_product_name: lp.name,
        label_product_short_name: lp.short_name,
        label_product_sort_order: lp.sort_order,
        product_id: lp.product_id,
        labels_per_sheet: lp.labels_per_sheet,
        sheet_cost: lp.sheet_cost,
        low_stock_threshold: lp.low_stock_threshold,
        current_stock,
        has_stock_data_issue: current_stock < 0,
        avg_monthly_usage,
        one_month_target,
        two_month_target,
        additional_required,
        suggested_sheets,
        expected_stock_after_order: round2(current_stock + suggested_sheets * lp.labels_per_sheet),
        status,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      a.shop_name.localeCompare(b.shop_name) ||
      a.label_product_sort_order - b.label_product_sort_order,
  );
}
