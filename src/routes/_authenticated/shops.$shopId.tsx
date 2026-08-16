import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { NewOrderDialog } from "@/components/new-order-dialog";
import { ShopAnalysisTab } from "@/components/shop-analysis";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  labelProductsQuery,
  labelStockQuery,
  productsQuery,
  shopAreasQuery,
  shopsQuery,
} from "@/lib/queries";
import { dateLabel, inr, num, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/shops/$shopId")({
  head: () => ({
    meta: [
      { title: "Shop detail — Klinzo Operations" },
      {
        name: "description",
        content: "Orders, deliveries, payments, label stock and sales analysis for a single shop.",
      },
      { property: "og:title", content: "Shop detail — Klinzo Operations" },
      { property: "og:description", content: "One shop's full trading history." },
    ],
  }),
  component: ShopDetail,
});

type HistoryOrder = {
  id: string;
  order_no: number;
  order_date: string | null;
  delivery_date: string | null;
  status: string | null;
  total_qty: number;
  notes: string | null;
  order_lines: Array<{ product_id: string; qty: number }>;
};

type HistoryDelivery = {
  id: string;
  order_id: string;
  delivery_date: string | null;
  status: string | null;
  total_qty: number;
  total_sales: number;
  total_fixed_cost: number;
  profit: number;
};

type HistoryPayment = {
  id: string;
  payment_date: string | null;
  status: string | null;
  collected_by: string | null;
  amount: number;
};

/** Every mutation on this page can move the numbers everywhere else in the app. */
const INVALIDATE_KEYS = [
  "shop_history",
  "shop_analysis",
  "orders",
  "deliveries",
  "payments",
  "delivery_sheet",
  "dashboard_summary",
  "label_stock",
  "label_stock_summary",
  "available_months",
  "order_qty_by_product",
  "pending_orders",
  "sku_opportunity",
];

