import type { Request, Response } from "express";

import { Collection } from "../models/collection.model.js";
import {
  Order,
  Payment,
  balanceFor,
  derivePaymentStatus,
  moneyChangeFor,
  type IPayment,
} from "../models/order.model.js";
import { Role } from "../models/role.model.js";
import { Shop } from "../models/shop.model.js";
import { User } from "../models/user.model.js";
import {
  assertShopInScope,
  fieldRoleOf,
  fieldScopeFor,
} from "../services/field-ops.service.js";
import { can } from "../services/rbac.service.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, ok, paginated } from "../utils/api-response.js";
import { round2, todayIso } from "../utils/date.js";
import { parseListQuery, searchRegex } from "../utils/query.js";
import { presentCollection } from "./field-ops.controller.js";
import { shopIdsForArea, shopRefs, type ShopRef } from "./order.controller.js";
import { RESOURCES } from "../config/permissions.js";

/**
 * Payments are raised automatically when an order is delivered (see
 * services/order.service.ts) — this controller only ever updates collection
 * details. There is deliberately no create endpoint: a payment without a
 * delivery has nothing to be a payment for.
 *
 * A shop settles bills with cash. Balance, status and Money Change (the extra
 * cash paid beyond the bill) are all derived from the bill and cash received.
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
    /** Extra cash paid beyond the bill — bill 570, received 590 → 20. */
    money_change_applied: moneyChangeFor(amount, amount_received),
    /** What the shop still owes; never negative. */
    balance: balanceFor(amount, amount_received),
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

async function applyFieldShopScope(
  req: Request,
  filter: Record<string, unknown>,
) {
  if (can(req.user!.permissions, RESOURCES.payments, "view")) return;
  const { filter: scope } = await fieldScopeFor(req.user!.id);
  const shops = await Shop.find(scope, { _id: 1 }).lean();
  intersectShopIds(
    filter,
    shops.map((shop) => shop._id),
  );
}

export async function listPayments(req: Request, res: Response) {
  const { page, limit, skip, search, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    [
      "payment_date",
      "amount",
      "amount_received",
      "collected_date",
      "expected_collection_date",
      "created_at",
    ],
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
  await applyFieldShopScope(req, filter);

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
  if (!can(req.user!.permissions, RESOURCES.payments, "view")) {
    await assertShopInScope(req.user!.id, payment.shop_id);
  }
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

export async function listMoneyChanges(req: Request, res: Response) {
  const filter: Record<string, unknown> = { change_money: { $gt: 0 } };
  if (req.query.month) {
    const month = String(req.query.month).slice(0, 7);
    filter.collection_date = { $gte: `${month}-01`, $lte: `${month}-31` };
  }
  if (req.query.shopId) filter.shop_id = req.query.shopId;

  const areaShopIds = await shopIdsForArea(
    req.query.areaId as string | undefined,
  );
  intersectShopIds(filter, areaShopIds);
  await applyFieldShopScope(req, filter);

  const rows = await Collection.find(filter)
    .sort({ collection_date: -1, created_at: -1 })
    .limit(500)
    .lean();
  const shops = await shopRefs(rows.map((row) => row.shop_id));
  return ok(
    res,
    rows.map((row) => ({
      ...presentCollection(row),
      shop: shops.get(row.shop_id) ?? null,
    })),
  );
}

export async function updateMoneyChange(req: Request, res: Response) {
  const collection = await Collection.findById(req.params.id);
  if (!collection || !(collection.change_money > 0)) {
    throw ApiError.notFound("Money change not found");
  }
  const body = req.body as {
    change_money?: number;
    collection_date?: string;
    paid?: boolean;
    paid_date?: string;
  };
  if (!can(req.user!.permissions, RESOURCES.payments, "update")) {
    await assertShopInScope(req.user!.id, collection.shop_id);
    if (body.paid !== undefined && (await fieldRoleOf(req.user!.id)) !== "manager") {
      throw ApiError.forbidden("Only managers can mark change money paid");
    }
  }

  if (body.change_money !== undefined)
    collection.change_money = round2(body.change_money);
  if (body.collection_date !== undefined)
    collection.collection_date = body.collection_date;
  if (body.paid !== undefined) {
    if (body.paid && collection.change_money <= 0) {
      throw ApiError.badRequest(
        "Money change must be greater than zero before it can be marked paid",
      );
    }
    collection.change_money_paid = body.paid;
    collection.change_money_paid_date = body.paid
      ? body.paid_date || todayIso()
      : null;
    collection.change_money_paid_by = body.paid
      ? (req.user?.fullName ?? null)
      : null;
  }
  if (collection.change_money <= 0) {
    collection.change_money_paid = false;
    collection.change_money_paid_date = null;
    collection.change_money_paid_by = null;
  }

  await collection.save();
  const shops = await shopRefs([collection.shop_id]);
  return ok(res, {
    ...presentCollection(collection.toObject()),
    shop: shops.get(collection.shop_id) ?? null,
  });
}

export async function updatePayment(req: Request, res: Response) {
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound("Payment not found");
  if (!can(req.user!.permissions, RESOURCES.payments, "update")) {
    await assertShopInScope(req.user!.id, payment.shop_id);
  }

  const body = req.body as {
    status?: "Pending" | "Received" | "Partial";
    collected_by?: string | null;
    collected_by_user_id?: string | null;
    collected_date?: string | null;
    expected_collection_date?: string | null;
    amount?: number;
    amount_received?: number;
    money_change_applied?: number;
  };

  if (body.amount !== undefined) payment.amount = body.amount;

  if (body.money_change_applied !== undefined) {
    // Money Change is the extra paid beyond the bill, so entering it means the
    // shop handed over the full bill plus that much.
    payment.amount_received = round2(payment.amount + body.money_change_applied);
  } else if (body.amount_received !== undefined) {
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
  if (body.expected_collection_date !== undefined) {
    payment.expected_collection_date = body.expected_collection_date || null;
  }

  // Recomputed here as well as in the model's hook, so the value is right in
  // this response even if a future write path skips validation.
  payment.status = derivePaymentStatus(payment.amount, payment.amount_received);
  payment.money_change_applied = moneyChangeFor(payment.amount, payment.amount_received);

  await payment.save();

  const order = await Order.findById(payment.order_id, { order_no: 1 }).lean();
  const shops = await shopRefs([payment.shop_id]);
  return ok(
    res,
    present(payment.toObject(), shops, new Map(order ? [[order._id, order.order_no]] : [])),
  );
}
