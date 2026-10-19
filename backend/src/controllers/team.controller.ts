import type { NextFunction, Request, Response } from "express";

import { RESOURCES } from "../config/permissions.js";
import { Product } from "../models/catalogue.model.js";
import { Collection } from "../models/collection.model.js";
import { Delivery, Order, type ProductLine } from "../models/order.model.js";
import { Role, type FieldRole } from "../models/role.model.js";
import { Shop, ShopArea } from "../models/shop.model.js";
import { User } from "../models/user.model.js";
import { shopFilterFor } from "../services/field-ops.service.js";
import { can } from "../services/rbac.service.js";
import { ApiError } from "../utils/api-error.js";
import { ok } from "../utils/api-response.js";
import { round2, todayIso } from "../utils/date.js";
import { presentCollection } from "./field-ops.controller.js";

/**
 * Manager Dashboard and Salesperson Dashboard.
 *
 * Both are the same screens over a different team, so they share these
 * handlers: `:kind` is "managers" or "salespersons", and each kind is guarded
 * by its own permission (manager_dashboard / salesperson_dashboard).
 */
const KINDS: Record<string, { role: FieldRole; resource: string }> = {
  managers: { role: "manager", resource: RESOURCES.managerDashboard },
  salespersons: { role: "salesperson", resource: RESOURCES.salespersonDashboard },
};

function kindOf(req: Request) {
  const kind = KINDS[req.params.kind];
  if (!kind) throw ApiError.notFound("Unknown team");
  return kind;
}

/** Per-kind permission check — the route can't know the resource until it sees `:kind`. */
export function authorizeTeam(action: "view" | "update") {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    const kind = KINDS[req.params.kind];
    if (!kind) return next(ApiError.notFound("Unknown team"));
    if (!can(req.user.permissions, kind.resource, action)) {
      return next(ApiError.forbidden(`Missing permission "${kind.resource}:${action}" for this action`));
    }
    next();
  };
}

async function teamRoleIds(role: FieldRole): Promise<string[]> {
  const roles = await Role.find({ fieldRole: role }, { _id: 1 }).lean();
  return roles.map((r) => r._id);
}

async function assertMember(role: FieldRole, userId: string) {
  const user = await User.findById(userId, { fullName: 1, role: 1, isActive: 1 }).lean();
  if (!user || !(await teamRoleIds(role)).includes(user.role)) {
    throw ApiError.notFound(`That person is not a ${role}`);
  }
  return user;
}

/** Managers / Salespersons list: S.No, name and the shops they work. */
export async function listMembers(req: Request, res: Response) {
  const { role } = kindOf(req);
  const roleIds = await teamRoleIds(role);
  if (roleIds.length === 0) return ok(res, []);

  const users = await User.find({ role: { $in: roleIds }, isActive: true }, { fullName: 1 })
    .sort({ fullName: 1 })
    .lean();
  const ids = users.map((u) => u._id);
  const own = role === "manager" ? "handled_by_user_id" : "salesperson_user_id";

  const shops = await Shop.find(
    { is_active: true, $or: [{ [own]: { $in: ids } }, { access_user_ids: { $in: ids } }] },
    { shop_name: 1, [own]: 1, access_user_ids: 1 },
  )
    .sort({ shop_name: 1 })
    .lean();

  return ok(
    res,
    users.map((u) => {
      const mine = shops.filter(
        (s) =>
          (s as unknown as Record<string, unknown>)[own] === u._id ||
          (s.access_user_ids ?? []).includes(u._id),
      );
      return {
        id: u._id,
        full_name: u.fullName,
        shop_count: mine.length,
        shops: mine.map((s) => ({ id: s._id, shop_name: s.shop_name })),
      };
    }),
  );
}

export async function getMember(req: Request, res: Response) {
  const { role } = kindOf(req);
  const user = await assertMember(role, req.params.userId);
  return ok(res, { id: user._id, full_name: user.fullName, is_active: user.isActive });
}

/* ---------------------------------------------------------------- activity */

type ActivityType = "orders" | "deliveries" | "collections" | "change_money";

/** `?date=` exact day, else `?month=YYYY-MM`, else `?year=YYYY`, as a string range. */
function dateRange(query: Record<string, unknown>): Record<string, string> | string | null {
  if (typeof query.date === "string" && query.date) return query.date;
  if (typeof query.month === "string" && query.month) {
    const m = query.month.slice(0, 7);
    return { $gte: `${m}-01`, $lte: `${m}-31` };
  }
  if (typeof query.year === "string" && query.year) {
    return { $gte: `${query.year}-01-01`, $lte: `${query.year}-12-31` };
  }
  return null;
}

