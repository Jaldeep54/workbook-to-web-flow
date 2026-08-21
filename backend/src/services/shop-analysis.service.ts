import { Product } from "../models/catalogue.model.js";
import { Delivery, Order } from "../models/order.model.js";
import { Shop, ShopArea, ShopProduct } from "../models/shop.model.js";
import { ApiError } from "../utils/api-error.js";
import {
  addMonths,
  currentMonth,
  daysBetween,
  endOfMonth,
  monthWindow,
  round2,
} from "../utils/date.js";

/**
 * Shop Analysis — one computation feeding both the Shop Analysis tab and the
 * New Order form's Shop Sales Indicator, so the two can never disagree.
 *
 * Methodology carried over from the `shop_analysis()` RPC unchanged:
 *
 *  - Window: the last N months *including the current one*, the same bucketing
 *    every other report uses.
 *  - Comparison group: active shops sharing the shop's area, including the
 *    shop itself (matching the spec's worked examples). A shop alone in its
 *    area reports "insufficient area data" rather than comparing to itself.
 *  - Area figures are always per-shop-then-averaged — each metric is computed
 *    for every eligible shop individually and then averaged across shops,
 *    never a combined area total re-divided.
 */
export const SHOP_ANALYSIS_MONTHS = 3;

export type ShopAnalysis = {
  shop: { id: string; name: string; areaId: string | null; areaName: string | null };
  analysisPeriod: { months: number; label: string; startDate: string; endDate: string };
  activeProducts: Array<{ id: string; key: string; name: string; shortName: string; sortOrder: number }>;
  productMix: {
    shop: Array<{ productId: string; shortName: string; sortOrder: number; qty: number; sharePct: number }>;
    shopTotalQty: number;
    area: Array<{ productId: string; shortName: string; sortOrder: number; sharePct: number }>;
    areaEligibleShops: number;
  };
  orderFrequency: {
    shop: { avgDays: number; orderCount: number } | null;
    area: { avgDays: number; eligibleShops: number } | null;
  };
  monthlySales: {
    shop: {
      average: number;
      activeMonths: number;
      byProduct: Array<{ productId: string; shortName: string; sortOrder: number; average: number }>;
    } | null;
    area: {
      average: number;
      eligibleShops: number;
      byProduct: Array<{ productId: string; shortName: string; sortOrder: number; average: number }>;
    } | null;
    areaEligibleShopCount: number;
  };
};

