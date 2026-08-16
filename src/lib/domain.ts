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
export function computeDeliveryTotals(
  qtyByProductId: QtyMap,
  products: Product[],
): DeliveryTotals {
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