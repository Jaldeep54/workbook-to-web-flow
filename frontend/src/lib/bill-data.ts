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
  /** The shop's own order number — the same figure the Orders table shows. */
  invoiceNo: number;
  /** Scopes `invoiceNo`, which only runs sequentially within one shop. */
  shopCode: string;
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

/**
 * The number printed on a bill: the shop's own order number, prefixed with the
 * shop's code — e.g. order 7 for shop KL012 is `INV-KL012-0007`.
 *
 * Order numbers restart at 1 for every shop (the workbook's rule), so the code
 * is what keeps the printed number unique across the business. It stays the
 * same on every regeneration because nothing about it is allocated. A shop
 * with no code on file still gets a usable `INV-0007`.
 */
export function formatInvoiceNo(invoiceNo: number, shopCode?: string | null): string {
  const number = String(invoiceNo).padStart(4, "0");
  const code = shopCode?.trim();
  return code ? `INV-${code}-${number}` : `INV-${number}`;
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
