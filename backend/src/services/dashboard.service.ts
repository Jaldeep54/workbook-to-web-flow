import { LabelProduct, Product } from "../models/catalogue.model.js";
import { Delivery, LabelOrder, Order, Payment } from "../models/order.model.js";
import { VariableCost } from "../models/finance.model.js";
import { Shop, ShopProduct } from "../models/shop.model.js";
import { addMonths, round2 } from "../utils/date.js";

/**
 * Monthly KPI summary — the MongoDB port of `dashboard_summary()` /
 * `dashboard_summary_by_area()`.
 *
 * Everything is aggregated in the database rather than shipping raw rows to
 * the browser, exactly as the RPC did, and both the whole-business and
 * area-scoped views come from this one function so the two can never report
 * different totals for the same month.
 *
 * `variableCost` is deliberately *not* area-scoped: the variable cost register
 * has no shop or area dimension (transport, salaries...), so an area-scoped
 * dashboard still shows the whole business's figure.
 */
export type DashboardSummary = {
  month: string;
  areaId: string | null;
  orderCount: number;
  orderQty: number;
  orderByProduct: Record<string, number>;
  deliveryCount: number;
  deliveryQty: number;
  deliveryByProduct: Record<string, number>;
  totalSales: number;
  totalFixedCost: number;
  paymentCount: number;
  paymentsReceived: number;
  paymentsPending: number;
  variableCost: number;
  labelOrderCount: number;
  labelByProduct: Record<string, number>;
  totalLabels: number;
  monthlySales: Array<{ month: string; totalSales: number }>;
  productMix: Array<{
    productId: string;
    shortName: string;
    sortOrder: number;
    amount: number;
    sharePct: number;
  }>;
  topShops: Array<{ shopId: string; shopName: string; sales: number }>;
};

/** Shop ids inside an area — the scoping key every area-aware query uses. */
async function shopIdsInArea(areaId: string | null): Promise<string[] | null> {
  if (!areaId) return null;
  const shops = await Shop.find({ area_id: areaId }, { _id: 1 }).lean();
  return shops.map((s) => s._id);
}

function scoped(filter: Record<string, unknown>, shopIds: string[] | null) {
  return shopIds ? { ...filter, shop_id: { $in: shopIds } } : filter;
}

async function sumField(
  model: typeof Order | typeof Delivery | typeof Payment | typeof LabelOrder | typeof VariableCost,
  filter: Record<string, unknown>,
  field: string,
): Promise<number> {
  const [row] = await (model as typeof Order).aggregate<{ total: number }>([
    { $match: filter },
    { $group: { _id: null, total: { $sum: `$${field}` } } },
  ]);
  return round2(row?.total ?? 0);
}

/** Σ line quantities per product, keyed by the product's stable `key`. */
async function qtyByProductKey(
  model: typeof Order | typeof Delivery,
  filter: Record<string, unknown>,
  linesPath: "order_lines" | "delivery_lines",
): Promise<Record<string, number>> {
  const rows = await (model as typeof Order).aggregate<{ _id: string; qty: number }>([
    { $match: filter },
    { $unwind: `$${linesPath}` },
    { $group: { _id: `$${linesPath}.product_id`, qty: { $sum: `$${linesPath}.qty` } } },
  ]);
  const products = await Product.find({}, { key: 1 }).lean();
  const keyById = new Map(products.map((p) => [p._id, p.key]));

  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = keyById.get(row._id);
    if (key) out[key] = round2(row.qty);
  }
  return out;
}

async function labelsByProductKey(filter: Record<string, unknown>): Promise<Record<string, number>> {
  const rows = await LabelOrder.aggregate<{ _id: string; qty: number }>([
    { $match: filter },
    { $unwind: "$label_order_lines" },
    {
      $group: {
        _id: "$label_order_lines.label_product_id",
        qty: { $sum: "$label_order_lines.products" },
      },
    },
  ]);
  const labelProducts = await LabelProduct.find({}, { key: 1 }).lean();
  const keyById = new Map(labelProducts.map((lp) => [lp._id, lp.key]));

  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = keyById.get(row._id);
    if (key) out[key] = round2(row.qty);
  }
  return out;
}