/** Shop ids the `shopId` / `areaId` filters allow, or null for "any shop". */
async function filteredShopIds(query: Record<string, unknown>): Promise<string[] | null> {
  if (typeof query.shopId === "string" && query.shopId) return [query.shopId];
  if (typeof query.areaId === "string" && query.areaId) {
    const shops = await Shop.find({ area_id: query.areaId }, { _id: 1 }).lean();
    return shops.map((s) => s._id);
  }
  return null;
}

function intersect(a: string[] | null, b: string[] | null): string[] | null {
  if (!a) return b;
  if (!b) return a;
  const keep = new Set(b);
  return a.filter((id) => keep.has(id));
}

async function shopDirectory(ids: string[]) {
  const shops = await Shop.find(
    { _id: { $in: Array.from(new Set(ids)) } },
    { shop_name: 1, label_name: 1, code: 1, area_id: 1 },
  ).lean();
  const areas = await ShopArea.find(
    { _id: { $in: shops.map((s) => s.area_id).filter(Boolean) as string[] } },
    { name: 1 },
  ).lean();
  const areaName = new Map(areas.map((a) => [a._id, a.name]));
  return new Map(
    shops.map((s) => [
      s._id,
      {
        shop_name: s.shop_name,
        label_name: s.label_name ?? null,
        code: s.code,
        area_name: s.area_id ? (areaName.get(s.area_id) ?? null) : null,
      },
    ]),
  );
}

const ROW_LIMIT = 2000;

/**
 * One of the four dashboard lists for one person, with the running total for
 * whatever filters are applied:
 *   orders        — orders they took (and, on top, what those orders are worth)
 *   deliveries    — managers: deliveries they made; salespersons: every
 *                   delivery to the shops assigned to them
 *   collections   — payments they collected
 *   change_money  — change money from their collections, with paid status
 */
