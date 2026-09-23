import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { FinancialYearPicker } from "@/components/financial-year-picker";
import { MonthPicker } from "@/components/month-picker";
import { ShopAreaFilter, ShopFilter } from "@/components/filter-bar";
import { HighlightedDatePicker } from "@/components/highlighted-date-picker";
import { LabelOrderDialog } from "@/components/label-order-dialog";
import { LabelOrderSuggestionTab } from "@/components/label-order-suggestion";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { labelOrdersApi } from "@/services/klinzo.service";
import { labelProductsQuery, labelStockQuery, shopAreasQuery, shopsQuery } from "@/lib/queries";
import { labelOrdersQuery, type LabelOrderRecord } from "@/lib/records";
import { currentFinancialYear, currentMonth, monthKey, monthLabel } from "@/lib/domain";
import type { Shop } from "@/lib/domain";
import { dateLabel, num } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/labels")({
  component: () => (
    <RequirePermission resource={RESOURCES.labelStock}>
      <LabelsPage />
    </RequirePermission>
  ),
});

function LabelsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState("stock");
  return (
    <>
      <PageHeader
        title="Labels & stock"
        description="Stock = labels printed − labels used by orders, exactly as the workbook calculated it"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="stock">Stock dashboard</TabsTrigger>
          <TabsTrigger value="orders">Label orders</TabsTrigger>
          <TabsTrigger value="suggestion">Label Order Suggestion</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="pt-4">
          <StockDashboard
            onOrderSaved={(orderDate) => {
              setMonth(monthKey(orderDate));
            }}
          />
        </TabsContent>
        <TabsContent value="orders" className="pt-4">
          <LabelOrders month={month} setMonth={setMonth} />
        </TabsContent>
        <TabsContent value="suggestion" className="pt-4">
          <LabelOrderSuggestionTab
            onOrdersPlaced={(placedMonth) => {
              setMonth(placedMonth);
              setTab("orders");
            }}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StockDashboard({ onOrderSaved }: { onOrderSaved: (orderDate: string) => void }) {
  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: rows = [], isLoading } = useQuery(labelStockQuery);
  const [onlyLow, setOnlyLow] = useState(true);
  const [search, setSearch] = useState("");
  /** The shop whose row "Add order" was clicked on — opens the order form. */
  const [orderShopId, setOrderShopId] = useState<string | null>(null);

  // A shop only "needs labels" when an ACTIVE product (one in shop_products) is low — a leftover
  // balance on a product the shop no longer sells never counts, and is always shown as NA.
  const byShop = useMemo(() => {
    const map = new Map<
      string,
      {
        shopName: string;
        designType: number;
        stock: Record<string, { value: number; active: boolean }>;
        low: number;
      }
    >();
    for (const row of rows) {
      const entry = map.get(row.shop_id) ?? {
        shopName: row.shop_name,
        designType: row.design_type,
        stock: {},
        low: 0,
      };
      entry.stock[row.label_product_id] = {
        value: Number(row.stock),
        active: row.shop_sells_product,
      };
      if (row.shop_sells_product && row.is_low) entry.low += 1;
      map.set(row.shop_id, entry);
    }
    return Array.from(map.entries()).map(([shopId, v]) => ({ shopId, ...v }));
  }, [rows]);

  const filtered = byShop
    .filter((s) => (onlyLow ? s.low > 0 : true))
    .filter((s) => s.shopName.toLowerCase().includes(search.trim().toLowerCase()));

  // The cards above and the CSV export read `filtered`, so both keep covering
  // every shop the filters leave rather than the page on screen.
  const pagination = usePagination(filtered, { resetKey: `${onlyLow}-${search}` });

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Shops tracked" value={String(byShop.length)} />
        <StatCard
          label="Shops needing labels"
          value={String(byShop.filter((s) => s.low > 0).length)}
          tone="negative"
          icon={AlertTriangle}
        />
        <StatCard
          label="Label types"
          value={String(labelProducts.length)}
          sub="Includes LL 700 front and back"
        />
      </div>

      <div className="surface-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <Input
            placeholder="Search shop…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="only-low" checked={onlyLow} onCheckedChange={setOnlyLow} />
              <Label htmlFor="only-low" className="text-xs">
                Only low stock
              </Label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  "klinzo-label-stock",
                  filtered.map((s) => ({
                    Shop: s.shopName,
                    Design: s.designType,
                    ...Object.fromEntries(
                      labelProducts.map((lp) => [
                        lp.short_name,
                        s.stock[lp.id]?.active ? s.stock[lp.id].value : "NA",
                      ]),
                    ),
                    "Low types": s.low,
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shop</TableHead>
                <TableHead className="text-right">Design</TableHead>
                {labelProducts.map((lp) => (
                  <TableHead key={lp.id} className="text-right">
                    {lp.short_name}
                  </TableHead>
                ))}
                <TableHead className="w-28 text-right">Order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={labelProducts.length + 3}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Calculating stock…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={labelProducts.length + 3}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Nothing to reorder right now.
                  </TableCell>
                </TableRow>
              )}
              {pagination.pageRows.map((s) => (
                <TableRow key={s.shopId}>
                  <TableCell className="font-medium">{s.shopName}</TableCell>
                  <TableCell className="num text-right">{s.designType}</TableCell>
                  {labelProducts.map((lp) => {
                    const cell = s.stock[lp.id];
                    if (!cell?.active) {
                      return (
                        <TableCell key={lp.id} className="num text-right text-muted-foreground">
                          NA
                        </TableCell>
                      );
                    }
                    const low = cell.value < lp.low_stock_threshold;
                    return (
                      <TableCell
                        key={lp.id}
                        className={cn("num text-right", low && "font-semibold text-destructive")}
                      >
                        {num(cell.value)}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right">
                    <Can resource={RESOURCES.labelOrders} action="create">
                      <Button
                        size="sm"
                        variant={s.low > 0 ? "default" : "outline"}
                        onClick={() => setOrderShopId(s.shopId)}
                        aria-label={`Add a label order for ${s.shopName}`}
                      >
                        <Plus className="size-3.5" /> Add order
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DataPagination pagination={pagination} noun="shops" />
      </div>

      <LabelOrderDialog
        open={!!orderShopId}
        onOpenChange={(o) => !o && setOrderShopId(null)}
        presetShopId={orderShopId}
        onSaved={onOrderSaved}
      />
    </>
  );
}

function LabelOrders({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const qc = useQueryClient();
  const [fy, setFy] = useState(currentFinancialYear());
  const [shopFilter, setShopFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<LabelOrderRecord | null>(null);

  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: monthOrders = [], isLoading } = useQuery(labelOrdersQuery(month, shopFilter));
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: areas = [] } = useQuery(shopAreasQuery);

  const shopById = useMemo(() => new Map(shops.map((s) => [s.id, s])), [shops]);
  const areaName = (areaId: string | null | undefined) =>
    (areaId && areas.find((a) => a.id === areaId)?.name) || "Not Assigned";
  const shopDisplay = (shop: Shop | undefined) => {
    if (!shop) return { primary: "—", secondary: null as string | null };
    const primary = shop.folder_name || shop.label_name || shop.shop_name;
    const secondary =
      shop.folder_name && shop.label_name && shop.label_name !== shop.folder_name
        ? shop.label_name
        : null;
    return { primary, secondary };
  };

  // "Date" mode narrows the month's results to a single day; the area filter
  // narrows by the order's shop's area — both client-side, no new query.
  const orders = monthOrders
    .filter((o) => !dateFilter || o.order_date === dateFilter)
    .filter((o) => areaFilter === "all" || shopById.get(o.shop_id)?.area_id === areaFilter);

  const pagination = usePagination(orders, {
    resetKey: `${month}-${shopFilter}-${areaFilter}-${dateFilter}`,
  });

  // Per-product sheet totals across every order currently shown (respecting
  // whatever month/date/shop filter is active) — not the "new order" draft.
  const sheetTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of orders.flatMap((o) => o.label_order_lines)) {
      map.set(line.label_product_id, (map.get(line.label_product_id) ?? 0) + Number(line.sheets));
    }
    return map;
  }, [orders]);

  const deleteOrder = useMutation({
    mutationFn: async (order: LabelOrderRecord) => {
      // The order's line items are embedded in the same document, so deleting
      // it removes exactly this order and nothing else. Product orders are a
      // separate collection and are never touched here.
      await labelOrdersApi.remove(order.id);
      return order;
    },
    onSuccess: (order) => {
      toast.success(`Label Order #${order.order_no} deleted successfully.`);
      setOrderToDelete(null);
      void qc.invalidateQueries({ queryKey: ["label_orders"] });
      void qc.invalidateQueries({ queryKey: ["label_stock"] });
      void qc.invalidateQueries({ queryKey: ["label_stock_summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
      void qc.invalidateQueries({ queryKey: ["available_months"] });
      void qc.invalidateQueries({ queryKey: ["label_order_suggestions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Days in the month that have a label order, marked with a dot in the calendar.
  const orderDatesThisMonth = useMemo(
    () => Array.from(new Set(monthOrders.map((o) => o.order_date).filter((d): d is string => !!d))),
    [monthOrders],
  );

  const sheetsFor = (order: (typeof orders)[number], labelProductId: string) =>
    order.label_order_lines.find((l) => l.label_product_id === labelProductId)?.sheets ?? 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <FinancialYearPicker
          value={fy}
          onChange={(newFy, suggestedMonth) => {
            setFy(newFy);
            setMonth(suggestedMonth);
            setDateFilter("");
          }}
          dates={monthOrders.map((o) => o.order_date)}
        />
        <MonthPicker
          value={month}
          onChange={(m) => {
            setMonth(m);
            // A day from the old month would filter the new one down to nothing.
            setDateFilter("");
          }}
          financialYear={fy}
        />
        {/* The same calendar as Orders and the Delivery Sheet: it opens on the
            selected month and dots the days that have label orders. */}
        <HighlightedDatePicker
          value={dateFilter || null}
          onChange={(d) => setDateFilter(d ?? "")}
          month={month}
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
              `klinzo-label-orders-${dateFilter || month}`,
              orders.map((o) => ({
                Date: o.order_date ?? "",
                "Folder name": shopById.get(o.shop_id)?.folder_name ?? "",
                "Label name": shopById.get(o.shop_id)?.label_name ?? "",
                "Shop Area": areaName(shopById.get(o.shop_id)?.area_id),
                "Order no": o.order_no,
                ...Object.fromEntries(
                  labelProducts.map((lp) => [`${lp.short_name} sheets`, sheetsFor(o, lp.id)]),
                ),
                "Total labels": o.total_labels,
              })),
            )
          }
        >
          <Download className="size-4" /> Export
        </Button>
        <Can resource={RESOURCES.labelOrders} action="create">
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New label order
          </Button>
        </Can>
        <LabelOrderDialog
          open={open}
          onOpenChange={setOpen}
          onSaved={(orderDate) => setMonth(monthKey(orderDate))}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {labelProducts.map((lp) => (
          <StatCard
            key={lp.id}
            label={`${lp.short_name} sheets`}
            value={num(sheetTotals.get(lp.id) ?? 0)}
            sub={dateFilter ? dateLabel(dateFilter) : monthLabel(month)}
          />
        ))}
      </div>

      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Shop Area</TableHead>
                <TableHead className="text-right">No.</TableHead>
                {labelProducts.map((lp) => (
                  <TableHead key={lp.id} className="text-right">
                    {lp.short_name}
                  </TableHead>
                ))}
                <TableHead className="text-right">Labels</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={labelProducts.length + 6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Loading label orders…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && orders.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={labelProducts.length + 6}
                    className="py-12 text-center text-muted-foreground"
                  >
                    No label orders{" "}
                    {dateFilter ? `on ${dateLabel(dateFilter)}` : `in ${monthLabel(month)}`}.
                  </TableCell>
                </TableRow>
              )}
              {pagination.pageRows.map((o) => {
                const shop = shopById.get(o.shop_id);
                const { primary, secondary } = shopDisplay(shop);
                return (
                  <TableRow key={o.id}>
                    <TableCell>{dateLabel(o.order_date)}</TableCell>
                    <TableCell className="font-medium">
                      {primary}
                      {secondary && <p className="text-xs text-muted-foreground">{secondary}</p>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {areaName(shop?.area_id)}
                    </TableCell>
                    <TableCell className="num text-right">{o.order_no}</TableCell>
                    {labelProducts.map((lp) => (
                      <TableCell key={lp.id} className="num text-right">
                        {sheetsFor(o, lp.id) || "—"}
                      </TableCell>
                    ))}
                    <TableCell className="num text-right font-semibold">
                      {num(o.total_labels)}
                    </TableCell>
                    <TableCell>
                      <Can resource={RESOURCES.labelOrders} action="delete">
                        <button
                          type="button"
                          onClick={() => setOrderToDelete(o)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Delete order ${o.order_no}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </Can>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <DataPagination pagination={pagination} noun="label orders" />
      </div>

      <AlertDialog open={!!orderToDelete} onOpenChange={(open) => !open && setOrderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Label Order?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2 text-sm text-foreground">
                <p>Are you sure you want to delete this order? This will permanently remove it.</p>
                {orderToDelete && (
                  <div className="num space-y-1 rounded-lg bg-secondary p-3">
                    <DetailRow
                      label="Shop"
                      value={shopDisplay(shopById.get(orderToDelete.shop_id)).primary}
                    />
                    <DetailRow label="Order no" value={`#${orderToDelete.order_no}`} />
                    <DetailRow label="Order date" value={dateLabel(orderToDelete.order_date)} />
                    <div className="border-t border-border pt-1">
                      {labelProducts.map((lp) => {
                        const qty = sheetsFor(orderToDelete, lp.id);
                        if (!qty) return null;
                        return (
                          <DetailRow
                            key={lp.id}
                            label={lp.short_name}
                            value={`${num(qty)} sheets`}
                          />
                        );
                      })}
                    </div>
                    <div className="border-t border-border pt-1">
                      <DetailRow label="Total labels" value={num(orderToDelete.total_labels)} />
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (orderToDelete) deleteOrder.mutate(orderToDelete);
              }}
              disabled={deleteOrder.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
