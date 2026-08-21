import * as XLSX from "xlsx";

import { LabelProduct, Product } from "../models/catalogue.model.js";
import { VariableCost } from "../models/finance.model.js";
import { LabelOrder, Order, Payment } from "../models/order.model.js";
import { Shop } from "../models/shop.model.js";
import { monthKey, round2, toIsoDate } from "../utils/date.js";
import { setOrderDelivered } from "./order.service.js";

/**
 * Excel workbook import — the one-step migration from the original
 * ~100-sheet workbook.
 *
 * Parsing and writing both happen here, on the server: the browser only
 * uploads the file. Re-running the import updates instead of duplicating
 * (shops match on code, orders and label orders on shop + order number,
 * deliveries and payments on their order), so a partially failed import can
 * simply be run again.
 *
 * Delivery money figures are never trusted from the sheet — they are
 * recomputed from the current rates, so imported history always agrees with
 * the workbook's formulas.
 */
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

function excelDate(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  return toIsoDate(v);
}

function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null });
}

function findSheet(wb: XLSX.WorkBook, candidates: string[]): string | undefined {
  return (
    wb.SheetNames.find((n) => candidates.some((c) => norm(n) === norm(c))) ??
    wb.SheetNames.find((n) => candidates.some((c) => norm(n).includes(norm(c))))
  );
}

export type ImportResult = {
  shops: number;
  orders: number;
  deliveries: number;
  payments: number;
  labelOrders: number;
  costs: number;
  warnings: string[];
};

