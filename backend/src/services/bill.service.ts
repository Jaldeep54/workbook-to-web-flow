import { Product } from "../models/catalogue.model.js";
import { Order } from "../models/order.model.js";
import { Shop } from "../models/shop.model.js";
import { ApiError } from "../utils/api-error.js";
import { round2 } from "../utils/date.js";

/**
 * Bill (Invoice + Delivery Challan) data.
 *
 * The backend owns everything that must be authoritative and stable — the
 * invoice number, the prices, the shop's billing name — while the PDF itself
 * is rendered by the frontend from this payload.
 *
 * The invoice number *is* the order number. Bills used to carry a separate
 * global sequence, which meant the number a shopkeeper read off the bill
 * matched nothing on the Orders screen. Order numbers run per shop (the
 * workbook's rule, kept), so the shop's code is what makes the printed number
 * unique across the business: shop KL012's seventh order bills as
 * `INV-KL012-0007`, on every regeneration, forever. Nothing is allocated and
 * nothing can drift.
 */
const BILL_ITEM_NAME: Record<string, string> = {
  dw200: "Dishwash Pouch",
  dw350: "Dishwash Medium",
  dw480: "Dishwash Premium",
  ll500: "Laundry Medium",
  ll700: "Laundry Premium",
  tc60: "Toilet Cleaner",
};

export type BillLineItem = {
  itemName: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  amount: number;
};

export type BillData = {
  orderId: string;
  /** The shop's own order number — what the Orders screen shows in "No.". */
  invoiceNo: number;
  /** Scopes `invoiceNo`, which only runs sequentially within one shop. */
  shopCode: string;
  deliveryDateRaw: string;
  shopName: string;
  shopAddress: string | null;
  lines: BillLineItem[];
  totalAmount: number;
};

export async function buildBills(orderIds: string[]): Promise<BillData[]> {
  const [orders, products] = await Promise.all([
    Order.find({ _id: { $in: orderIds } }).lean(),
    Product.find().sort({ sort_order: 1 }).lean(),
  ]);

  const orderById = new Map(orders.map((o) => [o._id, o]));
  // Preserve the caller's order (the selected rows' order) and skip ids that
  // no longer resolve to a real order.
  const resolved = orderIds.map((id) => orderById.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
  if (resolved.length === 0) throw ApiError.notFound("None of the selected orders could be found");

  const shops = await Shop.find(
    { _id: { $in: resolved.map((o) => o.shop_id) } },
    { code: 1, shop_name: 1, bill_name: 1, address: 1 },
  ).lean();
  const shopById = new Map(shops.map((s) => [s._id, s]));

  const bills: BillData[] = [];
  for (const order of resolved) {
    const shop = shopById.get(order.shop_id);
    const qtyByProduct = new Map(
      (order.order_lines ?? []).map((l) => [l.product_id, Number(l.qty) || 0]),
    );

    const lines = products
      .map((product) => {
        const quantity = qtyByProduct.get(product._id) ?? 0;
        const pricePerUnit = Number(product.selling_price) || 0;
        return {
          itemName: BILL_ITEM_NAME[product.key] ?? product.short_name,
          quantity,
          unit: product.unit || "",
          pricePerUnit,
          amount: round2(quantity * pricePerUnit),
        };
      })
      .filter((line) => line.quantity > 0);

    bills.push({
      orderId: order._id,
      invoiceNo: order.order_no,
      shopCode: shop?.code ?? "",
      deliveryDateRaw: order.delivery_date ?? "",
      shopName: shop?.bill_name || shop?.shop_name || "Unknown shop",
      shopAddress: shop?.address?.trim() ? shop.address.trim() : null,
      lines,
      totalAmount: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
    });
  }

  return bills;
}
