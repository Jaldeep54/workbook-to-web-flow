import type { Request, Response } from "express";

import { Delivery, Order, type IOrder } from "../models/order.model.js";
import { Shop } from "../models/shop.model.js";
import {
  deleteOrderCascade,
  nextOrderNo,
  setOrderDelivered,
  setOrderStatus,
} from "../services/order.service.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, created, ok, paginated } from "../utils/api-response.js";
import { financialYearRange, round2 } from "../utils/date.js";
import { parseListQuery } from "../utils/query.js";

/**
 * List rows embed the shop fields the tables display (`shops`), matching the
 * shape the UI already consumed — one request per screen instead of the client
 * stitching shops onto every row.
 */
export type ShopRef = { code: string; shop_name: string; label_name: string | null } | null;

export async function shopRefs(shopIds: string[]): Promise<Map<string, ShopRef>> {
  const shops = await Shop.find(
    { _id: { $in: Array.from(new Set(shopIds)) } },
    { code: 1, shop_name: 1, label_name: 1 },
  ).lean();
  return new Map(
    shops.map((s) => [s._id, { code: s.code, shop_name: s.shop_name, label_name: s.label_name ?? null }]),
  );
}

/** Resolves `?areaId=` to the shop ids it covers. */
export async function shopIdsForArea(areaId?: string): Promise<string[] | null> {
  if (!areaId) return null;
  const shops = await Shop.find({ area_id: areaId }, { _id: 1 }).lean();
  return shops.map((s) => s._id);
}

function presentOrder(order: IOrder, shops: Map<string, ShopRef>) {
  const { _id, shop_id, ...rest } = order;
  return { id: _id, shop_id, ...rest, shops: shops.get(shop_id) ?? null };
}

export async function listOrders(req: Request, res: Response) {
  const { page, limit, skip, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["order_date", "order_no", "created_at", "total_qty", "delivery_date"],
    { sortBy: "order_date", sortOrder: "desc", limit: 200 },
  );

  const filter: Record<string, unknown> = {};
  if (req.query.month) filter.month = req.query.month;
  if (req.query.shopId) filter.shop_id = req.query.shopId;
  if (req.query.date) filter.order_date = req.query.date;
  if (req.query.status) filter.status = req.query.status;

  const areaShopIds = await shopIdsForArea(req.query.areaId as string | undefined);
  if (areaShopIds) {
    filter.shop_id = filter.shop_id
      ? { $in: areaShopIds.filter((id) => id === filter.shop_id) }
      : { $in: areaShopIds };
  }

  // "Pending" here means "no delivery recorded yet" — what the delivery form
  // offers to pick from, not the order's own status field.
  if (req.query.pending === "true") {
    const delivered = await Delivery.distinct("order_id");
    filter._id = { $nin: delivered as string[] };
  }

  const [rows, total] = await Promise.all([
    Order.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);

  const shops = await shopRefs(rows.map((r) => r.shop_id));
  return paginated(
    res,
    rows.map((row) => presentOrder(row, shops)),
    buildPaginationMeta(page, limit, total),
  );
}

/** Every order scheduled for delivery on one date — the day's run sheet. */
export async function deliverySheet(req: Request, res: Response) {
  const filter: Record<string, unknown> = { delivery_date: req.query.date };
  const areaShopIds = await shopIdsForArea(req.query.areaId as string | undefined);
  if (areaShopIds) filter.shop_id = { $in: areaShopIds };

  const rows = await Order.find(filter).sort({ order_no: 1 }).limit(1000).lean();
  const shops = await shopRefs(rows.map((r) => r.shop_id));
  return ok(res, rows.map((row) => presentOrder(row, shops)));
}

/** Delivery-due dates in a financial year, purely to light up the calendar. */
export async function deliveryDueDates(req: Request, res: Response) {
  const { start, end } = financialYearRange(req.query.financialYear as string);
  const dates = await Order.distinct("delivery_date", {
    delivery_date: { $ne: null, $gte: start, $lte: end },
  });
  return ok(res, (dates as string[]).filter(Boolean).sort());
}

export async function getOrder(req: Request, res: Response) {
  const order = await Order.findById(req.params.id).lean();
  if (!order) throw ApiError.notFound("Order not found");
  const shops = await shopRefs([order.shop_id]);
  return ok(res, presentOrder(order, shops));
}

type OrderBody = {
  shop_id: string;
  order_date: string;
  delivery_date: string;
  notes?: string | null;
  order_lines: Array<{ product_id: string; qty: number }>;
};

export async function createOrder(req: Request, res: Response) {
  const body = req.body as OrderBody;
  if (!(await Shop.exists({ _id: body.shop_id }))) throw ApiError.badRequest("Shop not found");

  const lines = body.order_lines.filter((l) => Number(l.qty) > 0);
  const order = await Order.create({
    shop_id: body.shop_id,
    order_no: await nextOrderNo("orders", body.shop_id),
    order_date: body.order_date,
    delivery_date: body.delivery_date,
    notes: body.notes || null,
    total_qty: round2(lines.reduce((sum, l) => sum + Number(l.qty), 0)),
    order_lines: lines,
  });

  const shops = await shopRefs([order.shop_id]);
  return created(res, presentOrder(order.toObject(), shops));
}

/**
 * Editing a delivered order re-runs the delivery/payment sync, so the frozen
 * money figures follow the edit instead of silently going stale.
 */
export async function updateOrder(req: Request, res: Response) {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound("Order not found");

  const body = req.body as OrderBody;
  if (body.shop_id !== order.shop_id && !(await Shop.exists({ _id: body.shop_id }))) {
    throw ApiError.badRequest("Shop not found");
  }

  const lines = body.order_lines.filter((l) => Number(l.qty) > 0);
  order.set({
    shop_id: body.shop_id,
    order_date: body.order_date,
    delivery_date: body.delivery_date,
    notes: body.notes || null,
    total_qty: round2(lines.reduce((sum, l) => sum + Number(l.qty), 0)),
    order_lines: lines,
  });
  await order.save();

  if (order.status === "Delivered") {
    await setOrderDelivered(order._id, body.delivery_date);
  }

  const fresh = await Order.findById(order._id).lean();
  const shops = await shopRefs([order.shop_id]);
  return ok(res, presentOrder(fresh!, shops));
}

export async function changeOrderStatus(req: Request, res: Response) {
  const { status, delivery_date: deliveryDate } = req.body as {
    status: "Pending" | "Delivered" | "Cancelled";
    delivery_date?: string;
  };

  await setOrderStatus(req.params.id, status, deliveryDate ?? null);

  const order = await Order.findById(req.params.id).lean();
  const shops = await shopRefs([order!.shop_id]);
  return ok(res, presentOrder(order!, shops));
}

export async function deleteOrder(req: Request, res: Response) {
  if (!(await Order.exists({ _id: req.params.id }))) throw ApiError.notFound("Order not found");
  await deleteOrderCascade(req.params.id);
  return ok(res, { message: "Order deleted" });
}

export async function getNextOrderNo(req: Request, res: Response) {
  const shopId = String(req.query.shopId ?? "");
  if (!shopId) throw ApiError.badRequest("shopId is required");
  return ok(res, { order_no: await nextOrderNo("orders", shopId) });
}
