import { dateLabel } from "./format";
import { amountInWords } from "./numberToWords";

/**
 * Bill-only display names — deliberately different from products.name /
 * short_name (which stay exactly as-is everywhere else in the app: delivery
 * sheet, orders, settings). Keyed by the stable products.key so it survives
 * renames, same approach as products.unit.
 */
const BILL_ITEM_NAME: Record<string, string> = {
  dw200: "Dishwash Pouch",
  dw350: "Dishwash Medium",
  dw480: "Dishwash Premium",
  ll500: "Laundry Medium",
  ll700: "Laundry Premium",
  tc60: "Toilet Cleaner",
};

/** Falls back to the product's own short_name for any product key not yet in the map. */
export function billItemName(productKey: string, fallbackShortName: string): string {
  return BILL_ITEM_NAME[productKey] ?? fallbackShortName;
}

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
  /** Raw ISO date (YYYY-MM-DD) — used for filenames, not printed on the bill. */
  deliveryDateRaw: string;
  /** Formatted for print, e.g. "18 Aug 2026" — same convention as dateLabel() elsewhere. */
  deliveryDateLabel: string;
  shopName: string;
  shopAddress: string | null;
  lines: BillLineItem[];
  totalAmount: number;
  totalAmountWords: string;
};

export type BillProductInput = {
  id: string;
  key: string;
  short_name: string;
  unit: string;
  selling_price: number;
  sort_order: number;
};

/** Builds the fully-resolved bill data for one order — pure, no I/O. */
export function buildBillData(params: {
  orderId: string;
  invoiceNo: number;
  deliveryDate: string;
  shopName: string;
  shopAddress: string | null;
  orderLines: Array<{ product_id: string; qty: number }>;
  products: BillProductInput[];
}): BillData {
  const { orderId, invoiceNo, deliveryDate, shopName, shopAddress, orderLines, products } = params;
  const qtyByProduct = new Map(orderLines.map((l) => [l.product_id, Number(l.qty) || 0]));
  const deliveryDateLabel = dateLabel(deliveryDate);

  const lines: BillLineItem[] = products
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => {
      const quantity = qtyByProduct.get(p.id) ?? 0;
      const pricePerUnit = Number(p.selling_price) || 0;
      return {
        itemName: billItemName(p.key, p.short_name),
        quantity,
        unit: p.unit,
        pricePerUnit,
        amount: quantity * pricePerUnit,
      };
    })
    .filter((line) => line.quantity > 0);

  const totalAmount = lines.reduce((sum, l) => sum + l.amount, 0);

  return {
    orderId,
    invoiceNo,
    deliveryDateRaw: deliveryDate,
    deliveryDateLabel,
    shopName,
    shopAddress: shopAddress?.trim() ? shopAddress.trim() : null,
    lines,
    totalAmount,
    totalAmountWords: amountInWords(totalAmount),
  };
}

/** e.g. 123 -> "INV-000123" — zero-padded, no existing convention to match yet. */
export function formatInvoiceNo(invoiceNo: number): string {
  return `INV-${String(invoiceNo).padStart(6, "0")}`;
}

/** Filesystem-safe slug for filenames — lowercase, hyphenated, no punctuation. */
export function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "shop"
  );
}
