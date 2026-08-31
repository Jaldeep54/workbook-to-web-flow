import type { Request, Response } from "express";

import { Order, Payment, derivePaymentStatus, type IPayment } from "../models/order.model.js";
import { Role } from "../models/role.model.js";
import { Shop } from "../models/shop.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, ok, paginated } from "../utils/api-response.js";
import { round2 } from "../utils/date.js";
import { parseListQuery, searchRegex } from "../utils/query.js";
import { shopIdsForArea, shopRefs, type ShopRef } from "./order.controller.js";

/**
 * Payments are raised automatically when an order is delivered (see
 * services/order.service.ts) — this controller only ever updates collection
 * details. There is deliberately no create endpoint: a payment without a
 * delivery has nothing to be a payment for.
 *
 * A shop settles its bill in instalments, so a payment carries both what it is
 * worth (`amount`) and what has actually come in (`amount_received`). The
 * balance still owed is the difference between them, and `status` is always
 * derived from the two — never chosen independently.
 */
function present(payment: IPayment, shops: Map<string, ShopRef>, orderNos: Map<string, number>) {
  const { _id, shop_id, order_id, ...rest } = payment;
  const amount = Number(payment.amount) || 0;
  const amount_received = Number(payment.amount_received) || 0;
  return {
    id: _id,
    shop_id,
    order_id,
    ...rest,
    amount,
    amount_received,
    /** What the shopkeeper still owes on this order; never negative. */
    balance: round2(Math.max(0, amount - amount_received)),
    shops: shops.get(shop_id) ?? null,
    orders: orderNos.has(order_id) ? { order_no: orderNos.get(order_id)! } : null,
  };
}

/** Shops whose name, billing name, label or code matches a free-text search. */
async function shopIdsMatching(search: string | undefined): Promise<string[] | null> {
  if (!search) return null;
  const rx = searchRegex(search);
  const rows = await Shop.find(
    { $or: [{ shop_name: rx }, { label_name: rx }, { bill_name: rx }, { code: rx }] },
    { _id: 1 },
  ).lean();
  return rows.map((r) => r._id);
}

/**
 * Narrows `filter.shop_id` to the intersection of every shop-scoped filter, so
 * an area and a search applied together mean "in this area *and* matching",
 * not whichever was applied last.
 */
function intersectShopIds(filter: Record<string, unknown>, ids: string[] | null) {
  if (!ids) return;
  const current = filter.shop_id;
  if (typeof current === "string") {
    filter.shop_id = { $in: ids.filter((id) => id === current) };
  } else if (current && typeof current === "object" && "$in" in current) {
    const previous = new Set((current as { $in: string[] }).$in);
    filter.shop_id = { $in: ids.filter((id) => previous.has(id)) };
  } else {
    filter.shop_id = { $in: ids };
  }
}

export async function listPayments(req: Request, res: Response) {
  const { page, limit, skip, search, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["payment_date", "amount", "amount_received", "collected_date", "created_at"],
    { sortBy: "payment_date", sortOrder: "desc", limit: 200 },
  );

  const filter: Record<string, unknown> = {};
  if (req.query.month) filter.month = req.query.month;
  if (req.query.shopId) filter.shop_id = req.query.shopId;
  if (req.query.status) filter.status = req.query.status;

  const [areaShopIds, searchShopIds] = await Promise.all([
    shopIdsForArea(req.query.areaId as string | undefined),
    shopIdsMatching(search),
  ]);
  intersectShopIds(filter, areaShopIds);
  intersectShopIds(filter, searchShopIds);

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
  return ok(res, present(payment, shops, new Map(order ? [[order._id, order.order_no]] : [])));
}

/**
 * The people a payment can be "Collected by" — every active account, since
 * anyone on the team may be the one who brings the money back. The chosen
 * name is copied onto the payment alongside the account id, so a collection
 * keeps reading correctly after that account is renamed or deactivated.
 */
export async function listCollectors(_req: Request, res: Response) {
  const [users, roles] = await Promise.all([
    User.find({ isActive: true }, { fullName: 1, role: 1 }).sort({ fullName: 1 }).lean(),
    Role.find({}, { name: 1 }).lean(),
  ]);
  const roleName = new Map(roles.map((r) => [r._id, r.name]));

  return ok(
    res,
    users.map((u) => ({
      id: u._id,
      full_name: u.fullName,
      role_name: roleName.get(u.role) ?? "",
    })),
  );
}

export async function updatePayment(req: Request, res: Response) {
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound("Payment not found");

  const body = req.body as {
    status?: "Pending" | "Received" | "Partial";
    collected_by?: string | null;
    collected_by_user_id?: string | null;
    collected_date?: string | null;
    amount?: number;
    amount_received?: number;
  };

  if (body.amount !== undefined) payment.amount = body.amount;

  if (body.amount_received !== undefined) {
    if (body.amount_received > payment.amount) {
      throw ApiError.badRequest(
        "A shop cannot pay more than the order is worth — reduce the received amount, or correct the order first",
      );
    }
    payment.amount_received = body.amount_received;
  } else if (body.status !== undefined) {
    /**
     * A status sent on its own is shorthand for a money movement: "Received"
     * settles the bill in full, "Pending" withdraws the collection entirely.
     * "Partial" says nothing about how much, so it only means anything
     * alongside an amount and is left to the derivation below.
     */
    if (body.status === "Received") payment.amount_received = payment.amount;
    if (body.status === "Pending") payment.amount_received = 0;
  }

  if (body.collected_by_user_id !== undefined) {
    if (body.collected_by_user_id) {
      const user = await User.findById(body.collected_by_user_id, { fullName: 1 }).lean();
      if (!user) throw ApiError.badRequest("The selected person no longer has an account");
      payment.collected_by_user_id = user._id;
      payment.collected_by = user.fullName;
    } else {
      payment.collected_by_user_id = null;
      payment.collected_by = null;
    }
  } else if (body.collected_by !== undefined) {
    payment.collected_by = body.collected_by || null;
  }

  if (body.collected_date !== undefined) payment.collected_date = body.collected_date || null;

  // Recomputed here as well as in the model's hook, so the value is right in
  // this response even if a future write path skips validation.
  payment.status = derivePaymentStatus(payment.amount, payment.amount_received);

  await payment.save();

  const order = await Order.findById(payment.order_id, { order_no: 1 }).lean();
  const shops = await shopRefs([payment.shop_id]);
  return ok(
    res,
    present(payment.toObject(), shops, new Map(order ? [[order._id, order.order_no]] : [])),
  );
}