export async function memberActivity(req: Request, res: Response) {
  const { role } = kindOf(req);
  const user = await assertMember(role, req.params.userId);
  const query = req.query as Record<string, unknown>;
  const type = query.type as ActivityType;

  const range = dateRange(query);
  let shopIds = await filteredShopIds(query);

  if (type === "orders") {
    const filter: Record<string, unknown> = { taken_by_user_id: user._id };
    if (range) filter.order_date = range;
    if (shopIds) filter.shop_id = { $in: shopIds };

    const [rows, products] = await Promise.all([
      Order.find(filter).sort({ order_date: -1, order_no: -1 }).limit(ROW_LIMIT).lean(),
      Product.find({}, { short_name: 1, selling_price: 1, sort_order: 1 }).sort({ sort_order: 1 }).lean(),
    ]);
    const shops = await shopDirectory(rows.map((r) => r.shop_id));
    const price = new Map(products.map((p) => [p._id, Number(p.selling_price) || 0]));
    const describe = productDescriber(products);

    const items = rows.map((o) => {
      const value = round2(
        (o.order_lines ?? []).reduce((sum, l) => sum + Number(l.qty) * (price.get(l.product_id) ?? 0), 0),
      );
      return {
        id: o._id,
        date: o.order_date,
        order_no: o.order_no,
        delivery_date: o.delivery_date,
        status: o.status,
        shop_id: o.shop_id,
        shop: shops.get(o.shop_id) ?? null,
        products: describe(o.order_lines),
        qty: Number(o.total_qty) || 0,
        amount: value,
      };
    });

    return ok(res, {
      type,
      rows: items,
      summary: {
        count: items.length,
        qty: round2(items.reduce((s, r) => s + r.qty, 0)),
        total: round2(items.reduce((s, r) => s + r.amount, 0)),
      },
    });
  }

  if (type === "deliveries") {
    const filter: Record<string, unknown> = { status: "Delivered" };
    if (role === "manager") {
      filter.delivered_by_user_id = user._id;
    } else {
      const assigned = await Shop.find(shopFilterFor("salesperson", user._id), { _id: 1 }).lean();
      shopIds = intersect(shopIds, assigned.map((s) => s._id));
    }
    if (range) filter.delivery_date = range;
    if (shopIds) filter.shop_id = { $in: shopIds };

    const [rows, products] = await Promise.all([
      Delivery.find(filter).sort({ delivery_date: -1 }).limit(ROW_LIMIT).lean(),
      Product.find({}, { short_name: 1, sort_order: 1 }).sort({ sort_order: 1 }).lean(),
    ]);
    const [shops, orders] = await Promise.all([
      shopDirectory(rows.map((r) => r.shop_id)),
      Order.find({ _id: { $in: rows.map((r) => r.order_id) } }, { order_no: 1 }).lean(),
    ]);
    const orderNo = new Map(orders.map((o) => [o._id, o.order_no]));
    const describe = productDescriber(products);

    const items = rows.map((d) => ({
      id: d._id,
      date: d.delivery_date,
      order_no: orderNo.get(d.order_id) ?? null,
      shop_id: d.shop_id,
      shop: shops.get(d.shop_id) ?? null,
      products: describe(d.delivery_lines),
      qty: Number(d.total_qty) || 0,
      amount: Number(d.total_sales) || 0,
      delivered_by: d.delivered_by ?? null,
    }));

    return ok(res, {
      type,
      rows: items,
      summary: {
        count: items.length,
        qty: round2(items.reduce((s, r) => s + r.qty, 0)),
        total: round2(items.reduce((s, r) => s + r.amount, 0)),
      },
    });
  }

  if (type === "collections" || type === "change_money") {
    const filter: Record<string, unknown> = { collected_by_user_id: user._id };
    if (type === "change_money") filter.change_money = { $gt: 0 };
    if (range) filter.collection_date = range;
    if (shopIds) filter.shop_id = { $in: shopIds };

    const rows = await Collection.find(filter)
      .sort({ collection_date: -1, created_at: -1 })
      .limit(ROW_LIMIT)
      .lean();
    const shops = await shopDirectory(rows.map((r) => r.shop_id));
    const items = rows.map((c) => ({
      ...presentCollection(c),
      date: c.collection_date,
      shop: shops.get(c.shop_id) ?? null,
    }));

    const sum = (pick: (r: (typeof items)[number]) => number, only = (_r: (typeof items)[number]) => true) =>
      round2(items.filter(only).reduce((s, r) => s + pick(r), 0));

    return ok(res, {
      type,
      rows: items,
      summary:
        type === "collections"
          ? {
              count: items.length,
              total: sum((r) => r.amount),
              change_money: sum((r) => r.change_money),
            }
          : {
              count: items.length,
              total: sum((r) => r.change_money),
              paid: sum((r) => r.change_money, (r) => r.change_money_paid),
              unpaid: sum((r) => r.change_money, (r) => !r.change_money_paid),
            },
    });
  }

  throw ApiError.badRequest("type must be orders, deliveries, collections or change_money");
}

function productDescriber(products: Array<{ _id: string; short_name: string }>) {
  const order = new Map(products.map((p, i) => [p._id, i]));
  const name = new Map(products.map((p) => [p._id, p.short_name]));
  return (lines: ProductLine[] | undefined) =>
    (lines ?? [])
      .filter((l) => Number(l.qty) > 0)
      .sort((a, b) => (order.get(a.product_id) ?? 999) - (order.get(b.product_id) ?? 999))
      .map((l) => `${name.get(l.product_id) ?? "?"} × ${Number(l.qty)}`)
      .join(", ");
}

/* ------------------------------------------------------------------- shops */

/**
 * Shops a person works (`assigned=true`, the default) or every active shop
 * with whether they have it (`assigned=false`, the "Give Access" picker).
 * `assignment` says why: "primary" (their own handler/salesperson shop) or
 * "access" (granted), or null when they don't have it.
 */
