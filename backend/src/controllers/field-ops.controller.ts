import type { Request, Response } from "express";

import { Collection, type ICollection } from "../models/collection.model.js";
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
  const areaName = new Map(areas.map((a) => [a._id, a.name]));

  return ok(res, {
    scope,
    shops: shops.map(({ _id, ...rest }) => ({
      id: _id,
      ...rest,
      area_name: rest.area_id ? (areaName.get(rest.area_id) ?? null) : null,
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
    amount: number;
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
    amount: body.amount,
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
  await reverseCollection(req.params.id);
  return ok(res, { message: "Collection reversed" });
}

/** Who a collection can be credited to — every active account. */
export async function listFieldCollectors(_req: Request, res: Response) {
  const users = await User.find({ isActive: true }, { fullName: 1 }).sort({ fullName: 1 }).lean();
  return ok(res, users.map((u) => ({ id: u._id, full_name: u.fullName })));
}
