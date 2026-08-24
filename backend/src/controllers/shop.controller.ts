import type { Request, Response } from "express";

import { Delivery, LabelOrder, Order, Payment } from "../models/order.model.js";
import { Role } from "../models/role.model.js";
import { Shop, ShopArea, ShopProduct, type IShop } from "../models/shop.model.js";
import { User } from "../models/user.model.js";
import { nextShopCode } from "../services/catalogue.service.js";
import { deleteShopImage, saveShopImage, signedImagePath } from "../services/file.service.js";
import { shopAnalysis, SHOP_ANALYSIS_MONTHS } from "../services/shop-analysis.service.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, created, ok, paginated } from "../utils/api-response.js";
import { parseListQuery, searchRegex } from "../utils/query.js";

/** Shop rows carry a short-lived signed URL for their photo, when they have one. */
function present(shop: IShop) {
  const { _id, ...rest } = shop;
  return {
    id: _id,
    ...rest,
    image_url: shop.image_path ? signedImagePath(shop.image_path) : null,
  };
}

export async function listShops(req: Request, res: Response) {
  const { page, limit, skip, search, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["shop_name", "code", "created_at", "joined_on", "design_type"],
    { sortBy: "shop_name", limit: 500 },
  );

  const filter: Record<string, unknown> = {};
  if (req.query.areaId) filter.area_id = req.query.areaId;
  if (req.query.isActive) filter.is_active = req.query.isActive === "true";
  if (search) {
    const rx = searchRegex(search);
    filter.$or = [
      { shop_name: rx },
      { code: rx },
      { label_name: rx },
      { bill_name: rx },
      { mobile: rx },
      { address: rx },
      { handled_by: rx },
    ];
  }

  const [rows, total] = await Promise.all([
    Shop.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Shop.countDocuments(filter),
  ]);

  return paginated(res, rows.map(present), buildPaginationMeta(page, limit, total));
}

export async function getShop(req: Request, res: Response) {
  const shop = await Shop.findById(req.params.id).lean();
  if (!shop) throw ApiError.notFound("Shop not found");
  const links = await ShopProduct.find({ shop_id: shop._id }, { product_id: 1 }).lean();
  return ok(res, { ...present(shop), product_ids: links.map((l) => l.product_id) });
}

/** Which products each shop works with — read by several screens at once. */
export async function listShopProducts(_req: Request, res: Response) {
  const links = await ShopProduct.find({}, { shop_id: 1, product_id: 1 }).lean();
  return ok(res, links.map((l) => ({ shop_id: l.shop_id, product_id: l.product_id })));
}

/**
 * A shop's handler is a user account (see `listShopHandlers`), but the name is
 * stored on the shop as well so history survives that account being
 * deactivated, renamed or deleted. Resolving here keeps the two in step.
 */
async function resolveHandler(body: Record<string, unknown>) {
  if (!("handled_by_user_id" in body)) return;

  const userId = body.handled_by_user_id as string | null | undefined;
  if (!userId) {
    body.handled_by_user_id = null;
    return;
  }

  const user = await User.findById(userId, { fullName: 1 }).lean();
  if (!user) throw ApiError.badRequest("The selected person no longer has an account");
  body.handled_by = user.fullName;
}

async function syncShopProducts(shopId: string, productIds: string[]) {
  const existing = await ShopProduct.find({ shop_id: shopId }, { product_id: 1 }).lean();
  const current = new Set(existing.map((l) => l.product_id));
  const wanted = new Set(productIds);

  const toAdd = productIds.filter((id) => !current.has(id));
  const toRemove = existing.filter((l) => !wanted.has(l.product_id)).map((l) => l.product_id);

  if (toAdd.length) {
    await ShopProduct.insertMany(toAdd.map((product_id) => ({ shop_id: shopId, product_id })));
  }
  if (toRemove.length) {
    await ShopProduct.deleteMany({ shop_id: shopId, product_id: { $in: toRemove } });
  }
}