export async function memberShops(req: Request, res: Response) {
  const { role } = kindOf(req);
  const user = await assertMember(role, req.params.userId);
  const own = role === "manager" ? "handled_by_user_id" : "salesperson_user_id";

  const filter: Record<string, unknown> = { is_active: true };
  if (req.query.areaId) filter.area_id = req.query.areaId;
  if (req.query.assigned !== "false") Object.assign(filter, shopFilterFor(role, user._id));

  const shops = await Shop.find(filter, {
    shop_name: 1,
    label_name: 1,
    code: 1,
    area_id: 1,
    address: 1,
    handled_by: 1,
    salesperson: 1,
    handled_by_user_id: 1,
    salesperson_user_id: 1,
    access_user_ids: 1,
  })
    .sort({ shop_name: 1 })
    .lean();
  const areas = await ShopArea.find({}, { name: 1 }).lean();
  const areaName = new Map(areas.map((a) => [a._id, a.name]));

  return ok(
    res,
    shops.map((s) => {
      const isPrimary = (s as unknown as Record<string, unknown>)[own] === user._id;
      const hasAccess = (s.access_user_ids ?? []).includes(user._id);
      return {
        id: s._id,
        shop_name: s.shop_name,
        label_name: s.label_name ?? null,
        code: s.code,
        area_id: s.area_id,
        area_name: s.area_id ? (areaName.get(s.area_id) ?? null) : null,
        address: s.address ?? null,
        handled_by: s.handled_by ?? null,
        salesperson: s.salesperson ?? null,
        assignment: isPrimary ? "primary" : hasAccess ? "access" : null,
      };
    }),
  );
}

/**
 * "Give Access" / "Give Access to All". A salesperson granted a shop that has
 * no salesperson yet becomes its salesperson outright (so the Shops List shows
 * a name); otherwise — and always for managers, whose primary shops come from
 * the shop's "Handled by" — the grant is added to the shop's access list.
 */
export async function grantShopAccess(req: Request, res: Response) {
  const { role } = kindOf(req);
  const user = await assertMember(role, req.params.userId);
  const body = req.body as { shop_ids?: string[]; all?: boolean; area_id?: string | null };

  const target: Record<string, unknown> = { is_active: true };
  if (body.all) {
    if (body.area_id) target.area_id = body.area_id;
  } else {
    if (!body.shop_ids?.length) throw ApiError.badRequest("Select at least one shop");
    target._id = { $in: body.shop_ids };
  }

  let promoted = 0;
  if (role === "salesperson") {
    const result = await Shop.updateMany(
      { ...target, salesperson_user_id: null },
      { $set: { salesperson_user_id: user._id, salesperson: user.fullName } },
    );
    promoted = result.modifiedCount;
  }

  const own = role === "manager" ? "handled_by_user_id" : "salesperson_user_id";
  const granted = await Shop.updateMany(
    { ...target, [own]: { $ne: user._id } },
    { $addToSet: { access_user_ids: user._id } },
  );

  return ok(res, {
    message: `Access given to ${promoted + granted.modifiedCount} shop${promoted + granted.modifiedCount === 1 ? "" : "s"}`,
    shops_affected: promoted + granted.modifiedCount,
  });
}

/**
 * Removes a granted shop. A salesperson's own shop is unassigned outright; a
 * manager's own shop comes from "Handled by", which is changed on the shop.
 */
export async function revokeShopAccess(req: Request, res: Response) {
  const { role } = kindOf(req);
  const user = await assertMember(role, req.params.userId);
  const shop = await Shop.findById(req.params.shopId);
  if (!shop) throw ApiError.notFound("Shop not found");

  if (role === "manager" && shop.handled_by_user_id === user._id) {
    throw ApiError.badRequest(
      `${user.fullName} is this shop's "Handled by" — change that on the shop to move it`,
    );
  }
  if (role === "salesperson" && shop.salesperson_user_id === user._id) {
    shop.salesperson_user_id = null;
    shop.salesperson = null;
  }
  shop.access_user_ids = (shop.access_user_ids ?? []).filter((id) => id !== user._id);
  await shop.save();
  return ok(res, { message: "Access removed" });
}

/* ------------------------------------------------------------ change money */

/** Marking change money paid is what takes it out of cash in hand. */
export async function setChangeMoneyPaid(req: Request, res: Response) {
  if (kindOf(req).role !== "manager") throw ApiError.notFound("Change money is a manager record");
  const collection = await Collection.findById(req.params.id);
  if (!collection) throw ApiError.notFound("Collection not found");
  if (!(collection.change_money > 0)) {
    throw ApiError.badRequest("This collection has no change money");
  }

  const { paid, paid_date: paidDate } = req.body as { paid: boolean; paid_date?: string };
  collection.change_money_paid = paid;
  collection.change_money_paid_date = paid ? paidDate || todayIso() : null;
  collection.change_money_paid_by = paid ? (req.user?.fullName ?? null) : null;
  await collection.save();

  return ok(res, presentCollection(collection.toObject()));
}
