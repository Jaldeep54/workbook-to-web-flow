import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Send } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { FinancialYearPicker } from "@/components/financial-year-picker";
import { HighlightedDatePicker } from "@/components/highlighted-date-picker";
import { MonthPicker } from "@/components/month-picker";
import { ShopAreaFilter } from "@/components/filter-bar";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { RequirePermission } from "@/components/require-permission";
import { Can, RESOURCES, usePermissions } from "@/hooks/usePermissions";
import { ordersApi } from "@/services/klinzo.service";
import { productsQuery, shopsQuery } from "@/lib/queries";
import { deliverySheetQuery, deliveryDueDatesQuery } from "@/lib/records";
import { downloadBills } from "@/lib/generate-bill";
import {
  ORDER_STATUSES,
  currentFinancialYear,
  currentMonth,
  defaultMonthForFinancialYear,
  monthKey,
} from "@/lib/domain";
import { dateLabel, num, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/delivery-sheet")({
  component: () => (
    <RequirePermission resource={RESOURCES.orders}>
      <DeliverySheetPage />
    </RequirePermission>
  ),
});

function DeliverySheetPage() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  // Changing a status cascades into deliveries and payments, so it needs
  // orders:manage rather than plain update.
  const canSetStatus = can(RESOURCES.orders, "manage");
  const canGenerateBills = can(RESOURCES.bills, "create");
  const [date, setDate] = useState(todayISO());
  const [fy, setFy] = useState(currentFinancialYear());
  const [month, setMonth] = useState(currentMonth());
  const [areaFilter, setAreaFilter] = useState("all");
  const { data: products = [] } = useQuery(productsQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: allOrders = [], isLoading } = useQuery(deliverySheetQuery(date));

  // Every delivery-due date in the selected FY, purely to light up the
  // calendar — the delivery sheet itself is still scoped to one exact `date`.
  const { data: dueDates = [] } = useQuery(deliveryDueDatesQuery(fy));

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

  // Bill data (invoice number, prices, shop details) comes from the API; the
  // PDF itself is rendered here in the browser.
  const downloadBillPdf = (ids: string[]) => downloadBills(ids);

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
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      ordersApi.setStatus(orderId, status, date),
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
            <FinancialYearPicker
              value={fy}
              onChange={(newFy) => {
                setFy(newFy);
                const m = defaultMonthForFinancialYear(newFy);
                setMonth(m);
                setDate(m);
              }}
              dates={dueDates}
            />
            <MonthPicker
              value={month}
              onChange={(m) => {
                setMonth(m);
                setDate(m);
              }}
              financialYear={fy}
            />
            <HighlightedDatePicker
              value={date}
              onChange={(d) => {
                if (!d) return;
                setDate(d);
                setMonth(monthKey(d));
              }}
              highlightedDates={dueDates}
              allowClear={false}
              className="w-[200px]"
            />
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
            <Can resource={RESOURCES.bills} action="create">
              <Button
                variant="outline"
                disabled={selectedCount === 0 || generateAllBills.isPending}
                onClick={() => generateAllBills.mutate()}
              >
                <Send className="size-4" /> Generate all bills
                {selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Button>
            </Can>
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
                      disabled={!canSetStatus}
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
                    disabled={generateBill.isPending || !canGenerateBills}
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