export async function createShop(req: Request, res: Response) {
  const { product_ids: productIds, ...body } = req.body as Record<string, unknown> & {
    product_ids: string[];
    code: string;
  };

  if (await Shop.exists({ code: body.code })) {
    throw ApiError.conflict(`A shop with code "${body.code}" already exists`);
  }
  if (body.area_id && !(await ShopArea.exists({ _id: body.area_id }))) {
    throw ApiError.badRequest("The selected shop area does not exist");
  }
  await resolveHandler(body);

  const shop = await Shop.create(body);
  await syncShopProducts(shop._id, productIds);

  return created(res, { ...present(shop.toObject()), product_ids: productIds });
}

export async function updateShop(req: Request, res: Response) {
  const shop = await Shop.findById(req.params.id);
  if (!shop) throw ApiError.notFound("Shop not found");

  const { product_ids: productIds, ...body } = req.body as Record<string, unknown> & {
    product_ids?: string[];
  };

  if (body.code && body.code !== shop.code) {
    if (await Shop.exists({ code: body.code, _id: { $ne: shop._id } })) {
      throw ApiError.conflict(`A shop with code "${body.code}" already exists`);
    }
  }
  if (body.area_id && !(await ShopArea.exists({ _id: body.area_id }))) {
    throw ApiError.badRequest("The selected shop area does not exist");
  }
  await resolveHandler(body);

  shop.set(body);
  await shop.save();
  if (productIds) await syncShopProducts(shop._id, productIds);

  const links = await ShopProduct.find({ shop_id: shop._id }, { product_id: 1 }).lean();
  return ok(res, { ...present(shop.toObject()), product_ids: links.map((l) => l.product_id) });
}

/**
 * "Deleting" a shop deactivates it: its orders, deliveries, payments and label
 * orders are history and must survive. A hard delete is only offered when the
 * shop has never traded.
 */
export async function deactivateShop(req: Request, res: Response) {
  const shop = await Shop.findById(req.params.id);
  if (!shop) throw ApiError.notFound("Shop not found");

  shop.is_active = false;
  await shop.save();
  return ok(res, { ...present(shop.toObject()), message: "Shop deactivated" });
}

export async function deleteShop(req: Request, res: Response) {
  const shop = await Shop.findById(req.params.id);
  if (!shop) throw ApiError.notFound("Shop not found");

  const [orders, labelOrders] = await Promise.all([
    Order.countDocuments({ shop_id: shop._id }),
    LabelOrder.countDocuments({ shop_id: shop._id }),
  ]);
  if (orders > 0 || labelOrders > 0) {
    throw ApiError.conflict(
      "This shop has trading history and cannot be permanently deleted — deactivate it instead",
    );
  }

  await ShopProduct.deleteMany({ shop_id: shop._id });
  await deleteShopImage(shop.image_path);
  await shop.deleteOne();
  return ok(res, { message: "Shop deleted" });
}

/**
 * The people a shop can be "Handled by": active users of every role flagged
 * `handlesShops` (Admin → Roles). Retiring a salesman is therefore just
 * deactivating their account — they drop out of this list immediately while
 * the shops they used to handle keep showing their name.
 *
 * Guarded by `shops:view`, not `users:view`, so anyone who can edit a shop can
 * fill this field without being handed the user directory.
 */
export async function listShopHandlers(_req: Request, res: Response) {
  const roles = await Role.find({ handlesShops: true }, { _id: 1, name: 1 }).lean();
  if (roles.length === 0) return ok(res, []);

  const roleName = new Map(roles.map((r) => [r._id, r.name]));
  const users = await User.find(
    { role: { $in: Array.from(roleName.keys()) }, isActive: true },
    { fullName: 1, role: 1 },
  )
    .sort({ fullName: 1 })
    .lean();

  return ok(
    res,
    users.map((u) => ({
      id: u._id,
      full_name: u.fullName,
      role_name: roleName.get(u.role) ?? "",
    })),
  );
}

export async function getNextShopCode(_req: Request, res: Response) {
  return ok(res, { code: await nextShopCode() });
}

/* --------------------------------------------------------------- shop image */

