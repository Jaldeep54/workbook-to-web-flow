import { Collection, type CollectionAllocation } from "../models/collection.model.js";
import { Delivery, Order, Payment, derivePaymentStatus } from "../models/order.model.js";
import { Role, type FieldRole } from "../models/role.model.js";
import { Shop } from "../models/shop.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";
import { round2 } from "../utils/date.js";

/**
 * Field team rules shared by Field Operations and the Manager / Salesperson
 * dashboards.
 *
 * Who belongs to which team comes from the user's role (`Role.fieldRole`), and
 * which shops they work is:
 *   manager     — shops they handle (`handled_by_user_id`) + shops granted to them
 *   salesperson — shops they sell to (`salesperson_user_id`) + shops granted to them
 * Grants live on the shop (`access_user_ids`), written by "Give Access".
 */

export async function fieldRoleOf(userId: string): Promise<FieldRole | null> {
  const user = await User.findById(userId, { role: 1 }).lean();
  if (!user) return null;
  const role = await Role.findById(user.role, { fieldRole: 1 }).lean();
  return role?.fieldRole ?? null;
}

/** Mongo filter for the shops one field user works. */
export function shopFilterFor(kind: FieldRole, userId: string): Record<string, unknown> {
  const own = kind === "manager" ? "handled_by_user_id" : "salesperson_user_id";
  return { $or: [{ [own]: userId }, { access_user_ids: userId }] };
}

/**
 * The shops the signed-in user may work in Field Operations: their own when
 * they are on a field team, every shop otherwise (office staff and admins).
 */
export async function fieldScopeFor(
  userId: string,
): Promise<{ scope: FieldRole | "all"; filter: Record<string, unknown> }> {
  const kind = await fieldRoleOf(userId);
  if (!kind) return { scope: "all", filter: {} };
  return { scope: kind, filter: shopFilterFor(kind, userId) };
}

export async function assertShopInScope(userId: string, shopId: string): Promise<void> {
  const { filter } = await fieldScopeFor(userId);
  const exists = await Shop.exists({ ...filter, _id: shopId });
  if (!exists) throw ApiError.notFound("Shop not found, or not assigned to you");
}

/* -------------------------------------------------------- pending payments */

export type PendingDelivery = {
  payment_id: string;
  order_id: string;
  order_no: number | null;
  delivery_date: string | null;
  amount: number;
  amount_received: number;
  balance: number;
};

/**
 * Every delivery the shop still owes money on, in the order a collection pays
 * them off: oldest delivery date first, then lowest order number for
 * deliveries on the same day (so the order the shop actually placed them in).
 * The delivery's own date is used, falling back to the payment's date for rows
 * whose delivery has since gone.
 */
export async function pendingDeliveries(shopId: string): Promise<PendingDelivery[]> {
  const payments = await Payment.find({ shop_id: shopId, status: { $ne: "Received" } }).lean();
  if (payments.length === 0) return [];

  const orderIds = payments.map((p) => p.order_id);
  const [deliveries, orders] = await Promise.all([
    Delivery.find({ order_id: { $in: orderIds } }, { order_id: 1, delivery_date: 1 }).lean(),
    Order.find({ _id: { $in: orderIds } }, { order_no: 1 }).lean(),
  ]);
  const deliveryDate = new Map(deliveries.map((d) => [d.order_id, d.delivery_date]));
  const orderNo = new Map(orders.map((o) => [o._id, o.order_no]));

  return payments
    .map((p) => {
      const amount = Number(p.amount) || 0;
      const received = Number(p.amount_received) || 0;
      return {
        payment_id: p._id,
        order_id: p.order_id,
        order_no: orderNo.get(p.order_id) ?? null,
        delivery_date: deliveryDate.get(p.order_id) ?? p.payment_date ?? null,
        amount,
        amount_received: received,
        balance: round2(Math.max(0, amount - received)),
      };
    })
    .filter((p) => p.balance > 0)
    .sort((a, b) => {
      const da = a.delivery_date ?? "9999-12-31";
      const db = b.delivery_date ?? "9999-12-31";
      if (da !== db) return da < db ? -1 : 1;
      return (a.order_no ?? Number.MAX_SAFE_INTEGER) - (b.order_no ?? Number.MAX_SAFE_INTEGER);
    });
}

