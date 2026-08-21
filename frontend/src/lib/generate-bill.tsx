import { billsApi, type BillPayload } from "@/services/klinzo.service";
import { amountInWords } from "./numberToWords";
import { dateLabel } from "./format";
import { slugify, type BillData } from "./bill-data";
import { downloadBlob } from "./export";

/**
 * Bill generation, split the way the rest of the app is:
 *
 *  - the **API** owns everything that must be authoritative — the invoice
 *    number (stable per order, allocated atomically), the prices, the shop's
 *    billing name and address;
 *  - the **frontend** owns presentation — turning that payload into the
 *    A4 Invoice + Delivery Challan PDF and handing it to the browser.
 */
const LOGO_URL = "/klinzo-logo.png";

function toBillData(payload: BillPayload): BillData {
  return {
    orderId: payload.orderId,
    invoiceNo: payload.invoiceNo,
    deliveryDateRaw: payload.deliveryDateRaw,
    deliveryDateLabel: dateLabel(payload.deliveryDateRaw),
    shopName: payload.shopName,
    shopAddress: payload.shopAddress,
    lines: payload.lines,
    totalAmount: payload.totalAmount,
    totalAmountWords: amountInWords(payload.totalAmount),
  };
}

/** Fetches the bill data for the given orders and downloads one PDF for them. */
export async function downloadBills(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) throw new Error("Select at least one order");

  const payloads = await billsApi.generate(orderIds);
  const bills = payloads.map(toBillData);

  const [{ pdf }, { BillsDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./bill-pdf"),
  ]);

  const blob = await pdf(<BillsDocument bills={bills} logoSrc={LOGO_URL} />).toBlob();

  const filename =
    bills.length === 1
      ? `klinzo-bill-${slugify(bills[0].shopName)}-${bills[0].deliveryDateRaw || "undated"}.pdf`
      : `klinzo-bills-${bills[0].deliveryDateRaw || "undated"}.pdf`;

  downloadBlob(filename, blob);
}
