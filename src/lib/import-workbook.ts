import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { computeDeliveryTotals, labelsFromSheets, sumQty, type LabelProduct, type Product, type QtyMap } from "./domain";

type Row = Record<string, unknown>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(row: Row, candidates: string[]): unknown {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const hit = keys.find((k) => norm(k) === norm(candidate));
    if (hit !== undefined) return row[hit];
  }
  for (const candidate of candidates) {
    const hit = keys.find((k) => norm(k).includes(norm(candidate)));
    if (hit !== undefined) return row[hit];
  }
  return undefined;
}

const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const number = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function toDate(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null });
}

function findSheet(wb: XLSX.WorkBook, candidates: string[]): string | undefined {
  return wb.SheetNames.find((n) => candidates.some((c) => norm(n) === norm(c)))
    ?? wb.SheetNames.find((n) => candidates.some((c) => norm(n).includes(norm(c))));
}

export type ImportProgress = (message: string) => void;

export type ImportResult = {
  shops: number;
  orders: number;
  deliveries: number;
  payments: number;
  labelOrders: number;
  costs: number;
  warnings: string[];
};

/**
 * Imports a Klinzo workbook. Reads the flat mirror tables (Data_Orders,
 * Data_Deliveries, Data_Payments, Data_Labels, Data_Costs) and the shop
 * registry, then rebuilds the same rows relationally — all delivery money
 * figures are recomputed with the workbook formulas.
 */