/* ------------------------------------------------------------ make payment */

export type CollectionInput = {
  shopId: string;
  collectionDate: string;
  amount: number;
  changeMoney: number;
  collectedBy: { id: string | null; name: string | null };
  recordedByUserId: string;
};

/**
 * "Make Payment": spreads one collected sum across the shop's pending
 * deliveries, oldest first, until it runs out. With ₹2,000 / ₹3,500 / ₹4,000
 * pending and ₹6,000 collected, the first two are settled and ₹500 goes
 * against the third, leaving ₹3,500 still owed on it.
 *
 * Each payment is written with a guard on the amount it was read at, so two
 * people collecting from the same shop at once can't both spend the same
 * balance; if that guard trips, what was applied is rolled back and the
 * caller is asked to retry.
 */
export async function recordCollection(input: CollectionInput) {
  const amount = round2(input.amount);
  if (amount <= 0) throw ApiError.badRequest("Collection amount must be greater than zero");

  const pending = await pendingDeliveries(input.shopId);
  const totalPending = round2(pending.reduce((sum, p) => sum + p.balance, 0));
  if (totalPending <= 0) throw ApiError.badRequest("This shop has no pending payments");
  if (amount > totalPending) {
    throw ApiError.badRequest(
      `Collection of ₹${amount} is more than the ₹${totalPending} this shop owes`,
    );
  }

  let remaining = amount;
  const allocations: CollectionAllocation[] = [];
  const applied: Array<{ payment_id: string; previous: number }> = [];

  const rollback = async () => {
    for (const a of applied) {
      const payment = await Payment.findById(a.payment_id);
      if (!payment) continue;
      payment.amount_received = a.previous;
      await payment.save();
    }
  };

  try {
    for (const row of pending) {
      if (remaining <= 0) break;
      const share = round2(Math.min(row.balance, remaining));
      const received = round2(row.amount_received + share);

      const result = await Payment.updateOne(
        { _id: row.payment_id, amount_received: row.amount_received },
        {
          $set: {
            amount_received: received,
            status: derivePaymentStatus(row.amount, received),
            collected_date: input.collectionDate,
            collected_by: input.collectedBy.name,
            collected_by_user_id: input.collectedBy.id,
          },
        },
      );
      if (result.modifiedCount !== 1) {
        throw ApiError.conflict(
          "These payments changed while you were saving — refresh and try again",
        );
      }

      applied.push({ payment_id: row.payment_id, previous: row.amount_received });
      allocations.push({ payment_id: row.payment_id, order_id: row.order_id, amount: share });
      remaining = round2(remaining - share);
    }

    return await Collection.create({
      shop_id: input.shopId,
      collection_date: input.collectionDate,
      amount,
      change_money: round2(input.changeMoney),
      collected_by: input.collectedBy.name,
      collected_by_user_id: input.collectedBy.id,
      recorded_by_user_id: input.recordedByUserId,
      allocations,
    });
  } catch (error) {
    await rollback();
    throw error;
  }
}

/**
 * Undoes a collection: takes each allocated share back off its payment (never
 * below zero — the bill may have been corrected since) and removes the row.
 */
export async function reverseCollection(collectionId: string): Promise<void> {
  const collection = await Collection.findById(collectionId);
  if (!collection) throw ApiError.notFound("Collection not found");

  for (const allocation of collection.allocations) {
    const payment = await Payment.findById(allocation.payment_id);
    if (!payment) continue;
    payment.amount_received = round2(
      Math.max(0, (Number(payment.amount_received) || 0) - allocation.amount),
    );
    await payment.save();
  }
  await collection.deleteOne();
}