export async function uploadShopImage(req: Request, res: Response) {
  const shop = await Shop.findById(req.params.id);
  if (!shop) throw ApiError.notFound("Shop not found");
  if (!req.file) throw ApiError.badRequest("No image uploaded");

  const previous = shop.image_path;
  shop.image_path = await saveShopImage(shop._id, req.file);
  await shop.save();
  if (previous) await deleteShopImage(previous);

  return ok(res, { image_path: shop.image_path, image_url: signedImagePath(shop.image_path) });
}

export async function removeShopImage(req: Request, res: Response) {
  const shop = await Shop.findById(req.params.id);
  if (!shop) throw ApiError.notFound("Shop not found");

  await deleteShopImage(shop.image_path);
  shop.image_path = null;
  await shop.save();
  return ok(res, { image_path: null, image_url: null });
}

/* ------------------------------------------------------- analysis & history */

export async function getShopAnalysis(req: Request, res: Response) {
  const months = Number(req.query.months) || SHOP_ANALYSIS_MONTHS;
  return ok(res, await shopAnalysis(req.params.id, months));
}

/** Everything the Shop Detail page's tabs need, in one round trip. */
export async function getShopHistory(req: Request, res: Response) {
  const shopId = req.params.id;
  if (!(await Shop.exists({ _id: shopId }))) throw ApiError.notFound("Shop not found");

  const [orders, deliveries, payments] = await Promise.all([
    Order.find({ shop_id: shopId }).sort({ order_date: -1 }).limit(500).lean(),
    Delivery.find({ shop_id: shopId }).sort({ delivery_date: -1 }).limit(500).lean(),
    Payment.find({ shop_id: shopId }).sort({ payment_date: -1 }).limit(500).lean(),
  ]);

  const strip = <T extends { _id: string }>(row: T) => {
    const { _id, ...rest } = row;
    return { id: _id, ...rest };
  };

  return ok(res, {
    orders: orders.map(strip),
    deliveries: deliveries.map(strip),
    payments: payments.map(strip),
  });
}

/* -------------------------------------------------------------- shop areas */

export async function listShopAreas(_req: Request, res: Response) {
  const areas = await ShopArea.find().sort({ name: 1 }).lean();
  return ok(res, areas.map((a) => ({ id: a._id, name: a.name })));
}

/**
 * Find-or-create by name, case- and whitespace-insensitively — the same
 * guarantee `upsert_shop_area()` gave, so a check-then-insert race can't
 * create "Varachha" twice.
 */
export async function upsertShopArea(req: Request, res: Response) {
  const name = (req.body as { name: string }).name.trim();
  const name_key = name.toLowerCase();

  const existing = await ShopArea.findOne({ name_key }).lean();
  if (existing) return ok(res, { id: existing._id, name: existing.name });

  try {
    const area = await ShopArea.create({ name, name_key });
    return created(res, { id: area._id, name: area.name });
  } catch (error) {
    const raced = await ShopArea.findOne({ name_key }).lean();
    if (raced) return ok(res, { id: raced._id, name: raced.name });
    throw error;
  }
}

export async function updateShopArea(req: Request, res: Response) {
  const area = await ShopArea.findById(req.params.id);
  if (!area) throw ApiError.notFound("Shop area not found");

  const name = (req.body as { name: string }).name.trim();
  if (await ShopArea.exists({ name_key: name.toLowerCase(), _id: { $ne: area._id } })) {
    throw ApiError.conflict(`An area named "${name}" already exists`);
  }

  area.name = name;
  area.name_key = name.toLowerCase();
  await area.save();
  return ok(res, { id: area._id, name: area.name });
}

export async function deleteShopArea(req: Request, res: Response) {
  const area = await ShopArea.findById(req.params.id);
  if (!area) throw ApiError.notFound("Shop area not found");

  // Shops keep working without an area, so unassign rather than block.
  await Shop.updateMany({ area_id: area._id }, { $set: { area_id: null } });
  await area.deleteOne();
  return ok(res, { message: "Shop area deleted" });
}
