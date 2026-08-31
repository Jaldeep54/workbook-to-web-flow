import { Product } from "../models/catalogue.model.js";
import {
  Delivery,
  LabelOrder,
  Order,
  Payment,
  derivePaymentStatus,
  type IOrder,
  type OrderStatus,
} from "../models/order.model.js";
import { ApiError } from "../utils/api-error.js";
import { round2, todayIso } from "../utils/date.js";
import { labelCostByProduct } from "./catalogue.service.js";

/**
 * Order lifecycle — the MongoDB port of `set_order_delivered()` and
 * `set_order_status()`.
 *
 * Marking an order delivered is not just a status flip: it freezes the money
 * figures onto a delivery row and raises the payment for it, which is exactly
 * how the workbook behaved and what every downstream report reads. Keeping
 * that in one service (never in a controller, never in the frontend) is what
 * stops the three records drifting apart.
 *
 * Workbook rules preserved verbatim:
 *   Sales            = Σ qty x selling price
 *   Labelling cost   = Σ qty x label cost per unit (live, all label components)
 *   Jar & can cost   = Σ qty x packaging cost
 *   Production cost  = Σ qty x production cost
 *   Total fixed cost = production + jar & can + labelling
 *   Profit           = sales − total fixed cost
 */
export type DeliveryTotals = {
  total_qty: number;
  total_sales: number;
  labelling_cost: number;
  packaging_cost: number;
  production_cost: number;
  total_fixed_cost: number;
  profit: number;
};

export async function computeOrderTotals(
  lines: Array<{ product_id: string; qty: number }>,
): Promise<DeliveryTotals> {
  const productIds = lines.map((l) => l.product_id);
  const [products, labelCosts] = await Promise.all([
    Product.find({ _id: { $in: productIds } }).lean(),
    labelCostByProduct(),
  ]);
  const productById = new Map(products.map((p) => [p._id, p]));

  let total_qty = 0;
  let total_sales = 0;
  let labelling_cost = 0;
  let packaging_cost = 0;
  let production_cost = 0;

  for (const line of lines) {
    const product = productById.get(line.product_id);
    if (!product) continue;
    const qty = Number(line.qty) || 0;
    if (!qty) continue;
    total_qty += qty;
    total_sales += qty * Number(product.selling_price);
    labelling_cost += qty * (labelCosts.get(product._id) ?? 0);
    packaging_cost += qty * Number(product.packaging_cost);
    production_cost += qty * Number(product.production_cost);
  }

  const total_fixed_cost = production_cost + packaging_cost + labelling_cost;

  return {
    total_qty: round2(total_qty),
    total_sales: round2(total_sales),
    labelling_cost: round2(labelling_cost),
    packaging_cost: round2(packaging_cost),
    production_cost: round2(production_cost),
    total_fixed_cost: round2(total_fixed_cost),
    profit: round2(total_sales - total_fixed_cost),
  };
}

/** Next sequential order number for a shop (per-shop slots, as in the workbook). */
export async function nextOrderNo(
  collection: "orders" | "label_orders",
  shopId: string,
): Promise<number> {
  const latest =
    collection === "orders"
      ? await Order.findOne({ shop_id: shopId }, { order_no: 1 }).sort({ order_no: -1 }).lean()
      : await LabelOrder.findOne({ shop_id: shopId }, { order_no: 1 }).sort({ order_no: -1 }).lean();
  return (latest?.order_no ?? 0) + 1;
}

/**
 * Creates or refreshes the delivery + payment pair for an order and marks the
 * order delivered. Re-runnable: editing a delivered order re-runs this and the
 * frozen figures follow the edit.
 *
 * A payment already settled in full keeps its amount (the money really did
 * arrive); anything else is re-synced to the new sales figure, carrying any
 * part payment already collected across untouched.
 */
