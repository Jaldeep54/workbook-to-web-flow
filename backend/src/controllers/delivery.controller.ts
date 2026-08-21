import type { Request, Response } from "express";

import { Delivery, Order, Payment, type IDelivery } from "../models/order.model.js";
import { setOrderDelivered, setOrderStatus } from "../services/order.service.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, created, ok, paginated } from "../utils/api-response.js";
import { parseListQuery } from "../utils/query.js";
import { shopIdsForArea, shopRefs, type ShopRef } from "./order.controller.js";

/**
 * Deliveries are always created through the order lifecycle
 * (services/order.service.ts), never by writing a delivery row directly:
 * that's what guarantees the delivery, its payment and the order's status
 * stay consistent, and that the money figures come from one formula.
 */
function present(delivery: IDelivery, shops: Map<string, ShopRef>, orderNos: Map<string, number>) {
  const { _id, shop_id, order_id, ...rest } = delivery;
  return {
    id: _id,
    shop_id,
    order_id,
    ...rest,
    shops: shops.get(shop_id) ?? null,
    orders: orderNos.has(order_id) ? { order_no: orderNos.get(order_id)! } : null,
  };
}

async function orderNumbers(orderIds: string[]): Promise<Map<string, number>> {
  const orders = await Order.find(
    { _id: { $in: Array.from(new Set(orderIds)) } },
    { order_no: 1 },
  ).lean();
  return new Map(orders.map((o) => [o._id, o.order_no]));
}

export async function listDeliveries(req: Request, res: Response) {
  const { page, limit, skip, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["delivery_date", "total_sales", "profit", "created_at", "total_qty"],
    { sortBy: "delivery_date", sortOrder: "desc", limit: 200 },
  );

  const filter: Record<string, unknown> = {};
  if (req.query.month) filter.month = req.query.month;
  if (req.query.shopId) filter.shop_id = req.query.shopId;

  const areaShopIds = await shopIdsForArea(req.query.areaId as string | undefined);
  if (areaShopIds) {
    filter.shop_id = filter.shop_id
      ? { $in: areaShopIds.filter((id) => id === filter.shop_id) }
      : { $in: areaShopIds };
  }

  const [rows, total] = await Promise.all([
    Delivery.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Delivery.countDocuments(filter),
  ]);

  const [shops, orderNos] = await Promise.all([
    shopRefs(rows.map((r) => r.shop_id)),
    orderNumbers(rows.map((r) => r.order_id)),
  ]);

  return paginated(
    res,
    rows.map((row) => present(row, shops, orderNos)),
    buildPaginationMeta(page, limit, total),
  );
}

export async function getDelivery(req: Request, res: Response) {
  const delivery = await Delivery.findById(req.params.id).lean();
  if (!delivery) throw ApiError.notFound("Delivery not found");
  const [shops, orderNos] = await Promise.all([
    shopRefs([delivery.shop_id]),
    orderNumbers([delivery.order_id]),
  ]);
  return ok(res, present(delivery, shops, orderNos));
}

/** Records a delivery for an order — the "New delivery" form. */
export async function createDelivery(req: Request, res: Response) {
  const { order_id: orderId, delivery_date: deliveryDate, status } = req.body as {
    order_id: string;
    delivery_date: string;
    status: "Pending" | "Delivered" | "Cancelled";
  };

  const order = await Order.findById(orderId).lean();
  if (!order) throw ApiError.badRequest("Order not found");
  if (await Delivery.exists({ order_id: orderId })) {
    throw ApiError.conflict("This order already has a delivery recorded");
  }

  await setOrderDelivered(orderId, deliveryDate);
  if (status !== "Delivered") await setOrderStatus(orderId, status, deliveryDate);

  const delivery = await Delivery.findOne({ order_id: orderId }).lean();
  if (!delivery) {
    // A non-Delivered status with no received payment removes the row again;
    // report the resulting state rather than pretending one exists.
    return created(res, { order_id: orderId, status, delivery: null });
  }

  const [shops, orderNos] = await Promise.all([
    shopRefs([delivery.shop_id]),
    orderNumbers([delivery.order_id]),
  ]);
  return created(res, present(delivery, shops, orderNos));
}

/** Status changes route through the order so all three records move together. */
export async function updateDelivery(req: Request, res: Response) {
  const delivery = await Delivery.findById(req.params.id);
  if (!delivery) throw ApiError.notFound("Delivery not found");

  const body = req.body as { status?: "Pending" | "Delivered" | "Cancelled"; delivery_date?: string };

  if (body.status) {
    await setOrderStatus(
      delivery.order_id,
      body.status,
      body.delivery_date ?? delivery.delivery_date,
    );
  } else if (body.delivery_date) {
    await setOrderDelivered(delivery.order_id, body.delivery_date);
  }

  const fresh = await Delivery.findOne({ order_id: delivery.order_id }).lean();
  if (!fresh) return ok(res, { message: "Delivery removed with the status change", delivery: null });

  const [shops, orderNos] = await Promise.all([
    shopRefs([fresh.shop_id]),
    orderNumbers([fresh.order_id]),
  ]);
  return ok(res, present(fresh, shops, orderNos));
}

export async function deleteDelivery(req: Request, res: Response) {
  const delivery = await Delivery.findById(req.params.id);
  if (!delivery) throw ApiError.notFound("Delivery not found");

  const receivedPayment = await Payment.exists({
    order_id: delivery.order_id,
    status: "Received",
  });
  if (receivedPayment) {
    throw ApiError.conflict(
      "This delivery has a received payment against it — reverse the payment first",
    );
  }

  await setOrderStatus(delivery.order_id, "Pending");
  return ok(res, { message: "Delivery removed and the order returned to Pending" });
}
