import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarIcon, Download } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { productsQuery } from "@/lib/queries";
import { deliverySheetQuery } from "@/lib/records";
import { ORDER_STATUSES } from "@/lib/domain";
import { dateLabel, num, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/delivery-sheet")({
  head: () => ({
    meta: [
      { title: "Delivery sheet — Klinzo Operations" },
      {
        name: "description",
        content: "Pick a date and see every order due for delivery, with product quantities and status updates.",
      },
      { property: "og:title", content: "Delivery sheet — Klinzo Operations" },
      { property: "og:description", content: "The day's delivery run, ready to print or export." },
    ],
  }),
  component: DeliverySheetPage,
});

function DeliverySheetPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const { data: products = [] } = useQuery(productsQuery);
  const { data: orders = [], isLoading } = useQuery(deliverySheetQuery(date));

  const setStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const { error } = await supabase.rpc("set_order_status" as never, {
        p_order_id: orderId,
        p_status: status,
        p_delivery_date: date,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.status === "Delivered" ? "Marked delivered — delivery and payment created" : `Status set to ${vars.status}`,
      );
      for (const key of [
        "delivery_sheet",
        "orders",
        "deliveries",
        "payments",
        "payable_deliveries",
        "dashboard_summary",
        "available_months",
        "order_qty_by_product",
        "sku_opportunity",
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const qtyFor = (order: (typeof orders)[number], productId: string) =>
    order.order_lines.find((l) => l.product_id === productId)?.qty ?? 0;

  const productNames = (order: (typeof orders)[number]) =>
    products
      .filter((p) => qtyFor(order, p.id) > 0)
      .map((p) => `${p.short_name} × ${num(qtyFor(order, p.id))}`)
      .join(", ");

  const totalQty = orders.reduce((a, o) => a + Number(o.total_qty), 0);
  const delivered = orders.filter((o) => o.status === "Delivered").length;

  return (
    <>
      <PageHeader
        title="Delivery sheet"
        description={`Orders scheduled for delivery on ${dateLabel(date)}`}
        actions={
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-[200px] justify-start bg-card font-normal")}>
                  <CalendarIcon className="size-4" />
                  {dateLabel(date)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={new Date(`${date}T00:00:00`)}
                  onSelect={(d) => {
                    if (!d) return;
                    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
                    setDate(local.toISOString().slice(0, 10));
                  }}
                  initialFocus
                  className={cn("pointer-events-auto p-3")}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `klinzo-delivery-sheet-${date}`,
                  orders.map((o, i) => ({
                    "S. No.": i + 1,
                    "Shop name": o.shops?.shop_name ?? "",
                    "Label name": o.shops?.label_name ?? "",
                    "Order number": o.order_no,
                    Status: o.status ?? "",
                    Products: productNames(o),
                    ...Object.fromEntries(products.map((p) => [p.short_name, qtyFor(o, p.id)])),
                    "Total qty": o.total_qty,
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Orders on this date" value={String(orders.length)} />
        <StatCard label="Units to deliver" value={num(totalQty)} tone="accent" />
        <StatCard label="Marked delivered" value={`${delivered} / ${orders.length}`} tone="positive" />
      </div>

      <div className="surface-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14 text-right">S. No.</TableHead>
              <TableHead>Shop name</TableHead>
              <TableHead>Label name</TableHead>
              <TableHead className="text-right">Order no.</TableHead>
              <TableHead>Products</TableHead>
              {products.map((p) => (
                <TableHead key={p.id} className="text-right">
                  {p.short_name}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={products.length + 7} className="py-10 text-center text-muted-foreground">
                  Loading delivery sheet…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={products.length + 7} className="py-12 text-center text-muted-foreground">
                  No orders scheduled for {dateLabel(date)}.
                </TableCell>
              </TableRow>
            )}
            {orders.map((o, i) => (
              <TableRow key={o.id}>
                <TableCell className="num text-right text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{o.shops?.shop_name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{o.shops?.label_name ?? "—"}</TableCell>
                <TableCell className="num text-right">{o.order_no}</TableCell>
                <TableCell className="max-w-[18rem] text-sm">{productNames(o) || "—"}</TableCell>
                {products.map((p) => (
                  <TableCell key={p.id} className="num text-right">
                    {qtyFor(o, p.id) || "—"}
                  </TableCell>
                ))}
                <TableCell className="num text-right font-semibold">{num(o.total_qty)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select
                      value={o.status ?? "Pending"}
                      onValueChange={(status) => setStatus.mutate({ orderId: o.id, status })}
                    >
                      <SelectTrigger className="w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {o.status === "Delivered" && <Badge>Synced</Badge>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}