/** Revenue per product for a month = Σ delivered qty x current selling price. */
async function productRevenueMix(filter: Record<string, unknown>) {
  const rows = await Delivery.aggregate<{ _id: string; qty: number }>([
    { $match: filter },
    { $unwind: "$delivery_lines" },
    { $group: { _id: "$delivery_lines.product_id", qty: { $sum: "$delivery_lines.qty" } } },
  ]);
  const products = await Product.find().sort({ sort_order: 1 }).lean();
  const productById = new Map(products.map((p) => [p._id, p]));

  const amounts = rows
    .map((row) => {
      const product = productById.get(row._id);
      if (!product) return null;
      return {
        productId: product._id,
        shortName: product.short_name,
        sortOrder: product.sort_order,
        amount: round2(row.qty * Number(product.selling_price)),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const total = amounts.reduce((sum, r) => sum + r.amount, 0);
  return amounts.map((row) => ({
    ...row,
    sharePct: total > 0 ? round2((row.amount / total) * 100) : 0,
  }));
}

/**
 * What is still owed across a set of payments: Σ (amount − amount received),
 * floored at zero per row so an overpayment on one order can never mask a
 * genuine debt on another.
 */
async function outstandingTotal(filter: Record<string, unknown>): Promise<number> {
  const [row] = await Payment.aggregate<{ total: number }>([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $max: [0, { $subtract: ["$amount", { $ifNull: ["$amount_received", 0] }] }],
          },
        },
      },
    },
  ]);
  return round2(row?.total ?? 0);
}

