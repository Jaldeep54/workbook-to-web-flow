import { Product } from "../models/catalogue.model.js";
import { Invoice, nextSequence } from "../models/finance.model.js";
import { Order } from "../models/order.model.js";
import { Shop } from "../models/shop.model.js";
import { ApiError } from "../utils/api-error.js";
import { round2 } from "../utils/date.js";

/**
 * Bill (Invoice + Delivery Challan) data.
 *
 * The backend owns everything that must be authoritative and stable — the
 * invoice number, the prices, the shop's billing name — while the PDF itself
 * is rendered by the frontend from this payload. Invoice numbers are allocated
 * once per order and reused on every regeneration, via an atomic counter so a
 * "generate all bills" batch can't hand two orders the same number.
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
  invoiceNo: number;
  deliveryDateRaw: string;
  shopName: string;
  shopAddress: string | null;
  lines: BillLineItem[];
  totalAmount: number;
};

export async function getOrCreateInvoiceNo(orderId: string): Promise<number> {
  const existing = await Invoice.findOne({ order_id: orderId }, { invoice_no: 1 }).lean();
  if (existing) return existing.invoice_no;

  const invoice_no = await nextSequence("invoice_no");
  try {
    const created = await Invoice.create({ order_id: orderId, invoice_no });
    return created.invoice_no;
  } catch (error) {
    // Lost a race with a concurrent request for the same order — reuse theirs.
    const winner = await Invoice.findOne({ order_id: orderId }, { invoice_no: 1 }).lean();
    if (winner) return winner.invoice_no;
    throw error;
  }
}

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
    { shop_name: 1, bill_name: 1, address: 1 },
  ).lean();
  const shopById = new Map(shops.map((s) => [s._id, s]));

  const bills: BillData[] = [];
  for (const order of resolved) {
    const invoiceNo = await getOrCreateInvoiceNo(order._id);
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
      invoiceNo,
      deliveryDateRaw: order.delivery_date ?? "",
      shopName: shop?.bill_name || shop?.shop_name || "Unknown shop",
      shopAddress: shop?.address?.trim() ? shop.address.trim() : null,
      lines,
      totalAmount: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
    });
  }

  return bills;
}
