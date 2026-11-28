import type { Request, Response } from "express";

import { Collection, type ICollection } from "../models/collection.model.js";
import { Order, Payment } from "../models/order.model.js";
import { Shop, ShopArea } from "../models/shop.model.js";
import { User } from "../models/user.model.js";
import {
  assertShopInScope,
  fieldScopeFor,
  pendingDeliveries,
  recordCollection,
  reverseCollection,
} from "../services/field-ops.service.js";
import { ApiError } from "../utils/api-error.js";
import { created, ok } from "../utils/api-response.js";
import { round2, todayIso } from "../utils/date.js";
import { can } from "../services/rbac.service.js";
import { RESOURCES } from "../config/permissions.js";

/**
 * Field Operations — the mobile tab managers and salespersons work from.
 *
 * Every endpoint is scoped to the shops the signed-in user works (see
 * services/field-ops.service.ts); office staff with no field role see every
 * shop. The Shop Info views reuse /shops/:id/history and /shops/:id/analysis.
 */

export function presentCollection(c: ICollection) {
  const { _id, ...rest } = c;
  return { id: _id, ...rest };
}

/** The Shops List: S.No, shop, area, location, manager and salesperson. */
export async function listFieldShops(req: Request, res: Response) {
  const { scope, filter } = await fieldScopeFor(req.user!.id);
  const query: Record<string, unknown> = { ...filter, is_active: true };
  if (req.query.areaId) query.area_id = req.query.areaId;

  const [shops, areas] = await Promise.all([
    Shop.find(query, {
      code: 1,
      shop_name: 1,
      label_name: 1,
      area_id: 1,
      address: 1,
      latitude: 1,
      longitude: 1,
      mobile: 1,
      handled_by: 1,
      handled_by_user_id: 1,
      salesperson: 1,
      salesperson_user_id: 1,
    })
      .sort({ shop_name: 1 })
      .lean(),
    ShopArea.find({}, { name: 1 }).lean(),
  ]);
  const pendingRows =
    shops.length === 0
      ? []
      : await Payment.aggregate<{ _id: string; balance: number }>([
          { $match: { shop_id: { $in: shops.map((shop) => shop._id) } } },
          {
            $group: {
              _id: "$shop_id",
              balance: {
                $sum: {
                  $max: [
                    0,
                    { $subtract: ["$amount", { $ifNull: ["$amount_received", 0] }] },
                  ],
                },
              },
            },
          },
        ]);
  const areaName = new Map(areas.map((a) => [a._id, a.name]));
  const pendingByShop = new Map(pendingRows.map((row) => [row._id, round2(row.balance)]));

  return ok(res, {
    scope,
    shops: shops.map(({ _id, ...rest }) => ({
      id: _id,
      ...rest,
      area_name: rest.area_id ? (areaName.get(rest.area_id) ?? null) : null,
      pending_balance: pendingByShop.get(_id) ?? 0,
    })),
  });
}

/** Total pending for a shop, delivery by delivery in the order a collection settles them. */
export async function getPendingPayments(req: Request, res: Response) {
  await assertShopInScope(req.user!.id, req.params.id);
  const deliveries = await pendingDeliveries(req.params.id);
  return ok(res, {
    shop_id: req.params.id,
    total_pending: round2(deliveries.reduce((sum, d) => sum + d.balance, 0)),
    deliveries,
  });
}

/** Every bill for a shop, including settled bills, with the Payments-tab details. */
export async function listShopPayments(req: Request, res: Response) {
  const shopId = req.params.id;
  await assertShopInScope(req.user!.id, shopId);

  const rows = await Payment.find({ shop_id: shopId }).sort({ payment_date: -1 }).lean();
  const orders = await Order.find(
    { _id: { $in: rows.map((row) => row.order_id) } },
    { order_no: 1 },
  ).lean();
  const orderNos = new Map(orders.map((order) => [order._id, order.order_no]));

  return ok(
    res,
    rows.map((row) => {
      const amount = Number(row.amount) || 0;
      const amount_received = Number(row.amount_received) || 0;
      const money_change_applied = Number(row.money_change_applied) || 0;
      return {
        id: row._id,
        shop_id: row.shop_id,
        order_id: row.order_id,
        payment_date: row.payment_date,
        amount,
        amount_received,
        money_change_applied,
        balance: round2(Math.max(0, amount - amount_received - money_change_applied)),
        status: row.status,
        collected_by: row.collected_by,
        collected_date: row.collected_date,
        expected_collection_date: row.expected_collection_date,
        order_no: orderNos.get(row.order_id) ?? null,
      };
    }),
  );
}

export async function listShopCollections(req: Request, res: Response) {
  await assertShopInScope(req.user!.id, req.params.id);
  const rows = await Collection.find({ shop_id: req.params.id })
    .sort({ collection_date: -1, created_at: -1 })
    .limit(200)
    .lean();
  return ok(res, rows.map(presentCollection));
}

/** Make Payment — see `recordCollection` for how the sum is applied. */
export async function makePayment(req: Request, res: Response) {
  const shopId = req.params.id;
  await assertShopInScope(req.user!.id, shopId);

  const body = req.body as {
    collection_date?: string;
    allocations: Array<{ payment_id: string; amount: number }>;
    change_money?: number;
    collected_by_user_id?: string | null;
  };

  let collectedBy = { id: req.user!.id as string | null, name: req.user!.fullName as string | null };
  if (body.collected_by_user_id && body.collected_by_user_id !== req.user!.id) {
    const user = await User.findById(body.collected_by_user_id, { fullName: 1 }).lean();
    if (!user) throw ApiError.badRequest("The selected person no longer has an account");
    collectedBy = { id: user._id, name: user.fullName };
  }

  const collection = await recordCollection({
    shopId,
    collectionDate: body.collection_date || todayIso(),
    allocations: body.allocations.map(({ payment_id, amount }) => ({
      paymentId: payment_id,
      amount,
    })),
    changeMoney: body.change_money ?? 0,
    collectedBy,
    recordedByUserId: req.user!.id,
  });

  const deliveries = await pendingDeliveries(shopId);
  return created(res, {
    collection: presentCollection(collection.toObject()),
    total_pending: round2(deliveries.reduce((sum, d) => sum + d.balance, 0)),
  });
}

export async function deleteCollection(req: Request, res: Response) {
  if (!can(req.user!.permissions, RESOURCES.payments, "update")) {
    const collection = await Collection.findById(req.params.id, { shop_id: 1 }).lean();
    if (!collection) throw ApiError.notFound("Collection not found");
    await assertShopInScope(req.user!.id, collection.shop_id);
  }
  await reverseCollection(req.params.id);
  return ok(res, { message: "Collection reversed" });
}

/** Who a collection can be credited to — every active account. */
export async function listFieldCollectors(_req: Request, res: Response) {
  const users = await User.find({ isActive: true }, { fullName: 1 }).sort({ fullName: 1 }).lean();
  return ok(res, users.map((u) => ({ id: u._id, full_name: u.fullName })));
}
