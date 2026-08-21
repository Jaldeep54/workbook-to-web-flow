import type { Request, Response } from "express";

import { LabelProduct } from "../models/catalogue.model.js";
import { LabelOrder, type ILabelOrder } from "../models/order.model.js";
import { Shop } from "../models/shop.model.js";
import {
  labelOrderSuggestions,
  labelStock,
  labelStockSummary,
} from "../services/label-stock.service.js";
import { nextOrderNo } from "../services/order.service.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, created, ok, paginated } from "../utils/api-response.js";
import { round2 } from "../utils/date.js";
import { parseListQuery } from "../utils/query.js";
import { shopIdsForArea, shopRefs, type ShopRef } from "./order.controller.js";

function present(order: ILabelOrder, shops: Map<string, ShopRef>) {
  const { _id, shop_id, ...rest } = order;
  return { id: _id, shop_id, ...rest, shops: shops.get(shop_id) ?? null };
}

/* ----------------------------------------------------------- label orders */

export async function listLabelOrders(req: Request, res: Response) {
  const { page, limit, skip, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["order_date", "order_no", "total_labels", "created_at"],
    { sortBy: "order_date", sortOrder: "desc", limit: 200 },
  );

  const filter: Record<string, unknown> = {};
  if (req.query.month) filter.month = req.query.month;
  if (req.query.shopId) filter.shop_id = req.query.shopId;
  if (req.query.date) filter.order_date = req.query.date;

  const areaShopIds = await shopIdsForArea(req.query.areaId as string | undefined);
  if (areaShopIds) {
    filter.shop_id = filter.shop_id
      ? { $in: areaShopIds.filter((id) => id === filter.shop_id) }
      : { $in: areaShopIds };
  }

  const [rows, total] = await Promise.all([
    LabelOrder.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    LabelOrder.countDocuments(filter),
  ]);

  const shops = await shopRefs(rows.map((r) => r.shop_id));
  return paginated(
    res,
    rows.map((row) => present(row, shops)),
    buildPaginationMeta(page, limit, total),
  );
}

type LabelLineInput = { label_product_id: string; sheets: number };

/**
 * Builds the stored lines for a label order. `products` (labels produced) is
 * frozen at order time from the label's current labels-per-sheet, exactly as
 * the workbook did — later rate changes must not rewrite history.
 */
async function buildLines(lines: LabelLineInput[]) {
  const labelProducts = await LabelProduct.find({
    _id: { $in: lines.map((l) => l.label_product_id) },
  }).lean();
  const byId = new Map(labelProducts.map((lp) => [lp._id, lp]));

  const resolved = lines
    .filter((l) => Number(l.sheets) > 0)
    .map((line) => {
      const labelProduct = byId.get(line.label_product_id);
      if (!labelProduct) throw ApiError.badRequest("Unknown label product in order lines");
      return {
        label_product_id: line.label_product_id,
        sheets: Number(line.sheets),
        products: round2(Number(line.sheets) * Number(labelProduct.labels_per_sheet)),
      };
    });

  if (resolved.length === 0) throw ApiError.badRequest("Enter sheets for at least one label");
  return resolved;
}

export async function createLabelOrder(req: Request, res: Response) {
  const body = req.body as { shop_id: string; order_date: string; lines: LabelLineInput[] };
  if (!(await Shop.exists({ _id: body.shop_id }))) throw ApiError.badRequest("Shop not found");

  const label_order_lines = await buildLines(body.lines);
  const order = await LabelOrder.create({
    shop_id: body.shop_id,
    order_no: await nextOrderNo("label_orders", body.shop_id),
    order_date: body.order_date,
    total_labels: round2(label_order_lines.reduce((sum, l) => sum + l.products, 0)),
    label_order_lines,
  });

  const shops = await shopRefs([order.shop_id]);
  return created(res, present(order.toObject(), shops));
}

/**
 * "Place selected orders" from the suggestion screen. Each shop is attempted
 * independently and reported on individually, so one failure doesn't discard
 * the rest of the batch — the UI keeps the failures selected for a retry.
 */
export async function createLabelOrdersBulk(req: Request, res: Response) {
  const body = req.body as {
    order_date: string;
    orders: Array<{ shop_id: string; lines: LabelLineInput[] }>;
  };

  const successes: Array<{ shop_id: string; id: string; order_no: number }> = [];
  const failures: Array<{ shop_id: string; message: string }> = [];

  for (const entry of body.orders) {
    try {
      if (!(await Shop.exists({ _id: entry.shop_id }))) throw ApiError.badRequest("Shop not found");
      const label_order_lines = await buildLines(entry.lines);
      const order = await LabelOrder.create({
        shop_id: entry.shop_id,
        order_no: await nextOrderNo("label_orders", entry.shop_id),
        order_date: body.order_date,
        total_labels: round2(label_order_lines.reduce((sum, l) => sum + l.products, 0)),
        label_order_lines,
      });
      successes.push({ shop_id: entry.shop_id, id: order._id, order_no: order.order_no });
    } catch (error) {
      failures.push({ shop_id: entry.shop_id, message: (error as Error).message });
    }
  }

  return created(res, { order_date: body.order_date, successes, failures });
}

export async function deleteLabelOrder(req: Request, res: Response) {
  const order = await LabelOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound("Label order not found");
  await order.deleteOne();
  return ok(res, { message: `Label order #${order.order_no} deleted` });
}

/* ------------------------------------------------------------- label stock */

export async function getLabelStock(_req: Request, res: Response) {
  return ok(res, await labelStock());
}

export async function getLabelStockSummary(_req: Request, res: Response) {
  return ok(res, await labelStockSummary());
}

export async function getLabelSuggestions(req: Request, res: Response) {
  const historyMonths = Number(req.query.historyMonths) || 3;
  return ok(res, await labelOrderSuggestions(historyMonths));
}
