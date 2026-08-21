import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { FinancialYearPicker } from "@/components/financial-year-picker";
import { HighlightedDatePicker } from "@/components/highlighted-date-picker";
import { MonthPicker } from "@/components/month-picker";
import { ShopAreaFilter, ShopFilter } from "@/components/filter-bar";
import { NewOrderDialog } from "@/components/new-order-dialog";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RequirePermission } from "@/components/require-permission";
import { Can, RESOURCES } from "@/hooks/usePermissions";
import { ordersApi } from "@/services/klinzo.service";
import { productsQuery, shopsQuery } from "@/lib/queries";
import { ordersQuery, type OrderRecord } from "@/lib/records";
import {
  currentFinancialYear,
  currentMonth,
  defaultMonthForFinancialYear,
  monthLabel,
  monthKey,
} from "@/lib/domain";
import { dateLabel, num } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/orders")({
  component: () => (
    <RequirePermission resource={RESOURCES.orders}>
      <OrdersPage />
    </RequirePermission>
  ),
});

function OrdersPage() {
  const qc = useQueryClient();
  const [fy, setFy] = useState(currentFinancialYear());
  const [month, setMonth] = useState(currentMonth());
  const [shopFilter, setShopFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [exactDate, setExactDate] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OrderRecord | null>(null);
  const [deleting, setDeleting] = useState<OrderRecord | null>(null);

  const { data: products = [] } = useQuery(productsQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: orders = [], isLoading } = useQuery(ordersQuery(month, shopFilter));

  const orderDatesThisMonth = useMemo(
    () => Array.from(new Set(orders.map((o) => o.order_date).filter((d): d is string => !!d))),
    [orders],
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
      "shop_history",
      "shop_analysis",
    ]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (order: OrderRecord) => {
    setEditing(order);
    setOpen(true);
  };

  const remove = useMutation({
    mutationFn: (order: OrderRecord) => ordersApi.remove(order.id),
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
            <FinancialYearPicker
              value={fy}
              onChange={(newFy) => {
                setFy(newFy);
                setMonth(defaultMonthForFinancialYear(newFy));
              }}
              dates={orders.map((o) => o.order_date)}
            />
            <MonthPicker value={month} onChange={setMonth} financialYear={fy} />
            <HighlightedDatePicker
              value={exactDate}
              onChange={setExactDate}
              highlightedDates={orderDatesThisMonth}
              placeholder="Any date"
            />
            <ShopAreaFilter
              value={areaFilter}
              onChange={(area) => {
                setAreaFilter(area);
                setShopFilter("all");
              }}
            />
            <ShopFilter
              value={shopFilter}
              onChange={setShopFilter}
              areaId={areaFilter !== "all" ? areaFilter : undefined}
            />
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
            <Can resource={RESOURCES.orders} action="create">
              <Button onClick={openCreate}>
                <Plus className="size-4" /> New order
              </Button>
            </Can>
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

      <NewOrderDialog open={open} onOpenChange={setOpen} editing={editing} />

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
                    <Can resource={RESOURCES.orders} action="update">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(o)}
                        aria-label="Edit order"
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </Can>
                    <Can resource={RESOURCES.orders} action="delete">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(o)}
                        aria-label="Delete order"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </Can>
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
