/**
 * Bill display types and helpers.
 *
 * The bill's authoritative content — invoice number, prices, line items, the
 * shop's billing name — is built by the API (`POST /bills`), so it is decided
 * in one place no matter who asks for it. What lives here is the shape the PDF
 * template consumes and two formatting helpers.
 */
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
  /** Formatted for print, e.g. "18 Aug 2026" — same convention as dateLabel(). */
  deliveryDateLabel: string;
  shopName: string;
  shopAddress: string | null;
  lines: BillLineItem[];
  totalAmount: number;
  totalAmountWords: string;
};

/** e.g. 123 -> "INV-000123" — zero-padded. */
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
