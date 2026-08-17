import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
import { ShopAreaFilter, ShopFilter } from "@/components/filter-bar";
import { ProductQtyGrid } from "@/components/product-qty-grid";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { productsQuery, shopsQuery } from "@/lib/queries";
import { deliveriesQuery } from "@/lib/records";
import {
  DELIVERY_STATUSES,
  computeDeliveryTotals,
  currentMonth,
  monthKey,
  monthLabel,
  type QtyMap,
} from "@/lib/domain";
import { dateLabel, inr, num, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/deliveries")({
  head: () => ({
    meta: [
      { title: "Deliveries — Klinzo Operations" },
      {
        name: "description",
        content:
          "Deliveries with sales, labelling, jar & can, production cost and profit calculated automatically.",
      },
      { property: "og:title", content: "Deliveries — Klinzo Operations" },
      {
        property: "og:description",
        content: "Delivery sheet with live profit and cost calculations.",
      },
    ],
  }),
  component: DeliveriesPage,
});

type PendingOrder = {
  id: string;
  shop_id: string;
  order_no: number;
  order_date: string | null;
  shops: { shop_name: string } | null;
  order_lines: Array<{ product_id: string; qty: number }>;
  deliveries: Array<{ id: string }>;
};

function DeliveriesPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [shopFilter, setShopFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [status, setStatus] = useState<string>("Delivered");
  const [qty, setQty] = useState<QtyMap>({});

  const { data: products = [] } = useQuery(productsQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: allDeliveries = [], isLoading } = useQuery(deliveriesQuery(month, shopFilter));

  const deliveries = useMemo(() => {
    if (areaFilter === "all") return allDeliveries;
    const shopIdsInArea = new Set(shops.filter((s) => s.area_id === areaFilter).map((s) => s.id));
    return allDeliveries.filter((d) => shopIdsInArea.has(d.shop_id));
  }, [allDeliveries, shops, areaFilter]);

  const pending = useQuery({
    queryKey: ["pending_orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, shop_id, order_no, order_date, shops(shop_name), order_lines(product_id, qty), deliveries(id)",
        )
        .order("order_date", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as PendingOrder[]).filter(
        (o) => (o.deliveries ?? []).length === 0,
      );
    },
  });

  const selectedOrder = pending.data?.find((o) => o.id === orderId);
  const totals = useMemo(() => computeDeliveryTotals(qty, products), [qty, products]);

  const pickOrder = (id: string) => {
    setOrderId(id);
    const order = pending.data?.find((o) => o.id === id);
    const next: QtyMap = {};
    order?.order_lines.forEach((l) => {
      next[l.product_id] = Number(l.qty);
    });
    setQty(next);
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Choose an order");
      const { data, error } = await supabase
        .from("deliveries")
        .insert({
          shop_id: selectedOrder.shop_id,
          order_id: selectedOrder.id,
          delivery_date: deliveryDate,
          status,
          total_qty: totals.totalQty,
          total_sales: totals.totalSales,
          labelling_cost: totals.labellingCost,
          packaging_cost: totals.packagingCost,
          production_cost: totals.productionCost,
          total_fixed_cost: totals.totalFixedCost,
          profit: totals.profit,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const lines = products
        .filter((p) => (qty[p.id] ?? 0) > 0)
        .map((p) => ({
          delivery_id: (data as { id: string }).id,
          product_id: p.id,
          qty: qty[p.id],
        }));
      if (lines.length) {
        const { error: lineError } = await supabase.from("delivery_lines").insert(lines);
        if (lineError) throw new Error(lineError.message);
      }
    },
    onSuccess: () => {
      toast.success("Delivery recorded");
      setOpen(false);
      setOrderId("");
      setQty({});
      void qc.invalidateQueries({ queryKey: ["deliveries"] });
      void qc.invalidateQueries({ queryKey: ["pending_orders"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
      void qc.invalidateQueries({ queryKey: ["available_months"] });
      void qc.invalidateQueries({ queryKey: ["shop_history"] });
      void qc.invalidateQueries({ queryKey: ["shop_analysis"] });
      setMonth(monthKey(deliveryDate));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalSales = deliveries.reduce((a, d) => a + Number(d.total_sales), 0);
  const totalProfit = deliveries.reduce((a, d) => a + Number(d.profit), 0);
  const totalCost = deliveries.reduce((a, d) => a + Number(d.total_fixed_cost), 0);

  return (
    <>
      <PageHeader
        title="Deliveries"
        description={`${deliveries.length} deliveries in ${monthLabel(month)} — prices frozen at delivery time`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />
            <ShopFilter value={shopFilter} onChange={setShopFilter} />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `klinzo-deliveries-${month}`,
                  deliveries.map((d) => ({
                    Date: d.delivery_date ?? "",
                    Shop: d.shops?.shop_name ?? "",
                    "Order no": d.orders?.order_no ?? "",
                    Status: d.status ?? "",
                    Quantity: d.total_qty,
                    Sales: d.total_sales,
                    "Labelling cost": d.labelling_cost,
                    "Jar & can cost": d.packaging_cost,
                    "Production cost": d.production_cost,
                    "Total fixed cost": d.total_fixed_cost,
                    Profit: d.profit,
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> New delivery
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Record delivery</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-3">
                    <Label className="text-xs">Order</Label>
                    <Select value={orderId} onValueChange={pickOrder}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an undelivered order" />
                      </SelectTrigger>
                      <SelectContent>
                        {(pending.data ?? []).map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.shops?.shop_name} · #{o.order_no} · {dateLabel(o.order_date)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Delivery date</Label>
                    <Input
                      type="date"
                      value={deliveryDate}
                      onChange={(e) => setDeliveryDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DELIVERY_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Delivered quantities
                  </p>
                  <ProductQtyGrid products={products} value={qty} onChange={setQty} />
                </div>
                <div className="num grid grid-cols-2 gap-2 rounded-lg bg-secondary p-4 text-sm sm:grid-cols-3">
                  <Figure label="Sales" value={inr(totals.totalSales, 2)} />
                  <Figure label="Labelling" value={inr(totals.labellingCost, 2)} />
                  <Figure label="Jar & can" value={inr(totals.packagingCost, 2)} />
                  <Figure label="Production" value={inr(totals.productionCost, 2)} />
                  <Figure label="Fixed cost" value={inr(totals.totalFixedCost, 2)} />
                  <Figure label="Profit" value={inr(totals.profit, 2)} />
                </div>
                <DialogFooter>
                  <Button onClick={() => create.mutate()} disabled={!orderId || create.isPending}>
                    Save delivery
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Sales this month" value={inr(totalSales)} tone="accent" />
        <StatCard label="Fixed cost" value={inr(totalCost)} />
        <StatCard
          label="Profit"
          value={inr(totalProfit)}
          tone={totalProfit >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="surface-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Labelling</TableHead>
              <TableHead className="text-right">Jar & can</TableHead>
              <TableHead className="text-right">Production</TableHead>
              <TableHead className="text-right">Profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  Loading deliveries…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && deliveries.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                  No deliveries in {monthLabel(month)}.
                </TableCell>
              </TableRow>
            )}
            {deliveries.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{dateLabel(d.delivery_date)}</TableCell>
                <TableCell className="font-medium">{d.shops?.shop_name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={d.status === "Delivered" ? "default" : "secondary"}>
                    {d.status ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell className="num text-right">{num(d.total_qty)}</TableCell>
                <TableCell className="num text-right">{inr(d.total_sales)}</TableCell>
                <TableCell className="num text-right">{inr(d.labelling_cost)}</TableCell>
                <TableCell className="num text-right">{inr(d.packaging_cost)}</TableCell>
                <TableCell className="num text-right">{inr(d.production_cost)}</TableCell>
                <TableCell
                  className={`num text-right font-semibold ${Number(d.profit) >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {inr(d.profit)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