const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export async function shopAnalysis(
  shopId: string,
  months = SHOP_ANALYSIS_MONTHS,
): Promise<ShopAnalysis> {
  const shop = await Shop.findById(shopId).lean();
  if (!shop) throw ApiError.notFound("Shop not found");

  const window = monthWindow(currentMonth(), months);
  const windowStart = window[0];
  const windowEnd = endOfMonth(window[window.length - 1]);
  const monthFilter = { $gte: windowStart, $lte: addMonths(windowStart, months - 1) };

  const area = shop.area_id ? await ShopArea.findById(shop.area_id).lean() : null;
  const areaShops = shop.area_id
    ? await Shop.find({ area_id: shop.area_id, is_active: true }, { _id: 1 }).lean()
    : [];
  const areaShopIds = areaShops.map((s) => s._id);
  const areaEligible = areaShopIds.length >= 2;

  const products = await Product.find().sort({ sort_order: 1 }).lean();
  const productById = new Map(products.map((p) => [p._id, p]));

  const links = await ShopProduct.find({ shop_id: shopId }, { product_id: 1 }).lean();
  const activeProducts = products
    .filter((p) => links.some((l) => l.product_id === p._id))
    .map((p) => ({
      id: p._id,
      key: p.key,
      name: p.name,
      shortName: p.short_name,
      sortOrder: p.sort_order,
    }));

  // ---------- Product mix: this shop ----------
  const shopQtyRows = await Order.aggregate<{ _id: string; qty: number }>([
    { $match: { shop_id: shopId, month: monthFilter } },
    { $unwind: "$order_lines" },
    { $group: { _id: "$order_lines.product_id", qty: { $sum: "$order_lines.qty" } } },
  ]);
  const shopTotalQty = round2(shopQtyRows.reduce((sum, r) => sum + r.qty, 0));
  const shopMix = shopQtyRows
    .map((row) => {
      const product = productById.get(row._id);
      if (!product) return null;
      return {
        productId: product._id,
        shortName: product.short_name,
        sortOrder: product.sort_order,
        qty: round2(row.qty),
        sharePct: shopTotalQty > 0 ? round2((row.qty / shopTotalQty) * 100) : 0,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // ---------- Product mix: area average of each shop's own percentages ----------
  let areaMix: ShopAnalysis["productMix"]["area"] = [];
  let areaMixShops = 0;
  if (areaEligible) {
    const rows = await Order.aggregate<{ _id: { shop: string; product: string }; qty: number }>([
      { $match: { shop_id: { $in: areaShopIds }, month: monthFilter } },
      { $unwind: "$order_lines" },
      {
        $group: {
          _id: { shop: "$shop_id", product: "$order_lines.product_id" },
          qty: { $sum: "$order_lines.qty" },
        },
      },
    ]);

    const totalsByShop = new Map<string, number>();
    for (const row of rows) {
      totalsByShop.set(row._id.shop, (totalsByShop.get(row._id.shop) ?? 0) + row.qty);
    }
    const eligibleShops = Array.from(totalsByShop.entries()).filter(([, total]) => total > 0);
    areaMixShops = eligibleShops.length;

    const pctByProduct = new Map<string, number[]>();
    for (const row of rows) {
      const total = totalsByShop.get(row._id.shop) ?? 0;
      if (total <= 0) continue;
      const list = pctByProduct.get(row._id.product) ?? [];
      list.push((row.qty / total) * 100);
      pctByProduct.set(row._id.product, list);
    }

    areaMix = Array.from(pctByProduct.entries())
      .map(([productId, pcts]) => {
        const product = productById.get(productId);
        if (!product) return null;
        return {
          productId,
          shortName: product.short_name,
          sortOrder: product.sort_order,
          sharePct: round2(average(pcts) ?? 0),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // ---------- Order frequency: average gap between consecutive order dates ----------
  const gapsFor = (dates: string[]): number[] => {
    const sorted = [...dates].sort();
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) gaps.push(daysBetween(sorted[i - 1], sorted[i]));
    return gaps;
  };

  const shopOrders = await Order.find(
    { shop_id: shopId, month: monthFilter, order_date: { $ne: null } },
    { order_date: 1 },
  ).lean();
  const shopGaps = gapsFor(shopOrders.map((o) => o.order_date as string));
  const shopFreqDays = average(shopGaps);

  let areaFreq: ShopAnalysis["orderFrequency"]["area"] = null;
  if (areaEligible) {
    const rows = await Order.find(
      { shop_id: { $in: areaShopIds }, month: monthFilter, order_date: { $ne: null } },
      { shop_id: 1, order_date: 1 },
    ).lean();
    const datesByShop = new Map<string, string[]>();
    for (const row of rows) {
      datesByShop.set(row.shop_id, [...(datesByShop.get(row.shop_id) ?? []), row.order_date as string]);
    }
    const perShopAverages = Array.from(datesByShop.values())
      .map((dates) => average(gapsFor(dates)))
      .filter((v): v is number => v !== null);
    const areaAvg = average(perShopAverages);
    if (areaAvg !== null) {
      areaFreq = { avgDays: round2(areaAvg), eligibleShops: perShopAverages.length };
    }
  }

  // ---------- Monthly sales: delivered sales are the recognized-sales source ----------
  const shopMonthRows = await Delivery.aggregate<{ _id: string; sales: number }>([
    { $match: { shop_id: shopId, month: monthFilter } },
    { $group: { _id: "$month", sales: { $sum: "$total_sales" } } },
  ]);
  const shopActiveMonths = shopMonthRows.length;
  const shopSalesAvg = shopActiveMonths
    ? shopMonthRows.reduce((sum, r) => sum + r.sales, 0) / shopActiveMonths
    : null;

  let shopSalesByProduct: Array<{
    productId: string;
    shortName: string;
    sortOrder: number;
    average: number;
  }> = [];
  if (shopActiveMonths > 0) {
    const rows = await Delivery.aggregate<{ _id: string; qty: number }>([
      { $match: { shop_id: shopId, month: monthFilter } },
      { $unwind: "$delivery_lines" },
      { $group: { _id: "$delivery_lines.product_id", qty: { $sum: "$delivery_lines.qty" } } },
    ]);
    shopSalesByProduct = rows
      .map((row) => {
        const product = productById.get(row._id);
        if (!product) return null;
        return {
          productId: product._id,
          shortName: product.short_name,
          sortOrder: product.sort_order,
          average: round2((row.qty * Number(product.selling_price)) / shopActiveMonths),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  let areaSales: ShopAnalysis["monthlySales"]["area"] = null;
  if (areaEligible) {
    const monthRows = await Delivery.aggregate<{ _id: { shop: string; month: string }; sales: number }>([
      { $match: { shop_id: { $in: areaShopIds }, month: monthFilter } },
      { $group: { _id: { shop: "$shop_id", month: "$month" }, sales: { $sum: "$total_sales" } } },
    ]);

    const monthsByShop = new Map<string, { total: number; months: number }>();
    for (const row of monthRows) {
      const entry = monthsByShop.get(row._id.shop) ?? { total: 0, months: 0 };
      entry.total += row.sales;
      entry.months += 1;
      monthsByShop.set(row._id.shop, entry);
    }

    const perShopAverages = Array.from(monthsByShop.values()).map((e) => e.total / e.months);
    const areaAvg = average(perShopAverages);

    if (areaAvg !== null) {
      const productRows = await Delivery.aggregate<{
        _id: { shop: string; product: string };
        qty: number;
      }>([
        { $match: { shop_id: { $in: areaShopIds }, month: monthFilter } },
        { $unwind: "$delivery_lines" },
        {
          $group: {
            _id: { shop: "$shop_id", product: "$delivery_lines.product_id" },
            qty: { $sum: "$delivery_lines.qty" },
          },
        },
      ]);

      const perProductAverages = new Map<string, number[]>();
      for (const row of productRows) {
        const shopMonths = monthsByShop.get(row._id.shop)?.months ?? 0;
        const product = productById.get(row._id.product);
        if (!shopMonths || !product) continue;
        const list = perProductAverages.get(row._id.product) ?? [];
        list.push((row.qty * Number(product.selling_price)) / shopMonths);
        perProductAverages.set(row._id.product, list);
      }

      areaSales = {
        average: round2(areaAvg),
        eligibleShops: perShopAverages.length,
        byProduct: Array.from(perProductAverages.entries())
          .map(([productId, values]) => {
            const product = productById.get(productId)!;
            return {
              productId,
              shortName: product.short_name,
              sortOrder: product.sort_order,
              average: round2(average(values) ?? 0),
            };
          })
          .sort((a, b) => a.sortOrder - b.sortOrder),
      };
    }
  }

  return {
    shop: {
      id: shop._id,
      name: shop.shop_name,
      areaId: shop.area_id ?? null,
      areaName: area?.name ?? null,
    },
    analysisPeriod: {
      months,
      label: `Last ${months} Months`,
      startDate: windowStart,
      endDate: windowEnd,
    },
    activeProducts,
    productMix: {
      shop: shopMix,
      shopTotalQty,
      area: areaMix,
      areaEligibleShops: areaMixShops,
    },
    orderFrequency: {
      shop:
        shopFreqDays !== null
          ? { avgDays: round2(shopFreqDays), orderCount: shopOrders.length }
          : null,
      area: areaFreq,
    },
    monthlySales: {
      shop:
        shopSalesAvg !== null
          ? {
              average: round2(shopSalesAvg),
              activeMonths: shopActiveMonths,
              byProduct: shopSalesByProduct,
            }
          : null,
      area: areaSales,
      areaEligibleShopCount: areaShopIds.length,
    },
  };
}