function ShopDetail() {
  const { shopId } = useParams({ from: "/_authenticated/shops/$shopId" });
  const qc = useQueryClient();
  const { data: shops = [] } = useQuery(shopsQuery);
  const shop = shops.find((s) => s.id === shopId);
  const { data: areas = [] } = useQuery(shopAreasQuery);
  const areaName = areas.find((a) => a.id === shop?.area_id)?.name ?? "Not Assigned";
  const { data: products = [] } = useQuery(productsQuery);
  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: stock = [] } = useQuery(labelStockQuery);

  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [deliveringId, setDeliveringId] = useState<HistoryDelivery | null>(null);

  const history = useQuery({
    queryKey: ["shop_history", shopId],
    queryFn: async () => {
      const [orders, deliveries, payments] = await Promise.all([
        supabase
          .from("orders")
          .select("id, order_no, order_date, delivery_date, status, total_qty, notes, order_lines(product_id, qty)")
          .eq("shop_id", shopId)
          .order("order_date", { ascending: false })
          .limit(200),
        supabase
          .from("deliveries")
          .select("id, order_id, delivery_date, status, total_qty, total_sales, total_fixed_cost, profit")
          .eq("shop_id", shopId)
          .order("delivery_date", { ascending: false })
          .limit(200),
        supabase
          .from("payments")
          .select("id, payment_date, status, collected_by, amount")
          .eq("shop_id", shopId)
          .order("payment_date", { ascending: false })
          .limit(200),
      ]);
      if (orders.error) throw new Error(orders.error.message);
      if (deliveries.error) throw new Error(deliveries.error.message);
      if (payments.error) throw new Error(payments.error.message);
      return {
        orders: (orders.data ?? []) as unknown as HistoryOrder[],
        deliveries: (deliveries.data ?? []) as unknown as HistoryDelivery[],
        payments: (payments.data ?? []) as unknown as HistoryPayment[],
      };
    },
  });

  const invalidateAll = () => {
    for (const key of INVALIDATE_KEYS) void qc.invalidateQueries({ queryKey: [key] });
  };

  const markDelivered = useMutation({
    mutationFn: async (delivery: HistoryDelivery) => {
      const { error } = await supabase.rpc(
        "set_order_status" as never,
        {
          p_order_id: delivery.order_id,
          p_status: "Delivered",
          p_delivery_date: delivery.delivery_date ?? todayISO(),
        } as never,
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Marked delivered — sales, cost and payment figures updated");
      setDeliveringId(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markReceived = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase.from("payments").update({ status: "Received" }).eq("id", paymentId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Payment marked received");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sales = (history.data?.deliveries ?? []).reduce((a, d) => a + Number(d.total_sales), 0);
  const received = (history.data?.payments ?? [])
    .filter((p) => p.status === "Received")
    .reduce((a, p) => a + Number(p.amount), 0);
  const profit = (history.data?.deliveries ?? []).reduce((a, d) => a + Number(d.profit), 0);
  const shopStock = stock.filter((r) => r.shop_id === shopId);

  const qtyFor = (order: HistoryOrder, productId: string) =>
    order.order_lines.find((l) => l.product_id === productId)?.qty ?? 0;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/shops">
          <ArrowLeft className="size-4" /> All shops
        </Link>
      </Button>

      <PageHeader
        title={shop?.shop_name ?? "Shop"}
        description={[areaName, shop?.mobile, shop?.address].filter(Boolean).join(" · ")}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Lifetime sales" value={inr(sales)} tone="accent" />
        <StatCard label="Collected" value={inr(received)} tone="positive" />
        <StatCard
          label="Outstanding"
          value={inr(sales - received)}
          tone={sales - received > 0 ? "negative" : "positive"}
        />
        <StatCard label="Profit" value={inr(profit)} tone={profit >= 0 ? "positive" : "negative"} />
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="stock">Label stock</TabsTrigger>
          <TabsTrigger value="analysis">Shop Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Orders</h2>
            <Button size="sm" onClick={() => setNewOrderOpen(true)}>
              <Plus className="size-4" /> New Order
            </Button>
          </div>
          <div className="surface-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order date</TableHead>
                  <TableHead>Delivery date</TableHead>
                  <TableHead className="text-right">Order no</TableHead>
                  {products.map((p) => (
                    <TableHead key={p.id} className="text-right">
                      {p.short_name}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data?.orders ?? []).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{dateLabel(o.order_date)}</TableCell>
                    <TableCell>{dateLabel(o.delivery_date)}</TableCell>
                    <TableCell className="num text-right">{o.order_no}</TableCell>
                    {products.map((p) => (
                      <TableCell key={p.id} className="num text-right">
                        {qtyFor(o, p.id) || "—"}
                      </TableCell>
                    ))}
                    <TableCell className="num text-right font-semibold">{num(o.total_qty)}</TableCell>
                  </TableRow>
                ))}
                {(history.data?.orders ?? []).length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={products.length + 4}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No orders yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="deliveries" className="pt-4">
          <div className="surface-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Fixed cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data?.deliveries ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{dateLabel(d.delivery_date)}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "Delivered" ? "default" : "secondary"}>
                        {d.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="num text-right">{num(d.total_qty)}</TableCell>
                    <TableCell className="num text-right">{inr(d.total_sales)}</TableCell>
                    <TableCell className="num text-right">{inr(d.total_fixed_cost)}</TableCell>
                    <TableCell className="num text-right font-semibold">{inr(d.profit)}</TableCell>
                    <TableCell className="text-right">
                      {(d.status ?? "Pending") === "Pending" && (
                        <Button size="sm" variant="outline" onClick={() => setDeliveringId(d)}>
                          Mark Delivered
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(history.data?.deliveries ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No deliveries yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="payments" className="pt-4">
          <div className="surface-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Collected by</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data?.payments ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{dateLabel(p.payment_date)}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "Received" ? "default" : "secondary"}>
                        {p.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.collected_by ?? "—"}</TableCell>
                    <TableCell className="num text-right font-semibold">{inr(p.amount)}</TableCell>
                    <TableCell className="text-right">
                      {p.status !== "Received" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markReceived.mutate(p.id)}
                          disabled={markReceived.isPending}
                        >
                          Mark Received
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(history.data?.payments ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No payments yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="stock" className="pt-4">
          <div className="surface-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Reorder below</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {labelProducts.map((lp) => {
                  const row = shopStock.find((r) => r.label_product_id === lp.id);
                  const value = Number(row?.stock ?? 0);
                  return (
                    <TableRow key={lp.id}>
                      <TableCell className="font-medium">{lp.name}</TableCell>
                      <TableCell
                        className={`num text-right ${value < lp.low_stock_threshold ? "font-semibold text-destructive" : ""}`}
                      >
                        {num(value)}
                      </TableCell>
                      <TableCell className="num text-right text-muted-foreground">
                        {lp.low_stock_threshold}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="analysis" className="pt-4">
          <ShopAnalysisTab shopId={shopId} />
        </TabsContent>
      </Tabs>

      <NewOrderDialog
        open={newOrderOpen}
        onOpenChange={setNewOrderOpen}
        editing={null}
        lockedShopId={shopId}
        onSaved={() => void history.refetch()}
      />

      <AlertDialog open={!!deliveringId} onOpenChange={(o) => !o && setDeliveringId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this delivery as Delivered?</AlertDialogTitle>
            <AlertDialogDescription>
              This finalizes sales, cost and profit figures for{" "}
              {deliveringId ? dateLabel(deliveringId.delivery_date) : "this delivery"} and creates or
              updates its payment record. This mirrors the same delivery workflow used on the Delivery
              sheet and cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deliveringId && markDelivered.mutate(deliveringId)}
              disabled={markDelivered.isPending}
            >
              Mark Delivered
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