export async function setOrderDelivered(orderId: string, deliveryDate: string): Promise<string> {
  const order = await Order.findById(orderId).lean();
  if (!order) throw ApiError.notFound("Order not found");

  const totals = await computeOrderTotals(order.order_lines ?? []);
  const lines = (order.order_lines ?? [])
    .filter((l) => Number(l.qty) > 0)
    .map((l) => ({ product_id: l.product_id, qty: Number(l.qty) }));

  const delivery = await Delivery.findOneAndUpdate(
    { order_id: orderId },
    {
      $set: {
        shop_id: order.shop_id,
        order_id: orderId,
        delivery_date: deliveryDate,
        month: `${deliveryDate.slice(0, 7)}-01`,
        status: "Delivered",
        delivery_lines: lines,
        ...totals,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  const existingPayment = await Payment.findOne({ order_id: orderId }).lean();
  if (existingPayment) {
    // Money already collected is never rewritten — it really did arrive. The
    // bill itself follows the edit unless it has been settled in full, and the
    // status is re-derived so a re-priced order that is now only part paid
    // stops claiming to be Received.
    const received = Number(existingPayment.amount_received) || 0;
    const amount = existingPayment.status === "Received" ? existingPayment.amount : totals.total_sales;
    await Payment.updateOne(
      { order_id: orderId },
      {
        $set: {
          shop_id: order.shop_id,
          amount,
          amount_received: received,
          status: derivePaymentStatus(amount, received),
        },
      },
    );
  } else {
    await Payment.create({
      shop_id: order.shop_id,
      order_id: orderId,
      payment_date: deliveryDate,
      month: `${deliveryDate.slice(0, 7)}-01`,
      amount: totals.total_sales,
      amount_received: 0,
    });
  }

  await Order.updateOne(
    { _id: orderId },
    { $set: { status: "Delivered", delivery_date: deliveryDate } },
  );

  return delivery._id;
}

/**
 * Moves an order to Pending / Delivered / Cancelled.
 *
 * Leaving Delivered removes the payment unless money has already been
 * collected against it, in full or in part — in which case the delivery row is
 * kept too (the money is real), but its status is moved in step with the order
 * so the two can never disagree. That last detail was a real bug in the SQL
 * version: the surviving delivery row silently stayed "Delivered" forever.
 */
export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  deliveryDate?: string | null,
): Promise<void> {
  const order = await Order.findById(orderId).lean();
  if (!order) throw ApiError.notFound("Order not found");

  if (status === "Delivered") {
    const date = deliveryDate ?? order.delivery_date ?? order.order_date ?? todayIso();
    await setOrderDelivered(orderId, date);
    return;
  }

  // Any money already collected — in full or in part — is real, so those rows
  // survive; only a payment nothing has been paid against is withdrawn.
  // `$not: $gt` rather than `$lte`, so rows written before amount_received
  // existed (where the field is simply absent) still count as unpaid.
  await Payment.deleteOne({ order_id: orderId, amount_received: { $not: { $gt: 0 } } });
  const receivedPayment = await Payment.exists({ order_id: orderId });
  if (!receivedPayment) {
    await Delivery.deleteOne({ order_id: orderId });
  } else {
    await Delivery.updateOne({ order_id: orderId }, { $set: { status } });
  }

  await Order.updateOne({ _id: orderId }, { $set: { status } });
}

/** Deleting an order takes its delivery, payment and invoice with it. */
export async function deleteOrderCascade(orderId: string): Promise<void> {
  const { Invoice } = await import("../models/finance.model.js");
  await Promise.all([
    Delivery.deleteOne({ order_id: orderId }),
    Payment.deleteOne({ order_id: orderId }),
    Invoice.deleteOne({ order_id: orderId }),
  ]);
  await Order.deleteOne({ _id: orderId });
}

/** Shared shape returned by every order-listing endpoint. */
export type OrderWithShop = Omit<IOrder, "_id"> & {
  id: string;
  shops: { code: string; shop_name: string; label_name: string | null } | null;
};