export async function dashboardSummary(
  month: string,
  areaId: string | null = null,
): Promise<DashboardSummary> {
  const shopIds = await shopIdsInArea(areaId);
  const monthFilter = scoped({ month }, shopIds);

  const windowStart = addMonths(month, -2);
  const trendMonths = [windowStart, addMonths(month, -1), month];

  const [
    orderCount,
    orderQty,
    orderByProduct,
    deliveryCount,
    deliveryQty,
    deliveryByProduct,
    totalSales,
    totalFixedCost,
    paymentCount,
    paymentsReceived,
    paymentsPending,
    variableCost,
    labelOrderCount,
    labelByProduct,
    totalLabels,
    trendRows,
    productMix,
    topShopRows,
  ] = await Promise.all([
    Order.countDocuments(scoped({ month, total_qty: { $gt: 0 } }, shopIds)),
    sumField(Order, monthFilter, "total_qty"),
    qtyByProductKey(Order, monthFilter, "order_lines"),
    Delivery.countDocuments(scoped({ month, total_qty: { $gt: 0 } }, shopIds)),
    sumField(Delivery, monthFilter, "total_qty"),
    qtyByProductKey(Delivery, monthFilter, "delivery_lines"),
    sumField(Delivery, monthFilter, "total_sales"),
    sumField(Delivery, monthFilter, "total_fixed_cost"),
    // Money, not statuses: a part payment is cash in hand for what arrived and
    // outstanding for the rest, so both figures are sums over every payment
    // rather than over the rows carrying a particular status.
    Payment.countDocuments(scoped({ month, amount_received: { $gt: 0 } }, shopIds)),
    sumField(Payment, monthFilter, "amount_received"),
    outstandingTotal(scoped({ month }, shopIds)),
    sumField(VariableCost, { month }, "amount"),
    LabelOrder.countDocuments(scoped({ month, total_labels: { $gt: 0 } }, shopIds)),
    labelsByProductKey(monthFilter),
    sumField(LabelOrder, monthFilter, "total_labels"),
    Delivery.aggregate<{ _id: string; sales: number }>([
      { $match: scoped({ month: { $in: trendMonths } }, shopIds) },
      { $group: { _id: "$month", sales: { $sum: "$total_sales" } } },
    ]),
    productRevenueMix(monthFilter),
    Delivery.aggregate<{ _id: string; sales: number }>([
      { $match: monthFilter },
      { $group: { _id: "$shop_id", sales: { $sum: "$total_sales" } } },
      { $sort: { sales: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const salesByMonth = new Map(trendRows.map((r) => [r._id, round2(r.sales)]));
  const topShopNames = await Shop.find(
    { _id: { $in: topShopRows.map((r) => r._id) } },
    { shop_name: 1 },
  ).lean();
  const shopNameById = new Map(topShopNames.map((s) => [s._id, s.shop_name]));

  return {
    month,
    areaId,
    orderCount,
    orderQty,
    orderByProduct,
    deliveryCount,
    deliveryQty,
    deliveryByProduct,
    totalSales,
    totalFixedCost,
    paymentCount,
    paymentsReceived,
    paymentsPending,
    variableCost,
    labelOrderCount,
    labelByProduct,
    totalLabels,
    monthlySales: trendMonths.map((m) => ({ month: m, totalSales: salesByMonth.get(m) ?? 0 })),
    productMix,
    topShops: topShopRows.map((r) => ({
      shopId: r._id,
      shopName: shopNameById.get(r._id) ?? "Unknown shop",
      sales: round2(r.sales),
    })),
  };
}

/** Every month that has data, newest first — drives the month pickers. */
export async function availableMonths(): Promise<string[]> {
  const [orders, deliveries, payments, labelOrders, costs] = await Promise.all([
    Order.distinct("month", { month: { $ne: null } }),
    Delivery.distinct("month", { month: { $ne: null } }),
    Payment.distinct("month", { month: { $ne: null } }),
    LabelOrder.distinct("month", { month: { $ne: null } }),
    VariableCost.distinct("month", { month: { $ne: null } }),
  ]);
  const all = new Set<string>(
    [...orders, ...deliveries, ...payments, ...labelOrders, ...costs].filter(Boolean) as string[],
  );
  return Array.from(all).sort((a, b) => b.localeCompare(a));
}

export type ProductQtyRow = {
  product_id: string;
  product_key: string;
  short_name: string;
  sort_order: number;
  total_qty: number;
};

/** Lifetime ordered quantity per product, across every shop. */
export async function orderQtyByProduct(): Promise<ProductQtyRow[]> {
  const [products, rows] = await Promise.all([
    Product.find().sort({ sort_order: 1 }).lean(),
    Order.aggregate<{ _id: string; qty: number }>([
      { $unwind: "$order_lines" },
      { $group: { _id: "$order_lines.product_id", qty: { $sum: "$order_lines.qty" } } },
    ]),
  ]);
  const qtyById = new Map(rows.map((r) => [r._id, r.qty]));

  return products.map((p) => ({
    product_id: p._id,
    product_key: p.key,
    short_name: p.short_name,
    sort_order: p.sort_order,
    total_qty: round2(qtyById.get(p._id) ?? 0),
  }));
}

export type SkuOpportunityRow = {
  shop_id: string;
  shop_name: string;
  label_name: string | null;
  address: string | null;
  is_active: boolean;
  active_products: string[];
  inactive_products: string[];
  avg_monthly_sales: number;
  total_sales: number;
  active_months: number;
};

/**
 * Which products each shop does and doesn't carry, next to what it actually
 * sells — the cross-sell list (`shop_sku_opportunity`). "Active months" counts
 * distinct months with a delivery, so the average isn't diluted by months the
 * shop wasn't trading at all.
 */
export async function skuOpportunity(): Promise<SkuOpportunityRow[]> {
  const [shops, products, links, salesRows] = await Promise.all([
    Shop.find().sort({ shop_name: 1 }).lean(),
    Product.find().sort({ sort_order: 1 }).lean(),
    ShopProduct.find({}, { shop_id: 1, product_id: 1 }).lean(),
    Delivery.aggregate<{ _id: string; total: number; months: string[] }>([
      { $group: { _id: "$shop_id", total: { $sum: "$total_sales" }, months: { $addToSet: "$month" } } },
    ]),
  ]);

  const linksByShop = new Map<string, Set<string>>();
  for (const link of links) {
    const set = linksByShop.get(link.shop_id) ?? new Set<string>();
    set.add(link.product_id);
    linksByShop.set(link.shop_id, set);
  }
  const salesByShop = new Map(salesRows.map((r) => [r._id, r]));

  return shops.map((shop) => {
    const carried = linksByShop.get(shop._id) ?? new Set<string>();
    const sales = salesByShop.get(shop._id);
    const activeMonths = (sales?.months ?? []).filter(Boolean).length;
    const totalSales = round2(sales?.total ?? 0);

    return {
      shop_id: shop._id,
      shop_name: shop.shop_name,
      label_name: shop.label_name ?? null,
      address: shop.address ?? null,
      is_active: shop.is_active,
      active_products: products.filter((p) => carried.has(p._id)).map((p) => p.short_name),
      inactive_products: products.filter((p) => !carried.has(p._id)).map((p) => p.short_name),
      avg_monthly_sales: activeMonths > 0 ? round2(totalSales / activeMonths) : 0,
      total_sales: totalSales,
      active_months: activeMonths,
    };
  });
}
