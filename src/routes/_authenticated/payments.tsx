import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
import { ShopFilter } from "@/components/filter-bar";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { paymentsQuery } from "@/lib/records";
import { PAYMENT_STATUSES, currentMonth, monthKey, monthLabel } from "@/lib/domain";
import { dateLabel, inr, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Klinzo Operations" },
      { name: "description", content: "Track collected payments and outstanding dues per delivered order." },
      { property: "og:title", content: "Payments — Klinzo Operations" },
      { property: "og:description", content: "Collections and outstanding balances by shop and month." },
    ],
  }),
  component: PaymentsPage,
});

type PayableDelivery = {
  id: string;
  order_id: string;
  shop_id: string;
  delivery_date: string | null;
  total_sales: number;
  shops: { shop_name: string } | null;
  orders: { order_no: number } | null;
  payments: Array<{ id: string }>;
};

function PaymentsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [shopFilter, setShopFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [deliveryId, setDeliveryId] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [status, setStatus] = useState("Received");
  const [collectedBy, setCollectedBy] = useState("");
  const [amount, setAmount] = useState("");

  const { data: payments = [], isLoading } = useQuery(paymentsQuery(month, shopFilter));

  const payable = useQuery({
    queryKey: ["payable_deliveries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deliveries")
        .select("id, order_id, shop_id, delivery_date, total_sales, shops(shop_name), orders(order_no), payments:payments!payments_order_id_fkey(id)")
        .order("delivery_date", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as PayableDelivery[]).filter((d) => (d.payments ?? []).length === 0);
    },
  });

  const selected = payable.data?.find((d) => d.id === deliveryId);

  const create = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Choose a delivery");
      const { error } = await supabase.from("payments").insert({
        shop_id: selected.shop_id,
        order_id: selected.order_id,
        payment_date: paymentDate,
        status,
        collected_by: collectedBy || null,
        amount: Number(amount) || 0,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setOpen(false);
      setDeliveryId("");
      setAmount("");
      void qc.invalidateQueries({ queryKey: ["payments"] });
      void qc.invalidateQueries({ queryKey: ["payable_deliveries"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
      void qc.invalidateQueries({ queryKey: ["available_months"] });
      setMonth(monthKey(paymentDate));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const received = payments.reduce((a, p) => a + Number(p.amount), 0);
  const outstanding = (payable.data ?? []).reduce((a, d) => a + Number(d.total_sales), 0);

  return (
    <>
      <PageHeader
        title="Payments"
        description={`${payments.length} payments in ${monthLabel(month)}`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <ShopFilter value={shopFilter} onChange={setShopFilter} />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `klinzo-payments-${month}`,
                  payments.map((p) => ({
                    Date: p.payment_date ?? "",
                    Shop: p.shops?.shop_name ?? "",
                    "Order no": p.orders?.order_no ?? "",
                    Status: p.status ?? "",
                    "Collected by": p.collected_by ?? "",
                    Amount: p.amount,
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> New payment
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Record payment</DialogTitle>
                </DialogHeader>
                <div className="space-y-1.5">
                  <Label className="text-xs">Unpaid delivery</Label>
                  <Select
                    value={deliveryId}
                    onValueChange={(v) => {
                      setDeliveryId(v);
                      const d = payable.data?.find((x) => x.id === v);
                      if (d) setAmount(String(d.total_sales));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a delivery" />
                    </SelectTrigger>
                    <SelectContent>
                      {(payable.data ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.shops?.shop_name} · #{d.orders?.order_no} · {inr(d.total_sales)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Payment date</Label>
                    <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount</Label>
                    <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Collected by</Label>
                    <Input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} />
                  </div>
                </div>
                {selected && (
                  <p className="num text-sm text-muted-foreground">
                    Invoice value {inr(selected.total_sales, 2)} · due{" "}
                    {inr(Number(selected.total_sales) - (Number(amount) || 0), 2)}
                  </p>
                )}
                <DialogFooter>
                  <Button onClick={() => create.mutate()} disabled={!deliveryId || create.isPending}>
                    Save payment
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Received this month" value={inr(received)} tone="positive" />
        <StatCard
          label="Awaiting payment"
          value={inr(outstanding)}
          sub={`${payable.data?.length ?? 0} deliveries with no payment recorded`}
          tone={outstanding > 0 ? "negative" : "positive"}
        />
      </div>

      <div className="surface-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead className="text-right">Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Collected by</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Loading payments…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && payments.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  No payments in {monthLabel(month)}.
                </TableCell>
              </TableRow>
            )}
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{dateLabel(p.payment_date)}</TableCell>
                <TableCell className="font-medium">{p.shops?.shop_name ?? "—"}</TableCell>
                <TableCell className="num text-right">{p.orders?.order_no ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "Received" ? "default" : "secondary"}>{p.status ?? "—"}</Badge>
                </TableCell>
                <TableCell>{p.collected_by ?? "—"}</TableCell>
                <TableCell className="num text-right font-semibold">{inr(p.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}