import type { Request, Response } from "express";

import { Order, Payment, type IPayment } from "../models/order.model.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, ok, paginated } from "../utils/api-response.js";
import { parseListQuery } from "../utils/query.js";
import { shopIdsForArea, shopRefs, type ShopRef } from "./order.controller.js";

/**
 * Payments are raised automatically when an order is delivered (see
 * services/order.service.ts) — this controller only ever updates collection
 * details. There is deliberately no create endpoint: a payment without a
 * delivery has nothing to be a payment for.
 */
function present(payment: IPayment, shops: Map<string, ShopRef>, orderNos: Map<string, number>) {
  const { _id, shop_id, order_id, ...rest } = payment;
  return {
    id: _id,
    shop_id,
    order_id,
    ...rest,
    shops: shops.get(shop_id) ?? null,
    orders: orderNos.has(order_id) ? { order_no: orderNos.get(order_id)! } : null,
  };
}

export async function listPayments(req: Request, res: Response) {
  const { page, limit, skip, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["payment_date", "amount", "collected_date", "created_at"],
    { sortBy: "payment_date", sortOrder: "desc", limit: 200 },
  );

  const filter: Record<string, unknown> = {};
  if (req.query.month) filter.month = req.query.month;
  if (req.query.shopId) filter.shop_id = req.query.shopId;
  if (req.query.status) filter.status = req.query.status;

  const areaShopIds = await shopIdsForArea(req.query.areaId as string | undefined);
  if (areaShopIds) {
    filter.shop_id = filter.shop_id
      ? { $in: areaShopIds.filter((id) => id === filter.shop_id) }
      : { $in: areaShopIds };
  }

  const [rows, total] = await Promise.all([
    Payment.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Payment.countDocuments(filter),
  ]);

  const orders = await Order.find(
    { _id: { $in: rows.map((r) => r.order_id) } },
    { order_no: 1 },
  ).lean();

  const shops = await shopRefs(rows.map((r) => r.shop_id));
  const orderNos = new Map(orders.map((o) => [o._id, o.order_no]));

  return paginated(
    res,
    rows.map((row) => present(row, shops, orderNos)),
    buildPaginationMeta(page, limit, total),
  );
}

export async function getPayment(req: Request, res: Response) {
  const payment = await Payment.findById(req.params.id).lean();
  if (!payment) throw ApiError.notFound("Payment not found");
  const order = await Order.findById(payment.order_id, { order_no: 1 }).lean();
  const shops = await shopRefs([payment.shop_id]);
  return ok(
    res,
    present(payment, shops, new Map(order ? [[order._id, order.order_no]] : [])),
  );
}

export async function updatePayment(req: Request, res: Response) {
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound("Payment not found");

  const body = req.body as {
    status?: "Pending" | "Received" | "Partial";
    collected_by?: string | null;
    collected_date?: string | null;
    amount?: number;
  };

  if (body.status !== undefined) payment.status = body.status;
  if (body.collected_by !== undefined) payment.collected_by = body.collected_by || null;
  if (body.collected_date !== undefined) payment.collected_date = body.collected_date || null;
  if (body.amount !== undefined) payment.amount = body.amount;

  await payment.save();

  const order = await Order.findById(payment.order_id, { order_no: 1 }).lean();
  const shops = await shopRefs([payment.shop_id]);
  return ok(
    res,
    present(payment.toObject(), shops, new Map(order ? [[order._id, order.order_no]] : [])),
  );
}
