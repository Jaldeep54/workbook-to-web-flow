import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CalendarIcon, Download, FileText, Send } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { ShopAreaFilter } from "@/components/filter-bar";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { productsQuery, shopsQuery } from "@/lib/queries";
import { deliverySheetQuery } from "@/lib/records";
import { generateBillsPdf } from "@/lib/generate-bill.server";
import { ORDER_STATUSES } from "@/lib/domain";
import { dateLabel, num, todayISO } from "@/lib/format";
import { downloadBlob, downloadCsv, filenameFromContentDisposition } from "@/lib/export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/delivery-sheet")({
  head: () => ({
    meta: [
      { title: "Delivery sheet — Klinzo Operations" },
      {
        name: "description",
        content:
          "Pick a date and see every order due for delivery, with product quantities and status updates.",
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
  const [areaFilter, setAreaFilter] = useState("all");
  const { data: products = [] } = useQuery(productsQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: allOrders = [], isLoading } = useQuery(deliverySheetQuery(date));

  const shopById = useMemo(() => new Map(shops.map((s) => [s.id, s])), [shops]);
  const orders = useMemo(
    () =>
      areaFilter === "all"
        ? allOrders
        : allOrders.filter((o) => shopById.get(o.shop_id)?.area_id === areaFilter),
    [allOrders, shopById, areaFilter],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [date]);
  const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const selectedCount = orderIds.filter((id) => selected.has(id)).length;

  const downloadBillPdf = async (ids: string[]) => {
    const response = await generateBillsPdf({ data: { orderIds: ids } });
    const blob = await response.blob();
    const filename = filenameFromContentDisposition(
      response.headers.get("content-disposition"),
      "klinzo-bill.pdf",
    );
    downloadBlob(filename, blob);
  };

  const generateBill = useMutation({
    mutationFn: downloadBillPdf,
    onSuccess: () => toast.success("Bill downloaded"),
    onError: (e: Error) => toast.error(e.message),
  });

  const generateAllBills = useMutation({
    mutationFn: () => downloadBillPdf(orderIds.filter((id) => selected.has(id))),
    onSuccess: () => toast.success("Bills downloaded"),
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const { error } = await supabase.rpc(
        "set_order_status" as never,
        {
          p_order_id: orderId,
          p_status: status,
          p_delivery_date: date,
        } as never,
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.status === "Delivered"
          ? "Marked delivered — delivery and payment created"
          : `Status set to ${vars.status}`,
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
        "shop_history",
        "shop_analysis",
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
                <Button
                  variant="outline"
                  className={cn("w-[200px] justify-start bg-card font-normal")}
                >
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
            <ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />
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
                    "Design type": shopById.get(o.shop_id)?.design_type ?? "",
                    Products: productNames(o),
                    ...Object.fromEntries(products.map((p) => [p.short_name, qtyFor(o, p.id)])),
                    "Total qty": o.total_qty,
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Button
              variant="outline"
              disabled={selectedCount === 0 || generateAllBills.isPending}
              onClick={() => generateAllBills.mutate()}
            >
              <Send className="size-4" /> Generate all bills
              {selectedCount > 0 ? ` (${selectedCount})` : ""}
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Orders on this date" value={String(orders.length)} />
        <StatCard label="Units to deliver" value={num(totalQty)} tone="accent" />
        <StatCard
          label="Marked delivered"
          value={`${delivered} / ${orders.length}`}
          tone="positive"
        />
      </div>

      <div className="surface-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={orders.length > 0 && selectedCount === orders.length}
                  onCheckedChange={(checked) =>
                    setSelected(checked === true ? new Set(orderIds) : new Set())
                  }
                  aria-label="Select all orders"
                />
              </TableHead>
              <TableHead className="w-14 text-right">S. No.</TableHead>
              <TableHead>Shop name</TableHead>
              <TableHead>Label name</TableHead>
              <TableHead className="text-right">Order no.</TableHead>
              <TableHead>Design Type</TableHead>
              {products.map((p) => (
                <TableHead key={p.id} className="text-right">
                  {p.short_name}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={products.length + 9}
                  className="py-10 text-center text-muted-foreground"
                >
                  Loading delivery sheet…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && orders.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={products.length + 9}
                  className="py-12 text-center text-muted-foreground"
                >
                  No orders scheduled for {dateLabel(date)}.
                </TableCell>
              </TableRow>
            )}
            {orders.map((o, i) => (
              <TableRow key={o.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(o.id)}
                    onCheckedChange={(checked) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked === true) next.add(o.id);
                        else next.delete(o.id);
                        return next;
                      })
                    }
                    aria-label={`Select order ${o.order_no}`}
                  />
                </TableCell>
                <TableCell className="num text-right text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{o.shops?.shop_name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {o.shops?.label_name ?? "—"}
                </TableCell>
                <TableCell className="num text-right">{o.order_no}</TableCell>
                <TableCell className="num">{shopById.get(o.shop_id)?.design_type ?? "—"}</TableCell>
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
                <TableCell>
                  <button
                    type="button"
                    onClick={() => generateBill.mutate([o.id])}
                    disabled={generateBill.isPending}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    aria-label={`Generate bill for order ${o.order_no}`}
                  >
                    <FileText className="size-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
