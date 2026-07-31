import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { labelProductsQuery, labelStockQuery, shopsQuery } from "@/lib/queries";
import { dateLabel, inr, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/shops/$shopId")({
  head: () => ({
    meta: [
      { title: "Shop detail — Klinzo Operations" },
      { name: "description", content: "Orders, deliveries, payments and label stock history for a single shop." },
      { property: "og:title", content: "Shop detail — Klinzo Operations" },
      { property: "og:description", content: "One shop's full trading history." },
    ],
  }),
  component: ShopDetail,
});

function ShopDetail() {
  const { shopId } = useParams({ from: "/_authenticated/shops/$shopId" });
  const { data: shops = [] } = useQuery(shopsQuery);
  const shop = shops.find((s) => s.id === shopId);
  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: stock = [] } = useQuery(labelStockQuery);

  const history = useQuery({
    queryKey: ["shop_history", shopId],
    queryFn: async () => {
      const [orders, deliveries, payments] = await Promise.all([
        supabase
          .from("orders")
          .select("id, order_no, order_date, total_qty")
          .eq("shop_id", shopId)
          .order("order_date", { ascending: false })
          .limit(200),
        supabase
          .from("deliveries")
          .select("id, delivery_date, status, total_qty, total_sales, total_fixed_cost, profit")
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
        orders: (orders.data ?? []) as Array<{ id: string; order_no: number; order_date: string | null; total_qty: number }>,
        deliveries: (deliveries.data ?? []) as Array<{
          id: string;
          delivery_date: string | null;
          status: string | null;
          total_qty: number;
          total_sales: number;
          total_fixed_cost: number;
          profit: number;
        }>,
        payments: (payments.data ?? []) as Array<{
          id: string;
          payment_date: string | null;
          status: string | null;
          collected_by: string | null;
          amount: number;
        }>,
      };
    },
  });

  const sales = (history.data?.deliveries ?? []).reduce((a, d) => a + Number(d.total_sales), 0);
  const received = (history.data?.payments ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const profit = (history.data?.deliveries ?? []).reduce((a, d) => a + Number(d.profit), 0);
  const shopStock = stock.filter((r) => r.shop_id === shopId);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/shops">
          <ArrowLeft className="size-4" /> All shops
        </Link>
      </Button>

      <PageHeader
        title={shop?.shop_name ?? "Shop"}
        description={[shop?.code, shop?.mobile, shop?.address].filter(Boolean).join(" · ")}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Lifetime sales" value={inr(sales)} tone="accent" />
        <StatCard label="Collected" value={inr(received)} tone="positive" />
        <StatCard label="Outstanding" value={inr(sales - received)} tone={sales - received > 0 ? "negative" : "positive"} />
        <StatCard label="Profit" value={inr(profit)} tone={profit >= 0 ? "positive" : "negative"} />
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="stock">Label stock</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="pt-4">
          <div className="surface-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Order no</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data?.orders ?? []).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{dateLabel(o.order_date)}</TableCell>
                    <TableCell className="num text-right">{o.order_no}</TableCell>
                    <TableCell className="num text-right">{num(o.total_qty)}</TableCell>
                  </TableRow>
                ))}
                {(history.data?.orders ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data?.deliveries ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{dateLabel(d.delivery_date)}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "Delivered" ? "default" : "secondary"}>{d.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="num text-right">{num(d.total_qty)}</TableCell>
                    <TableCell className="num text-right">{inr(d.total_sales)}</TableCell>
                    <TableCell className="num text-right">{inr(d.total_fixed_cost)}</TableCell>
                    <TableCell className="num text-right font-semibold">{inr(d.profit)}</TableCell>
                  </TableRow>
                ))}
                {(history.data?.deliveries ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data?.payments ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{dateLabel(p.payment_date)}</TableCell>
                    <TableCell>{p.status ?? "—"}</TableCell>
                    <TableCell>{p.collected_by ?? "—"}</TableCell>
                    <TableCell className="num text-right font-semibold">{inr(p.amount)}</TableCell>
                  </TableRow>
                ))}
                {(history.data?.payments ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
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
                      <TableCell className="num text-right text-muted-foreground">{lp.low_stock_threshold}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}