export async function importWorkbook(
  file: File,
  products: Product[],
  labelProducts: LabelProduct[],
  onProgress: ImportProgress,
): Promise<ImportResult> {
  const result: ImportResult = {
    shops: 0,
    orders: 0,
    deliveries: 0,
    payments: 0,
    labelOrders: 0,
    costs: 0,
    warnings: [],
  };

  onProgress("Reading workbook…");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });

  const productByLabel = new Map<string, Product>();
  products.forEach((p) => {
    productByLabel.set(norm(p.short_name), p);
    productByLabel.set(norm(p.name), p);
    productByLabel.set(norm(p.key), p);
  });
  const labelByLabel = new Map<string, LabelProduct>();
  labelProducts.forEach((lp) => {
    labelByLabel.set(norm(lp.short_name), lp);
    labelByLabel.set(norm(lp.name), lp);
    labelByLabel.set(norm(lp.key), lp);
  });

  // ---- shops ----
  onProgress("Importing shops…");
  const shopSheet = findSheet(wb, ["Shop Registry", "Shop List"]);
  const shopRows = shopSheet ? sheetRows(wb, shopSheet) : [];
  const shopPayload = shopRows
    .map((row, i) => {
      const name = text(pick(row, ["Shop Name", "Shop", "Name"]));
      if (!name) return null;
      return {
        code: text(pick(row, ["Shop Code", "Code", "Shop No"])) || `S${String(i + 1).padStart(3, "0")}`,
        folder_name: text(pick(row, ["Folder Name", "Sheet"])) || null,
        shop_name: name,
        label_name: text(pick(row, ["Label Name"])) || null,
        design_type: number(pick(row, ["Design Type", "Design"])) || 1,
        address: text(pick(row, ["Address"])) || null,
        mobile: text(pick(row, ["Mobile", "Phone", "Contact"])) || null,
        handled_by: text(pick(row, ["Handled By", "Handler"])) || null,
        joined_on: toDate(pick(row, ["Joined On", "Join Date", "Date"])),
        is_active: true,
      };
    })
    .filter(Boolean) as never[];

  if (shopPayload.length) {
    const { error } = await supabase.from("shops").upsert(shopPayload, { onConflict: "code" });
    if (error) result.warnings.push(`Shops: ${error.message}`);
    else result.shops = shopPayload.length;
  } else {
    result.warnings.push("No shop registry sheet found — shops were not imported.");
  }

  const { data: shopRecords } = await supabase.from("shops").select("id, code, shop_name");
  const shopByName = new Map<string, string>();
  ((shopRecords ?? []) as Array<{ id: string; code: string; shop_name: string }>).forEach((s) => {
    shopByName.set(norm(s.shop_name), s.id);
    shopByName.set(norm(s.code), s.id);
  });
  const resolveShop = (row: Row) => {
    const key = text(pick(row, ["Shop Name", "Shop", "Shop Code"]));
    return key ? shopByName.get(norm(key)) : undefined;
  };

  const qtyFromRow = (row: Row): QtyMap => {
    const qty: QtyMap = {};
    for (const [rawKey, value] of Object.entries(row)) {
      const product = productByLabel.get(norm(rawKey));
      if (product && number(value) > 0) qty[product.id] = number(value);
    }
    return qty;
  };

  // ---- orders ----
  const orderSheet = findSheet(wb, ["Data_Orders"]);
  const orderRows = orderSheet ? sheetRows(wb, orderSheet) : [];
  const orderIdByKey = new Map<string, string>();
  if (orderRows.length) {
    onProgress(`Importing ${orderRows.length} orders…`);
    const counters = new Map<string, number>();
    for (const row of orderRows) {
      const shopId = resolveShop(row);
      const date = toDate(pick(row, ["Order Date", "Date"]));
      if (!shopId || !date) continue;
      const qty = qtyFromRow(row);
      const total = sumQty(qty) || number(pick(row, ["Total", "Total Qty"]));
      const next = (counters.get(shopId) ?? 0) + 1;
      counters.set(shopId, next);
      const orderNo = number(pick(row, ["Order No", "Order Number", "SR", "Sr No"])) || next;

      const { data, error } = await supabase
        .from("orders")
        .upsert(
          { shop_id: shopId, order_no: orderNo, order_date: date, total_qty: total },
          { onConflict: "shop_id,order_no" },
        )
        .select("id")
        .single();
      if (error) {
        result.warnings.push(`Order ${orderNo}: ${error.message}`);
        continue;
      }
      const orderId = (data as { id: string }).id;
      orderIdByKey.set(`${shopId}:${orderNo}`, orderId);
      const lines = Object.entries(qty).map(([product_id, q]) => ({ order_id: orderId, product_id, qty: q }));
      if (lines.length) await supabase.from("order_lines").upsert(lines, { onConflict: "order_id,product_id" });
      result.orders += 1;
    }
  }

  // ---- deliveries ----
  const deliverySheet = findSheet(wb, ["Data_Deliveries"]);
  const deliveryRows = deliverySheet ? sheetRows(wb, deliverySheet) : [];
  if (deliveryRows.length) {
    onProgress(`Importing ${deliveryRows.length} deliveries…`);
    for (const row of deliveryRows) {
      const shopId = resolveShop(row);
      const date = toDate(pick(row, ["Delivery Date", "Date"]));
      const orderNo = number(pick(row, ["Order No", "Order Number", "SR", "Sr No"]));
      const orderId = orderIdByKey.get(`${shopId}:${orderNo}`);
      if (!shopId || !orderId || !date) continue;
      const qty = qtyFromRow(row);
      const totals = computeDeliveryTotals(qty, products);
      const { data, error } = await supabase
        .from("deliveries")
        .upsert(
          {
            shop_id: shopId,
            order_id: orderId,
            delivery_date: date,
            status: text(pick(row, ["Status"])) || "Delivered",
            total_qty: totals.totalQty,
            total_sales: totals.totalSales,
            labelling_cost: totals.labellingCost,
            packaging_cost: totals.packagingCost,
            production_cost: totals.productionCost,
            total_fixed_cost: totals.totalFixedCost,
            profit: totals.profit,
          },
          { onConflict: "order_id" },
        )
        .select("id")
        .single();
      if (error) {
        result.warnings.push(`Delivery ${orderNo}: ${error.message}`);
        continue;
      }
      const lines = Object.entries(qty).map(([product_id, q]) => ({
        delivery_id: (data as { id: string }).id,
        product_id,
        qty: q,
      }));
      if (lines.length) await supabase.from("delivery_lines").upsert(lines, { onConflict: "delivery_id,product_id" });
      result.deliveries += 1;
    }
  }

  // ---- payments ----
  const paymentSheet = findSheet(wb, ["Data_Payments"]);
  const paymentRows = paymentSheet ? sheetRows(wb, paymentSheet) : [];
  if (paymentRows.length) {
    onProgress(`Importing ${paymentRows.length} payments…`);
    for (const row of paymentRows) {
      const shopId = resolveShop(row);
      const orderNo = number(pick(row, ["Order No", "Order Number", "SR", "Sr No"]));
      const orderId = orderIdByKey.get(`${shopId}:${orderNo}`);
      const date = toDate(pick(row, ["Payment Date", "Date"]));
      if (!shopId || !orderId || !date) continue;
      const { error } = await supabase.from("payments").upsert(
        {
          shop_id: shopId,
          order_id: orderId,
          payment_date: date,
          status: text(pick(row, ["Status"])) || "Received",
          collected_by: text(pick(row, ["Collected By", "Received By"])) || null,
          amount: number(pick(row, ["Amount", "Payment", "Paid"])),
        },
        { onConflict: "order_id" },
      );
      if (error) result.warnings.push(`Payment ${orderNo}: ${error.message}`);
      else result.payments += 1;
    }
  }

  // ---- label orders ----
  const labelSheet = findSheet(wb, ["Data_Labels"]);
  const labelRows = labelSheet ? sheetRows(wb, labelSheet) : [];
  if (labelRows.length) {
    onProgress(`Importing ${labelRows.length} label orders…`);
    const counters = new Map<string, number>();
    for (const row of labelRows) {
      const shopId = resolveShop(row);
      const date = toDate(pick(row, ["Label Order Date", "Order Date", "Date"]));
      if (!shopId || !date) continue;
      const sheets: Record<string, number> = {};
      for (const [rawKey, value] of Object.entries(row)) {
        const lp = labelByLabel.get(norm(rawKey));
        if (lp && number(value) > 0) sheets[lp.id] = number(value);
      }
      const totalLabels = labelProducts.reduce(
        (acc, lp) => acc + labelsFromSheets(sheets[lp.id] ?? 0, lp.labels_per_sheet),
        0,
      );
      const next = (counters.get(shopId) ?? 0) + 1;
      counters.set(shopId, next);
      const orderNo = number(pick(row, ["Order No", "SR", "Sr No"])) || next;

      const { data, error } = await supabase
        .from("label_orders")
        .upsert(
          { shop_id: shopId, order_no: orderNo, order_date: date, total_labels: totalLabels },
          { onConflict: "shop_id,order_no" },
        )
        .select("id")
        .single();
      if (error) {
        result.warnings.push(`Label order ${orderNo}: ${error.message}`);
        continue;
      }
      const lines = Object.entries(sheets).map(([label_product_id, s]) => ({
        label_order_id: (data as { id: string }).id,
        label_product_id,
        sheets: s,
        products: labelsFromSheets(s, labelProducts.find((lp) => lp.id === label_product_id)?.labels_per_sheet ?? 0),
      }));
      if (lines.length)
        await supabase.from("label_order_lines").upsert(lines, { onConflict: "label_order_id,label_product_id" });
      result.labelOrders += 1;
    }
  }

  // ---- variable costs ----
  const costSheet = findSheet(wb, ["Data_Costs", "Variable Cost"]);
  const costRows = costSheet ? sheetRows(wb, costSheet) : [];
  const costPayload = costRows
    .map((row) => {
      const date = toDate(pick(row, ["Date", "Cost Date"]));
      const amount = number(pick(row, ["Amount", "Cost", "Value"]));
      if (!date || !amount) return null;
      return {
        cost_date: date,
        amount,
        cost_type: text(pick(row, ["Type", "Cost Type", "Category"])) || "Other",
        note: text(pick(row, ["Note", "Remark", "Description"])) || null,
      };
    })
    .filter(Boolean) as never[];
  if (costPayload.length) {
    onProgress(`Importing ${costPayload.length} variable costs…`);
    const { error } = await supabase.from("variable_costs").insert(costPayload);
    if (error) result.warnings.push(`Costs: ${error.message}`);
    else result.costs = costPayload.length;
  }

  onProgress("Import complete");
  return result;
}