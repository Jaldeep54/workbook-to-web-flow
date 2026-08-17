/**
 * Business logic ported 1:1 from the Klinzo Excel workbook.
 *
 * Workbook rules preserved here:
 *  - Sales            = Σ qty × selling price
 *  - Labelling cost   = Σ qty × label cost per unit
 *  - Jar & can cost   = Σ qty × packaging cost
 *  - Production cost  = Σ qty × production cost
 *  - Total fixed cost = production + jar & can + labelling
 *  - Profit           = sales − total fixed cost
 *  - Payment due      = sales − amount received
 *  - Label stock      = Σ (sheets × labels per sheet) − Σ ordered quantity of that product
 */

export type Product = {
  id: string;
  key: string;
  name: string;
  short_name: string;
  sort_order: number;
  selling_price: number;
  production_cost: number;
  packaging_cost: number;
  /**
   * Sum of `sheet_cost / labels_per_sheet` across every label_products row for this
   * product (Rates & Settings → Label rates). Kept in sync by a database trigger
   * whenever a label is added, removed, re-priced, or reassigned — never edited directly.
   */
  label_cost_per_unit: number;
  is_active: boolean;
};

export type LabelProduct = {
  id: string;
  key: string;
  name: string;
  short_name: string;
  sort_order: number;
  product_id: string;
  labels_per_sheet: number;
  sheet_cost: number;
  low_stock_threshold: number;
};

export type Shop = {
  id: string;
  code: string;
  folder_name: string | null;
  shop_name: string;
  label_name: string | null;
  design_type: number;
  area_id: string | null;
  image_path: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  mobile: string | null;
  handled_by: string | null;
  joined_on: string | null;
  is_active: boolean;
};

export type ShopArea = {
  id: string;
  name: string;
};

/** Design types map to a fixed marker color everywhere a shop appears on a map. */
export const DESIGN_TYPE_COLORS: Record<number, string> = {
  1: "#f97316", // orange
  2: "#22c55e", // green
  3: "#3b82f6", // blue
  4: "#ec4899", // pink
};
export const DEFAULT_DESIGN_TYPE_COLOR = "#6b7280"; // gray, for any other/unexpected design type

export function designTypeColor(designType: number): string {
  return DESIGN_TYPE_COLORS[designType] ?? DEFAULT_DESIGN_TYPE_COLOR;
}

export type QtyMap = Record<string, number>;

