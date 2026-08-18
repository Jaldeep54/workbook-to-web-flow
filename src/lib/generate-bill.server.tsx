import { createServerFn } from "@tanstack/react-start";

import { buildBillData, slugify, type BillProductInput } from "./bill-data";
import type { LogoSource } from "./bill-pdf";

/**
 * Fetches the logo over HTTP from this same deployment (not the filesystem —
 * a Vercel serverless function's cwd doesn't reliably expose `public/` at
 * runtime, but the static file is always served at this same origin, in both
 * dev and prod). Falls back to null (the bill template's text wordmark) if
 * the file hasn't been added to public/klinzo-logo.png yet, or the fetch
 * fails for any reason — a missing logo should never break bill generation.
 */
async function fetchLogo(): Promise<LogoSource | null> {
  try {
    const { getRequestUrl } = await import("@tanstack/react-start/server");
    const origin = getRequestUrl();
    const res = await fetch(new URL("/klinzo-logo.png", origin));
    if (!res.ok) return null;
    return { data: Buffer.from(await res.arrayBuffer()), format: "png" };
  } catch {
    return null;
  }
}

type OrderRow = {
  id: string;
  delivery_date: string | null;
  order_lines: Array<{ product_id: string; qty: number }>;
  shops: { shop_name: string; address: string | null } | null;
};

function parseOrderIds(data: unknown): { orderIds: string[] } {
  if (
    typeof data !== "object" ||
    data === null ||
    !("orderIds" in data) ||
    !Array.isArray((data as { orderIds: unknown }).orderIds) ||
    (data as { orderIds: unknown[] }).orderIds.length === 0 ||
    (data as { orderIds: unknown[] }).orderIds.some((id) => typeof id !== "string" || !id)
  ) {
    throw new Error("orderIds must be a non-empty array of order id strings");
  }
  return { orderIds: (data as { orderIds: string[] }).orderIds };
}

/**
 * Generates one print-ready PDF (one A4 page per order — Invoice on top,
 * Delivery Challan on bottom) for the given order id(s), fetching everything
 * server-side (Supabase, invoice numbering, PDF assembly) so the client only
 * POSTs order ids and receives a PDF download. Used for both the per-row
 * "Generate bill" action (one id) and "Generate all bills" (many ids, pages
 * in the same order the ids are given in).
 */
export const generateBillsPdf = createServerFn({ method: "POST" })
  .validator(parseOrderIds)
  .handler(async ({ data }) => {
    const { orderIds } = data;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [ordersResult, productsResult] = await Promise.all([
      supabaseAdmin
        .from("orders")
        .select("id, delivery_date, order_lines(product_id, qty), shops(shop_name, address)")
        .in("id", orderIds as never),
      supabaseAdmin
        .from("products")
        .select("id, key, short_name, unit, selling_price, sort_order")
        .order("sort_order"),
    ]);
    if (ordersResult.error) throw new Error(ordersResult.error.message);
    if (productsResult.error) throw new Error(productsResult.error.message);

    const orderById = new Map(
      ((ordersResult.data ?? []) as unknown as OrderRow[]).map((o) => [o.id, o]),
    );
    const products = (productsResult.data ?? []) as unknown as BillProductInput[];

    // Preserve the order the ids were given in (the selected table rows'
    // order), and skip any id that no longer resolves to a real order.
    const resolvedOrders = orderIds
      .map((id) => orderById.get(id))
      .filter((o): o is OrderRow => o !== undefined);
    if (resolvedOrders.length === 0) {
      throw new Error("None of the selected orders could be found");
    }

    // Invoice numbers are allocated per order_id via an atomic
    // INSERT ... ON CONFLICT DO NOTHING RPC — stable across regenerations,
    // and race-safe even if two orders (or two clicks) resolve concurrently.
    const invoiceNos = await Promise.all(
      resolvedOrders.map(async (o) => {
        const { data: invoiceNo, error } = await supabaseAdmin.rpc(
          "get_or_create_invoice_no" as never,
          { p_order_id: o.id } as never,
        );
        if (error) throw new Error(`${o.shops?.shop_name ?? o.id}: ${error.message}`);
        return invoiceNo as unknown as number;
      }),
    );

    const bills = resolvedOrders.map((o, i) =>
      buildBillData({
        orderId: o.id,
        invoiceNo: invoiceNos[i],
        deliveryDate: o.delivery_date ?? "",
        shopName: o.shops?.shop_name ?? "Unknown shop",
        shopAddress: o.shops?.address ?? null,
        orderLines: o.order_lines,
        products,
      }),
    );

    const logoSrc = await fetchLogo();

    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { BillsDocument } = await import("./bill-pdf");
    const buffer = await renderToBuffer(<BillsDocument bills={bills} logoSrc={logoSrc} />);

    const filename =
      bills.length === 1
        ? `klinzo-bill-${slugify(bills[0].shopName)}-${bills[0].deliveryDateRaw || "undated"}.pdf`
        : `klinzo-bills-${bills[0].deliveryDateRaw || "undated"}.pdf`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  });