export async function importWorkbook(buffer: Buffer): Promise<ImportResult> {
  const result: ImportResult = {
    shops: 0,
    orders: 0,
    deliveries: 0,
    payments: 0,
    labelOrders: 0,
    costs: 0,
    warnings: [],
  };

  const wb = XLSX.read(buffer, { type: "buffer" });
  const [products, labelProducts] = await Promise.all([
    Product.find().sort({ sort_order: 1 }).lean(),
    LabelProduct.find().sort({ sort_order: 1 }).lean(),
  ]);

  const productByLabel = new Map<string, (typeof products)[number]>();
  for (const p of products) {
    productByLabel.set(norm(p.short_name), p);
    productByLabel.set(norm(p.name), p);
    productByLabel.set(norm(p.key), p);
  }
  const labelByLabel = new Map<string, (typeof labelProducts)[number]>();
  for (const lp of labelProducts) {
    labelByLabel.set(norm(lp.short_name), lp);
    labelByLabel.set(norm(lp.name), lp);
    labelByLabel.set(norm(lp.key), lp);
  }

  // ---- shops ----
  const shopSheet = findSheet(wb, ["Shop Registry", "Shop List"]);
  const shopRows = shopSheet ? sheetRows(wb, shopSheet) : [];
  if (shopRows.length === 0) {
    result.warnings.push("No shop registry sheet found — shops were not imported.");
  }

  for (const [i, row] of shopRows.entries()) {
    const shop_name = text(pick(row, ["Shop Name", "Shop", "Name"]));
    if (!shop_name) continue;
    const code =
      text(pick(row, ["Shop Code", "Code", "Shop No"])) || `S${String(i + 1).padStart(3, "0")}`;
    try {
      await Shop.updateOne(
        { code },
        {
          $set: {
            folder_name: text(pick(row, ["Folder Name", "Sheet"])) || null,
            shop_name,
            label_name: text(pick(row, ["Label Name"])) || null,
            design_type: number(pick(row, ["Design Type", "Design"])) || 1,
            address: text(pick(row, ["Address"])) || null,
            mobile: text(pick(row, ["Mobile", "Phone", "Contact"])) || null,
            handled_by: text(pick(row, ["Handled By", "Handler"])) || null,
            joined_on: excelDate(pick(row, ["Joined On", "Join Date", "Date"])),
          },
          $setOnInsert: { code, is_active: true },
        },
        { upsert: true },
      );
      result.shops += 1;
    } catch (error) {
      result.warnings.push(`Shop ${shop_name}: ${(error as Error).message}`);
    }
  }

  const shopRecords = await Shop.find({}, { code: 1, shop_name: 1 }).lean();
  const shopByName = new Map<string, string>();
  for (const s of shopRecords) {
    shopByName.set(norm(s.shop_name), s._id);
    shopByName.set(norm(s.code), s._id);
  }
  const resolveShop = (row: Row) => {
    const key = text(pick(row, ["Shop Name", "Shop", "Shop Code"]));
    return key ? shopByName.get(norm(key)) : undefined;
  };

  const linesFromRow = (row: Row) =>
    Object.entries(row)
      .map(([rawKey, value]) => {
        const product = productByLabel.get(norm(rawKey));
        const qty = number(value);
        return product && qty > 0 ? { product_id: product._id, qty } : null;
      })
      .filter((l): l is { product_id: string; qty: number } => l !== null);

  // ---- orders ----
  const orderSheet = findSheet(wb, ["Data_Orders"]);
  const orderIdByKey = new Map<string, string>();
  const counters = new Map<string, number>();

  for (const row of orderSheet ? sheetRows(wb, orderSheet) : []) {
    const shop_id = resolveShop(row);
    const order_date = excelDate(pick(row, ["Order Date", "Date"]));
    if (!shop_id || !order_date) continue;

    const order_lines = linesFromRow(row);
    const total_qty =
      order_lines.reduce((sum, l) => sum + l.qty, 0) || number(pick(row, ["Total", "Total Qty"]));
    const next = (counters.get(shop_id) ?? 0) + 1;
    counters.set(shop_id, next);
    const order_no = number(pick(row, ["Order No", "Order Number", "SR", "Sr No"])) || next;

    try {
      const order = await Order.findOneAndUpdate(
        { shop_id, order_no },
        {
          $set: {
            order_date,
            month: monthKey(order_date),
            total_qty: round2(total_qty),
            order_lines,
          },
          $setOnInsert: { shop_id, order_no, delivery_date: order_date, status: "Pending" },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      orderIdByKey.set(`${shop_id}:${order_no}`, order._id);
      result.orders += 1;
    } catch (error) {
      result.warnings.push(`Order ${order_no}: ${(error as Error).message}`);
    }
  }

  // ---- deliveries ----
  const deliverySheet = findSheet(wb, ["Data_Deliveries"]);
  for (const row of deliverySheet ? sheetRows(wb, deliverySheet) : []) {
    const shop_id = resolveShop(row);
    const delivery_date = excelDate(pick(row, ["Delivery Date", "Date"]));
    const order_no = number(pick(row, ["Order No", "Order Number", "SR", "Sr No"]));
    const order_id = orderIdByKey.get(`${shop_id}:${order_no}`);
    if (!shop_id || !order_id || !delivery_date) continue;

    try {
      // Reuses the same code path the app uses when an order is marked
      // delivered, so imported deliveries and payments are identical to ones
      // created through the UI.
      await setOrderDelivered(order_id, delivery_date);
      result.deliveries += 1;
    } catch (error) {
      result.warnings.push(`Delivery ${order_no}: ${(error as Error).message}`);
    }
  }

  // ---- payments ----
  const paymentSheet = findSheet(wb, ["Data_Payments"]);
  for (const row of paymentSheet ? sheetRows(wb, paymentSheet) : []) {
    const shop_id = resolveShop(row);
    const order_no = number(pick(row, ["Order No", "Order Number", "SR", "Sr No"]));
    const order_id = orderIdByKey.get(`${shop_id}:${order_no}`);
    const payment_date = excelDate(pick(row, ["Payment Date", "Date"]));
    if (!shop_id || !order_id || !payment_date) continue;

    try {
      await Payment.updateOne(
        { order_id },
        {
          $set: {
            shop_id,
            payment_date,
            month: monthKey(payment_date),
            status: text(pick(row, ["Status"])) || "Received",
            collected_by: text(pick(row, ["Collected By", "Received By"])) || null,
            amount: number(pick(row, ["Amount", "Payment", "Paid"])),
          },
          $setOnInsert: { order_id },
        },
        { upsert: true },
      );
      result.payments += 1;
    } catch (error) {
      result.warnings.push(`Payment ${order_no}: ${(error as Error).message}`);
    }
  }

  // ---- label orders ----
  const labelSheet = findSheet(wb, ["Data_Labels"]);
  const labelCounters = new Map<string, number>();
  for (const row of labelSheet ? sheetRows(wb, labelSheet) : []) {
    const shop_id = resolveShop(row);
    const order_date = excelDate(pick(row, ["Label Order Date", "Order Date", "Date"]));
    if (!shop_id || !order_date) continue;

    const label_order_lines = Object.entries(row)
      .map(([rawKey, value]) => {
        const lp = labelByLabel.get(norm(rawKey));
        const sheets = number(value);
        if (!lp || sheets <= 0) return null;
        return {
          label_product_id: lp._id,
          sheets,
          products: round2(sheets * Number(lp.labels_per_sheet)),
        };
      })
      .filter((l): l is { label_product_id: string; sheets: number; products: number } => l !== null);

    const next = (labelCounters.get(shop_id) ?? 0) + 1;
    labelCounters.set(shop_id, next);
    const order_no = number(pick(row, ["Order No", "SR", "Sr No"])) || next;

    try {
      await LabelOrder.updateOne(
        { shop_id, order_no },
        {
          $set: {
            order_date,
            month: monthKey(order_date),
            total_labels: round2(label_order_lines.reduce((sum, l) => sum + l.products, 0)),
            label_order_lines,
          },
          $setOnInsert: { shop_id, order_no },
        },
        { upsert: true },
      );
      result.labelOrders += 1;
    } catch (error) {
      result.warnings.push(`Label order ${order_no}: ${(error as Error).message}`);
    }
  }

  // ---- variable costs ----
  const costSheet = findSheet(wb, ["Data_Costs", "Variable Cost"]);
  for (const row of costSheet ? sheetRows(wb, costSheet) : []) {
    const cost_date = excelDate(pick(row, ["Date", "Cost Date"]));
    const amount = number(pick(row, ["Amount", "Cost", "Value"]));
    if (!cost_date || !amount) continue;

    const cost_type = text(pick(row, ["Type", "Cost Type", "Category"])) || "Others";
    const note = text(pick(row, ["Note", "Remark", "Description"])) || null;

    try {
      // Costs carry no natural key in the workbook, so an identical
      // date+type+amount+note row is treated as the same cost rather than
      // inserted twice on a re-run.
      await VariableCost.updateOne(
        { cost_date, cost_type, amount, note },
        { $set: { month: monthKey(cost_date) }, $setOnInsert: { cost_date, cost_type, amount, note } },
        { upsert: true },
      );
      result.costs += 1;
    } catch (error) {
      result.warnings.push(`Cost ${cost_date}: ${(error as Error).message}`);
    }
  }

  return result;
}
