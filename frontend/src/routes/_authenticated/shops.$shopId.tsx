import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { FinancialYearPicker } from "@/components/financial-year-picker";
import { MonthPicker } from "@/components/month-picker";
import { NewOrderDialog } from "@/components/new-order-dialog";
import { ShopAnalysisTab } from "@/components/shop-analysis";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ordersApi, paymentsApi, shopsApi } from "@/services/klinzo.service";
import {
  labelProductsQuery,
  labelStockQuery,
  productsQuery,
  shopAreasQuery,
  shopsQuery,
} from "@/lib/queries";
import { dateLabel, inr, num, todayISO } from "@/lib/format";
import {
  ORDER_STATUSES,
  currentFinancialYear,
  currentMonth,
  monthKey,
  monthLabel,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/shops/$shopId")({
  component: () => (
    <RequirePermission resource={RESOURCES.shops}>
      <ShopDetail />
    </RequirePermission>
  ),
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
  collected_date: string | null;
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
  const { can } = usePermissions();
  const canSetStatus = can(RESOURCES.orders, "manage");
  const { data: shops = [] } = useQuery(shopsQuery);
  const shop = shops.find((s) => s.id === shopId);
  const { data: areas = [] } = useQuery(shopAreasQuery);
  const areaName = areas.find((a) => a.id === shop?.area_id)?.name ?? "Not Assigned";
  const { data: products = [] } = useQuery(productsQuery);
  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: stock = [] } = useQuery(labelStockQuery);

  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [receivingPayment, setReceivingPayment] = useState<HistoryPayment | null>(null);
  const [collectedBy, setCollectedBy] = useState("");
  const [collectedDate, setCollectedDate] = useState("");

  const [orderFy, setOrderFy] = useState(currentFinancialYear());
  const [orderMonth, setOrderMonth] = useState(currentMonth());
  const [deliveryFy, setDeliveryFy] = useState(currentFinancialYear());
  const [deliveryMonth, setDeliveryMonth] = useState(currentMonth());

  // Orders, deliveries and payments for this shop arrive in one request.
  const history = useQuery({
    queryKey: ["shop_history", shopId],
    queryFn: () => shopsApi.history(shopId),
  });

  const invalidateAll = () => {
    for (const key of INVALIDATE_KEYS) void qc.invalidateQueries({ queryKey: [key] });
  };

  const setDeliveryStatus = useMutation({
    mutationFn: ({ delivery, status }: { delivery: HistoryDelivery; status: string }) =>
      ordersApi.setStatus(delivery.order_id, status, delivery.delivery_date ?? todayISO()),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.status === "Delivered"
          ? "Marked delivered — sales, cost and payment figures updated"
          : `Status set to ${vars.status}`,
      );
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const markReceived = useMutation({
    mutationFn: async ({
      paymentId,
      collectedBy: by,
      collectedDate: date,
    }: {
      paymentId: string;
      collectedBy: string;
      collectedDate: string;
    }) =>
      paymentsApi.update(paymentId, {
        status: "Received",
        collected_by: by,
        collected_date: date,
      }),
    onSuccess: () => {
      toast.success("Payment marked received");
      setReceivingPayment(null);
      setCollectedBy("");
      setCollectedDate("");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openReceive = (payment: HistoryPayment) => {
    setReceivingPayment(payment);
    setCollectedBy(payment.collected_by ?? "");
    setCollectedDate(payment.collected_date ?? todayISO());
  };

  const sales = (history.data?.deliveries ?? []).reduce((a, d) => a + Number(d.total_sales), 0);
  const received = (history.data?.payments ?? [])
    .filter((p) => p.status === "Received")
    .reduce((a, p) => a + Number(p.amount), 0);
  const profit = (history.data?.deliveries ?? []).reduce((a, d) => a + Number(d.profit), 0);
  const shopStock = stock.filter((r) => r.shop_id === shopId);

  const qtyFor = (order: HistoryOrder, productId: string) =>
    order.order_lines.find((l) => l.product_id === productId)?.qty ?? 0;

  const filteredOrders = useMemo(
    () =>
      (history.data?.orders ?? []).filter(
        (o) => o.order_date && monthKey(o.order_date) === orderMonth,
      ),
    [history.data, orderMonth],
  );
  const filteredDeliveries = useMemo(
    () =>
      (history.data?.deliveries ?? []).filter(
        (d) => d.delivery_date && monthKey(d.delivery_date) === deliveryMonth,
      ),
    [history.data, deliveryMonth],
  );

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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Orders</h2>
            <div className="flex flex-wrap items-center gap-2">
              <FinancialYearPicker
                value={orderFy}
                onChange={(fy, suggestedMonth) => {
                  setOrderFy(fy);
                  setOrderMonth(suggestedMonth);
                }}
                dates={(history.data?.orders ?? []).map((o) => o.order_date)}
              />
              <MonthPicker value={orderMonth} onChange={setOrderMonth} financialYear={orderFy} />
              <Can resource={RESOURCES.orders} action="create">
                <Button size="sm" onClick={() => setNewOrderOpen(true)}>
                  <Plus className="size-4" /> New Order
                </Button>
              </Can>
            </div>
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
                {filteredOrders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{dateLabel(o.order_date)}</TableCell>
                    <TableCell>{dateLabel(o.delivery_date)}</TableCell>
                    <TableCell className="num text-right">{o.order_no}</TableCell>
                    {products.map((p) => (
                      <TableCell key={p.id} className="num text-right">
                        {qtyFor(o, p.id) || "—"}
                      </TableCell>
                    ))}
                    <TableCell className="num text-right font-semibold">
                      {num(o.total_qty)}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredOrders.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={products.length + 4}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No orders in {monthLabel(orderMonth)}.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="deliveries" className="pt-4">
          <div className="mb-3 flex items-center justify-end gap-2">
            <FinancialYearPicker
              value={deliveryFy}
              onChange={(fy, suggestedMonth) => {
                setDeliveryFy(fy);
                setDeliveryMonth(suggestedMonth);
              }}
              dates={(history.data?.deliveries ?? []).map((d) => d.delivery_date)}
            />
            <MonthPicker
              value={deliveryMonth}
              onChange={setDeliveryMonth}
              financialYear={deliveryFy}
            />
          </div>
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
                {filteredDeliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{dateLabel(d.delivery_date)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={d.status ?? "Pending"}
                          disabled={!canSetStatus}
                          onValueChange={(status) =>
                            setDeliveryStatus.mutate({ delivery: d, status })
                          }
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
                        {d.status === "Delivered" && <Badge>Synced</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="num text-right">{num(d.total_qty)}</TableCell>
                    <TableCell className="num text-right">{inr(d.total_sales)}</TableCell>
                    <TableCell className="num text-right">{inr(d.total_fixed_cost)}</TableCell>
                    <TableCell className="num text-right font-semibold">{inr(d.profit)}</TableCell>
                  </TableRow>
                ))}
                {filteredDeliveries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No deliveries in {monthLabel(deliveryMonth)}.
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
                        <Can resource={RESOURCES.payments} action="update">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReceive(p)}
                            disabled={markReceived.isPending}
                          >
                            Mark Received
                          </Button>
                        </Can>
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

      <Dialog open={!!receivingPayment} onOpenChange={(o) => !o && setReceivingPayment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark payment received</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Collected by</Label>
              <Input
                value={collectedBy}
                onChange={(e) => setCollectedBy(e.target.value)}
                placeholder="Name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Collection date</Label>
              <Input
                type="date"
                value={collectedDate}
                onChange={(e) => setCollectedDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                receivingPayment &&
                markReceived.mutate({
                  paymentId: receivingPayment.id,
                  collectedBy: collectedBy.trim(),
                  collectedDate,
                })
              }
              disabled={!collectedBy.trim() || !collectedDate || markReceived.isPending}
            >
              Mark Received
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
