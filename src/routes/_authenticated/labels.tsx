import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
import { ShopFilter, ShopSelect } from "@/components/filter-bar";
import { LabelOrderSuggestionTab } from "@/components/label-order-suggestion";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { supabase } from "@/integrations/supabase/client";
import { labelProductsQuery, labelStockQuery } from "@/lib/queries";
import { labelOrdersQuery, nextOrderNo, type LabelOrderRecord } from "@/lib/records";
import { currentMonth, labelsFromSheets, monthKey, monthLabel } from "@/lib/domain";
import { dateLabel, inr, num, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/labels")({
  head: () => ({
    meta: [
      { title: "Labels & stock — Klinzo Operations" },
      {
        name: "description",
        content:
          "Label stock per shop calculated from printed sheets minus ordered quantity, with reorder alerts.",
      },
      { property: "og:title", content: "Labels & stock — Klinzo Operations" },
      { property: "og:description", content: "Label stock and printing orders in one dashboard." },
    ],
  }),
  component: LabelsPage,
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
          <StockDashboard />
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

function StockDashboard() {
  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: rows = [], isLoading } = useQuery(labelStockQuery);
  const [onlyLow, setOnlyLow] = useState(true);
  const [search, setSearch] = useState("");

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

  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={labelProducts.length + 2}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Calculating stock…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={labelProducts.length + 2}
                    className="py-12 text-center text-muted-foreground"
                  >
                    Nothing to reorder right now.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((s) => (
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}

function LabelOrders({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const qc = useQueryClient();
  const [shopFilter, setShopFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [shopId, setShopId] = useState("");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [sheets, setSheets] = useState<Record<string, number>>({});
  const [orderToDelete, setOrderToDelete] = useState<LabelOrderRecord | null>(null);

  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: orders = [], isLoading } = useQuery(labelOrdersQuery(month, shopFilter));

  const totals = labelProducts.reduce(
    (acc, lp) => {
      const s = Number(sheets[lp.id]) || 0;
      acc.sheets += s;
      acc.labels += labelsFromSheets(s, lp.labels_per_sheet);
      acc.cost += s * lp.sheet_cost;
      return acc;
    },
    { sheets: 0, labels: 0, cost: 0 },
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!shopId) throw new Error("Choose a shop");
      const orderNo = await nextOrderNo("label_orders", shopId);
      const { data, error } = await supabase
        .from("label_orders")
        .insert({
          shop_id: shopId,
          order_no: orderNo,
          order_date: orderDate,
          total_labels: totals.labels,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const lines = labelProducts
        .filter((lp) => (sheets[lp.id] ?? 0) > 0)
        .map((lp) => ({
          label_order_id: (data as { id: string }).id,
          label_product_id: lp.id,
          sheets: sheets[lp.id],
          products: labelsFromSheets(sheets[lp.id], lp.labels_per_sheet),
        }));
      if (lines.length) {
        const { error: lineError } = await supabase.from("label_order_lines").insert(lines);
        if (lineError) throw new Error(lineError.message);
      }
    },
    onSuccess: () => {
      toast.success("Label order recorded");
      setOpen(false);
      setSheets({});
      void qc.invalidateQueries({ queryKey: ["label_orders"] });
      void qc.invalidateQueries({ queryKey: ["label_stock"] });
      void qc.invalidateQueries({ queryKey: ["label_stock_summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
      void qc.invalidateQueries({ queryKey: ["available_months"] });
      setMonth(monthKey(orderDate));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteOrder = useMutation({
    mutationFn: async (order: LabelOrderRecord) => {
      // label_order_lines cascades on delete (ON DELETE CASCADE) — deleting the
      // parent row removes its line items too, and only its line items. Product
      // Orders live in a separate table entirely and are never touched here.
      const { error } = await supabase.from("label_orders").delete().eq("id", order.id);
      if (error) throw new Error(error.message);
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

  const sheetsFor = (order: (typeof orders)[number], labelProductId: string) =>
    order.label_order_lines.find((l) => l.label_product_id === labelProductId)?.sheets ?? 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <MonthPicker value={month} onChange={setMonth} />
        <ShopFilter value={shopFilter} onChange={setShopFilter} />
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv(
              `klinzo-label-orders-${month}`,
              orders.map((o) => ({
                Date: o.order_date ?? "",
                Shop: o.shops?.shop_name ?? "",
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New label order
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>New label order</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Shop</Label>
                <ShopSelect value={shopId} onChange={setShopId} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Order date</Label>
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sheets printed
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {labelProducts.map((lp) => (
                  <div key={lp.id} className="space-y-1.5">
                    <Label className="text-xs" htmlFor={`sheet-${lp.id}`}>
                      {lp.short_name}{" "}
                      <span className="text-muted-foreground">×{num(lp.labels_per_sheet)}</span>
                    </Label>
                    <Input
                      id={`sheet-${lp.id}`}
                      type="number"
                      min={0}
                      className="num"
                      value={sheets[lp.id] ?? ""}
                      onChange={(e) =>
                        setSheets({
                          ...sheets,
                          [lp.id]: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="num grid grid-cols-3 gap-2 rounded-lg bg-secondary p-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Sheets</p>
                <p className="font-medium">{num(totals.sheets)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Labels</p>
                <p className="font-medium">{num(totals.labels)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Printing cost</p>
                <p className="font-medium">{inr(totals.cost, 2)}</p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!shopId || create.isPending}>
                Save label order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="surface-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Shop</TableHead>
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
                  colSpan={labelProducts.length + 5}
                  className="py-10 text-center text-muted-foreground"
                >
                  Loading label orders…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && orders.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={labelProducts.length + 5}
                  className="py-12 text-center text-muted-foreground"
                >
                  No label orders in {monthLabel(month)}.
                </TableCell>
              </TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{dateLabel(o.order_date)}</TableCell>
                <TableCell className="font-medium">
                  {o.shops?.shop_name ?? "—"}
                  {o.shops?.label_name && (
                    <p className="text-xs text-muted-foreground">{o.shops.label_name}</p>
                  )}
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
                  <button
                    type="button"
                    onClick={() => setOrderToDelete(o)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete order ${o.order_no}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
                    <DetailRow label="Shop" value={orderToDelete.shops?.shop_name ?? "—"} />
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
