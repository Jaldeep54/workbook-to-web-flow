import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarIcon, Download, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
import { ShopAreaFilter, ShopFilter, ShopSelect } from "@/components/filter-bar";
import { ProductQtyGrid } from "@/components/product-qty-grid";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { productsQuery, shopAreasQuery, shopProductsQuery, shopsQuery } from "@/lib/queries";
import { nextOrderNo, ordersQuery, type OrderRecord } from "@/lib/records";
import { currentMonth, monthLabel, monthKey, sumQty, type QtyMap } from "@/lib/domain";
import { dateLabel, num, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { cn } from "@/lib/utils";

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
  const [areaFilter, setAreaFilter] = useState("all");
  const [exactDate, setExactDate] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OrderRecord | null>(null);
  const [deleting, setDeleting] = useState<OrderRecord | null>(null);
  const [shopId, setShopId] = useState("");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [qty, setQty] = useState<QtyMap>({});
  const [notes, setNotes] = useState("");

  const { data: products = [] } = useQuery(productsQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: areas = [] } = useQuery(shopAreasQuery);
  const { data: shopProducts = [] } = useQuery(shopProductsQuery);
  const { data: orders = [], isLoading } = useQuery(ordersQuery(month, shopFilter));

  const selectedShopAreaName = useMemo(() => {
    const shop = shops.find((s) => s.id === shopId);
    if (!shop?.area_id) return null;
    return areas.find((a) => a.id === shop.area_id)?.name ?? null;
  }, [shops, areas, shopId]);

  // Which products the selected shop works with (existing order lines stay visible even if the
  // shop's product list has since changed, so editing an old order never silently drops data).
  const shopProductIds = useMemo(
    () => new Set(shopProducts.filter((sp) => sp.shop_id === shopId).map((sp) => sp.product_id)),
    [shopProducts, shopId],
  );
  const availableProducts = useMemo(
    () => products.filter((p) => shopProductIds.has(p.id) || (qty[p.id] ?? 0) > 0),
    [products, shopProductIds, qty],
  );

  // Area + exact-date narrow the already month-scoped order list — never a lifetime total.
  const shopIdsInArea = useMemo(() => {
    if (areaFilter === "all") return null;
    return new Set(shops.filter((s) => s.area_id === areaFilter).map((s) => s.id));
  }, [shops, areaFilter]);

  const filteredOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (!shopIdsInArea || shopIdsInArea.has(o.shop_id)) &&
          (!exactDate || o.order_date === exactDate),
      ),
    [orders, shopIdsInArea, exactDate],
  );

  const productTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const o of filteredOrders) {
      for (const line of o.order_lines) {
        totals.set(line.product_id, (totals.get(line.product_id) ?? 0) + Number(line.qty));
      }
    }
    return products.map((p) => ({
      product_id: p.id,
      short_name: p.short_name,
      total_qty: totals.get(p.id) ?? 0,
    }));
  }, [filteredOrders, products]);

  const refresh = () => {
    for (const key of [
      "orders",
      "delivery_sheet",
      "dashboard_summary",
      "label_stock",
      "label_stock_summary",
      "available_months",
      "order_qty_by_product",
      "pending_orders",
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const resetForm = () => {
    setEditing(null);
    setShopId("");
    setOrderDate(todayISO());
    setDeliveryDate(todayISO());
    setQty({});
    setNotes("");
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (order: OrderRecord) => {
    setEditing(order);
    setShopId(order.shop_id);
    setOrderDate(order.order_date ?? todayISO());
    setDeliveryDate(order.delivery_date ?? order.order_date ?? todayISO());
    setNotes(order.notes ?? "");
    const next: QtyMap = {};
    order.order_lines.forEach((l) => {
      next[l.product_id] = Number(l.qty);
    });
    setQty(next);
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!shopId) throw new Error("Choose a shop");
      if (!orderDate) throw new Error("Order date is required");
      if (!deliveryDate) throw new Error("Delivery date is required");
      if (new Date(deliveryDate) < new Date(orderDate)) {
        throw new Error("Delivery date cannot be before the order date");
      }
      const total = sumQty(qty);
      if (total <= 0) throw new Error("Enter at least one product quantity");
      if (Object.values(qty).some((v) => Number(v) < 0))
        throw new Error("Quantities cannot be negative");

      let orderId = editing?.id;
      if (editing) {
        const { error } = await supabase
          .from("orders")
          .update({
            shop_id: shopId,
            order_date: orderDate,
            delivery_date: deliveryDate,
            total_qty: total,
            notes: notes || null,
          })
          .eq("id", editing.id);
        if (error) throw new Error(error.message);
        const { error: delError } = await supabase
          .from("order_lines")
          .delete()
          .eq("order_id", editing.id);
        if (delError) throw new Error(delError.message);
      } else {
        const orderNo = await nextOrderNo("orders", shopId);
        const { data, error } = await supabase
          .from("orders")
          .insert({
            shop_id: shopId,
            order_no: orderNo,
            order_date: orderDate,
            delivery_date: deliveryDate,
            total_qty: total,
            notes: notes || null,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        orderId = (data as { id: string }).id;
      }

      const lines = products
        .filter((p) => (qty[p.id] ?? 0) > 0)
        .map((p) => ({ order_id: orderId as string, product_id: p.id, qty: qty[p.id] }));
      if (lines.length) {
        const { error: lineError } = await supabase.from("order_lines").insert(lines);
        if (lineError) throw new Error(lineError.message);
      }

      // A delivered order keeps its delivery and payment in sync with the edit.
      if (editing?.status === "Delivered") {
        const { error: syncError } = await supabase.rpc(
          "set_order_delivered" as never,
          {
            p_order_id: orderId,
            p_delivery_date: deliveryDate,
          } as never,
        );
        if (syncError) throw new Error(syncError.message);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Order updated" : "Order recorded");
      setOpen(false);
      const applied = orderDate;
      resetForm();
      refresh();
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
      if (applied) setMonth(monthKey(applied));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (order: OrderRecord) => {
      const { error } = await supabase.from("orders").delete().eq("id", order.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Order deleted");
      setDeleting(null);
      refresh();
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const qtyFor = (order: OrderRecord, productId: string) =>
    order.order_lines.find((l) => l.product_id === productId)?.qty ?? 0;

  const grandTotal = useMemo(
    () => productTotals.reduce((a, r) => a + Number(r.total_qty), 0),
    [productTotals],
  );

  return (
    <>
      <PageHeader
        title="Orders"
        description={`${filteredOrders.length} orders in ${monthLabel(month)}${exactDate ? ` on ${dateLabel(exactDate)}` : ""}`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("justify-start bg-card font-normal")}>
                  <CalendarIcon className="size-4" />
                  {exactDate ? dateLabel(exactDate) : "Any date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={exactDate ? new Date(`${exactDate}T00:00:00`) : undefined}
                  onSelect={(d) => {
                    if (!d) return;
                    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
                    setExactDate(local.toISOString().slice(0, 10));
                  }}
                  initialFocus
                  className={cn("pointer-events-auto p-3")}
                />
                {exactDate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="m-2 mt-0 w-[calc(100%-1rem)]"
                    onClick={() => setExactDate(null)}
                  >
                    <X className="size-3.5" /> Clear date
                  </Button>
                )}
              </PopoverContent>
            </Popover>
            <ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />
            <ShopFilter value={shopFilter} onChange={setShopFilter} />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `klinzo-orders-${month}`,
                  filteredOrders.map((o) => ({
                    "Order date": o.order_date ?? "",
                    "Delivery date": o.delivery_date ?? "",
                    Shop: o.shops?.shop_name ?? "",
                    "Label name": o.shops?.label_name ?? "",
                    "Order no": o.order_no,
                    Status: o.status ?? "",
                    ...Object.fromEntries(products.map((p) => [p.short_name, qtyFor(o, p.id)])),
                    Total: o.total_qty,
                    Notes: o.notes ?? "",
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" /> New order
            </Button>
          </>
        }
      />

      <div className="mb-6">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-base font-semibold">Ordered quantity by product</h2>
            <p className="text-xs text-muted-foreground">
              Totals for the orders currently shown above — respects the month, date and area
              filters.
            </p>
          </div>
          <p className="num text-sm text-muted-foreground">{num(grandTotal)} units in total</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {productTotals.map((row) => (
            <StatCard
              key={row.product_id}
              label={row.short_name}
              value={`${num(row.total_qty)} units`}
            />
          ))}
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit order #${editing.order_no}` : "New order"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <Label className="text-xs">Shop</Label>
              <ShopSelect value={shopId} onChange={setShopId} />
              {shopId && (
                <p className="text-xs text-muted-foreground">
                  Area: {selectedShopAreaName ?? "Not Assigned"}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Order date</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery date</Label>
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Quantities
            </p>
            {!shopId && (
              <p className="text-sm text-muted-foreground">Select a shop to see its products.</p>
            )}
            {shopId && availableProducts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This shop has no products configured yet — add products to it from the Shops page.
              </p>
            )}
            {shopId && availableProducts.length > 0 && (
              <ProductQtyGrid products={availableProducts} value={qty} onChange={setQty} />
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
          <p className="num text-sm text-muted-foreground">Total quantity: {num(sumQty(qty))}</p>
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={!shopId || save.isPending}>
              {editing ? "Save changes" : "Save order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete order #{deleting?.order_no}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the order, its quantities and any delivery or payment generated from it.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting)}>
              Delete order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="surface-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order date</TableHead>
              <TableHead>Delivery date</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead className="text-right">No.</TableHead>
              {products.map((p) => (
                <TableHead key={p.id} className="text-right">
                  {p.short_name}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={products.length + 7}
                  className="py-10 text-center text-muted-foreground"
                >
                  Loading orders…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filteredOrders.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={products.length + 7}
                  className="py-12 text-center text-muted-foreground"
                >
                  No orders match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filteredOrders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{dateLabel(o.order_date)}</TableCell>
                <TableCell>{dateLabel(o.delivery_date)}</TableCell>
                <TableCell className="font-medium">
                  {o.shops?.shop_name ?? "—"}
                  {o.shops?.label_name && (
                    <p className="text-xs text-muted-foreground">{o.shops.label_name}</p>
                  )}
                </TableCell>
                <TableCell className="num text-right">{o.order_no}</TableCell>
                {products.map((p) => (
                  <TableCell key={p.id} className="num text-right">
                    {qtyFor(o, p.id) || "—"}
                  </TableCell>
                ))}
                <TableCell className="num text-right font-semibold">{num(o.total_qty)}</TableCell>
                <TableCell>
                  <Badge variant={o.status === "Delivered" ? "default" : "secondary"}>
                    {o.status ?? "Pending"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(o)}
                      aria-label="Edit order"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleting(o)}
                      aria-label="Delete order"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
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