export type DeliveryTotals = {
  totalQty: number;
  totalSales: number;
  labellingCost: number;
  packagingCost: number;
  productionCost: number;
  totalFixedCost: number;
  profit: number;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function sumQty(qtyByProductId: QtyMap): number {
  return Object.values(qtyByProductId).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** Computes every money figure the workbook derived for a delivery row. */
export function computeDeliveryTotals(qtyByProductId: QtyMap, products: Product[]): DeliveryTotals {
  let totalQty = 0;
  let totalSales = 0;
  let labellingCost = 0;
  let packagingCost = 0;
  let productionCost = 0;

  for (const product of products) {
    const qty = Number(qtyByProductId[product.id]) || 0;
    if (!qty) continue;
    totalQty += qty;
    totalSales += qty * product.selling_price;
    labellingCost += qty * product.label_cost_per_unit;
    packagingCost += qty * product.packaging_cost;
    productionCost += qty * product.production_cost;
  }

  const totalFixedCost = productionCost + packagingCost + labellingCost;

  return {
    totalQty: round2(totalQty),
    totalSales: round2(totalSales),
    labellingCost: round2(labellingCost),
    packagingCost: round2(packagingCost),
    productionCost: round2(productionCost),
    totalFixedCost: round2(totalFixedCost),
    profit: round2(totalSales - totalFixedCost),
  };
}

/** Labels produced from a number of printed sheets. */
export function labelsFromSheets(sheets: number, labelsPerSheet: number): number {
  return round2((Number(sheets) || 0) * (Number(labelsPerSheet) || 0));
}

/** Universal Google Maps directions link — works cross-platform, deep-links into the app on mobile. */
export function googleMapsDirectionsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

export const DELIVERY_STATUSES = ["Pending", "Delivered", "Cancelled"] as const;
export const ORDER_STATUSES = ["Pending", "Delivered", "Cancelled"] as const;
export const PAYMENT_STATUSES = ["Pending", "Received", "Partial"] as const;
export const COST_TYPES = ["Transportation", "Others"] as const;

export function monthKey(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function currentMonth(): string {
  return monthKey(new Date());
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function recentMonths(count = 18): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return out;
}

/**
 * Shop Analysis / Shop Sales Indicator
 *
 * Rolling window length (in months, including the current month) used for every
 * Shop Analysis metric — product mix, order frequency, monthly sales. Centralized
 * here so it can be changed in one place; it's passed straight through to the
 * shop_analysis() Supabase RPC, which does the actual month-bucketed aggregation.
 */
export const SHOP_ANALYSIS_MONTHS = 3;

export type SalesPerformanceStatus =
  "very_low" | "low" | "good" | "very_good" | "no_area" | "insufficient_area_data" | "no_area_data";

export type ShopSalesPerformance = {
  status: SalesPerformanceStatus;
  /** null whenever status is one of the no-data/no-area variants. */
  percentageDifference: number | null;
  shopAverage: number;
  areaAverage: number | null;
};

const STATUS_LABEL: Record<SalesPerformanceStatus, string> = {
  very_low: "Very Low",
  low: "Low",
  good: "Good",
  very_good: "Very Good",
  no_area: "Shop area not assigned",
  insufficient_area_data: "Insufficient area data",
  no_area_data: "Not enough area sales data",
};

export function salesPerformanceLabel(status: SalesPerformanceStatus): string {
  return STATUS_LABEL[status];
}

/**
 * Single source of truth for "is this shop doing well against its area peers?" —
 * used identically by the Shop Analysis tab and the New Order form's Shop Sales
 * Indicator, so the two never disagree. Thresholds live here, not duplicated
 * anywhere else, so they can be tuned in one place later.
 *
 *   Very Low   difference < -20%
 *   Low        -20% <= difference < -1%
 *   Good       -1% <= difference <= +20%
 *   Very Good  difference > +20%
 *
 * `areaAverage`/`eligibleAreaShops` come straight from shop_analysis()'s
 * monthlySales.area (null when no peer shop in the area has sales data yet) and
 * monthlySales.areaEligibleShopCount (total active shops sharing the area,
 * including this one — needs to be >= 2 for a comparison to mean anything).
 */
export function getShopSalesPerformance(
  shopAverage: number,
  areaAverage: number | null,
  hasArea: boolean,
  eligibleAreaShops: number,
): ShopSalesPerformance {
  if (!hasArea) {
    return { status: "no_area", percentageDifference: null, shopAverage, areaAverage: null };
  }
  if (eligibleAreaShops < 2) {
    return {
      status: "insufficient_area_data",
      percentageDifference: null,
      shopAverage,
      areaAverage: null,
    };
  }
  if (areaAverage === null || areaAverage === 0) {
    return {
      status: "no_area_data",
      percentageDifference: null,
      shopAverage,
      areaAverage: areaAverage ?? 0,
    };
  }

  const percentageDifference = ((shopAverage - areaAverage) / areaAverage) * 100;
  let status: SalesPerformanceStatus;
  if (percentageDifference < -20) status = "very_low";
  else if (percentageDifference < -1) status = "low";
  else if (percentageDifference <= 20) status = "good";
  else status = "very_good";

  return { status, percentageDifference, shopAverage, areaAverage };
}

/**
 * Label Order Suggestion
 *
 * Threshold-based reorder recommendation, computed entirely by the
 * label_order_suggestions() RPC (current stock reused verbatim from
 * label_stock_view, never recalculated here):
 *
 *   1-month target = low_stock_threshold + 1 x average monthly usage
 *   2-month target = low_stock_threshold + 2 x average monthly usage
 *   Suggested sheets = CEIL(MAX(0, 2-month target − current stock) / labels per sheet)
 *
 * Average monthly usage is the shop/product's order_lines quantity over the
 * last LABEL_SUGGESTION_HISTORY_MONTHS months (default 3 — the same rolling
 * window shop_analysis() uses for monthlySales) divided by that fixed month
 * count, passed straight through to the RPC so it can be tuned in one place.
 *
 * Status uses the exact same low_stock_threshold the Label Stock table turns
 * red on, so the two indicators can never disagree for the same stock value:
 *   current stock < threshold                       -> urgent
 *   threshold <= current stock < 1-month target      -> recommended
 *   1-month target <= current stock < 2-month target -> monitor
 *   current stock >= 2-month target                  -> no_order_required
 */
export const LABEL_SUGGESTION_HISTORY_MONTHS = 3;

export type LabelSuggestionStatus = "urgent" | "recommended" | "monitor" | "no_order_required";

const LABEL_SUGGESTION_STATUS_LABEL: Record<LabelSuggestionStatus, string> = {
  urgent: "Urgent",
  recommended: "Recommended",
  monitor: "Monitor",
  no_order_required: "No Order Required",
};

export function labelSuggestionStatusLabel(status: LabelSuggestionStatus): string {
  return LABEL_SUGGESTION_STATUS_LABEL[status];
}
