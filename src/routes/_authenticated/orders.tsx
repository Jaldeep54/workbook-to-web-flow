import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
import { ShopFilter, ShopSelect } from "@/components/filter-bar";
import { ProductQtyGrid } from "@/components/product-qty-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { productsQuery } from "@/lib/queries";
import { nextOrderNo, ordersQuery } from "@/lib/records";
import { currentMonth, monthLabel, monthKey, sumQty, type QtyMap } from "@/lib/domain";
import { dateLabel, num, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Klinzo Operations" },
      { name: "description", content: "Record and review shop orders per product for any month." },
      { property: "og:title", content: "Orders — Klinzo Operations" },
      { property: "og:description", content: "Every shop order, filterable by month and shop." },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [shopFilter, setShopFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [shopId, setShopId] = useState("");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [qty, setQty] = useState<QtyMap>({});
  const [notes, setNotes] = useState("");

  const { data: products = [] } = useQuery(productsQuery);
  const { data: orders = [], isLoading } = useQuery(ordersQuery(month, shopFilter));

  const create = useMutation({
    mutationFn: async () => {
      if (!shopId) throw new Error("Choose a shop");
      const orderNo = await nextOrderNo("orders", shopId);
      const total = sumQty(qty);
      const { data, error } = await supabase
        .from("orders")
        .insert({ shop_id: shopId, order_no: orderNo, order_date: orderDate, total_qty: total, notes: notes || null })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const lines = products
        .filter((p) => (qty[p.id] ?? 0) > 0)
        .map((p) => ({ order_id: (data as { id: string }).id, product_id: p.id, qty: qty[p.id] }));
      if (lines.length) {
        const { error: lineError } = await supabase.from("order_lines").insert(lines);
        if (lineError) throw new Error(lineError.message);
      }
    },
    onSuccess: () => {
      toast.success("Order recorded");
      setOpen(false);
      setQty({});
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["orders"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
      void qc.invalidateQueries({ queryKey: ["label_stock"] });
      void qc.invalidateQueries({ queryKey: ["label_stock_summary"] });
      void qc.invalidateQueries({ queryKey: ["available_months"] });
      if (orderDate) setMonth(monthKey(orderDate));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const qtyFor = (order: (typeof orders)[number], productId: string) =>
    order.order_lines.find((l) => l.product_id === productId)?.qty ?? 0;

  return (
    <>
      <PageHeader
        title="Orders"
        description={`${orders.length} orders in ${monthLabel(month)}`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <ShopFilter value={shopFilter} onChange={setShopFilter} />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `klinzo-orders-${month}`,
                  orders.map((o) => ({
                    Date: o.order_date ?? "",
                    Shop: o.shops?.shop_name ?? "",
                    "Order no": o.order_no,
                    ...Object.fromEntries(products.map((p) => [p.short_name, qtyFor(o, p.id)])),
                    Total: o.total_qty,
                    Notes: o.notes ?? "",
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> New order
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>New order</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Shop</Label>
                    <ShopSelect value={shopId} onChange={setShopId} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Order date</Label>
                    <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                  </div>
                </div>
                <div className="mt-2">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Quantities</p>
                  <ProductQtyGrid products={products} value={qty} onChange={setQty} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notes</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <p className="num text-sm text-muted-foreground">Total quantity: {num(sumQty(qty))}</p>
                <DialogFooter>
                  <Button onClick={() => create.mutate()} disabled={!shopId || create.isPending}>
                    Save order
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="surface-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead className="text-right">No.</TableHead>
              {products.map((p) => (
                <TableHead key={p.id} className="text-right">
                  {p.short_name}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={products.length + 4} className="py-10 text-center text-muted-foreground">
                  Loading orders…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={products.length + 4} className="py-12 text-center text-muted-foreground">
                  No orders in {monthLabel(month)}.
                </TableCell>
              </TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{dateLabel(o.order_date)}</TableCell>
                <TableCell className="font-medium">{o.shops?.shop_name ?? "—"}</TableCell>
                <TableCell className="num text-right">{o.order_no}</TableCell>
                {products.map((p) => (
                  <TableCell key={p.id} className="num text-right">
                    {qtyFor(o, p.id) || "—"}
                  </TableCell>
                ))}
                <TableCell className="num text-right font-semibold">{num(o.total_qty)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}