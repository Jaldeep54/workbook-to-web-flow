import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
import { ShopAreaFilter, ShopFilter } from "@/components/filter-bar";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { supabase } from "@/integrations/supabase/client";
import { shopsQuery } from "@/lib/queries";
import { paymentsQuery, type PaymentRecord } from "@/lib/records";
import { PAYMENT_STATUSES, currentMonth, monthLabel } from "@/lib/domain";
import { dateLabel, inr } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Klinzo Operations" },
      {
        name: "description",
        content:
          "Payments raised automatically from delivered orders, with received and pending collections per month.",
      },
      { property: "og:title", content: "Payments — Klinzo Operations" },
      {
        property: "og:description",
        content: "Collections and outstanding balances by shop and month.",
      },
    ],
  }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [shopFilter, setShopFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: allPayments = [], isLoading } = useQuery(paymentsQuery(month, shopFilter));

  const payments = useMemo(() => {
    if (areaFilter === "all") return allPayments;
    const shopIdsInArea = new Set(shops.filter((s) => s.area_id === areaFilter).map((s) => s.id));
    return allPayments.filter((p) => shopIdsInArea.has(p.shop_id));
  }, [allPayments, shops, areaFilter]);

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { status?: string; collected_by?: string | null };
    }) => {
      const { error } = await supabase.from("payments").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Payment updated");
      for (const key of ["payments", "dashboard_summary", "available_months", "shop_history"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isReceived = (p: PaymentRecord) => p.status === "Received";
  const received = payments.filter(isReceived).reduce((a, p) => a + Number(p.amount), 0);
  const pendingRows = payments.filter((p) => !isReceived(p));
  const outstanding = pendingRows.reduce((a, p) => a + Number(p.amount), 0);

  return (
    <>
      <PageHeader
        title="Payments"
        description={`${payments.length} payments raised from deliveries in ${monthLabel(month)}`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <ShopAreaFilter value={areaFilter} onChange={setAreaFilter} />
            <ShopFilter value={shopFilter} onChange={setShopFilter} />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `klinzo-payments-${month}`,
                  payments.map((p) => ({
                    Date: p.payment_date ?? "",
                    Shop: p.shops?.shop_name ?? "",
                    "Label name": p.shops?.label_name ?? "",
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
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Received this month"
          value={inr(received)}
          sub={`${payments.length - pendingRows.length} payments marked received`}
          tone="positive"
        />
        <StatCard
          label="Awaiting payment"
          value={inr(outstanding)}
          sub={`${pendingRows.length} payments still pending`}
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
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Collected by</TableHead>
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
                  No payments in {monthLabel(month)}. Mark orders delivered on the delivery sheet to
                  raise payments.
                </TableCell>
              </TableRow>
            )}
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{dateLabel(p.payment_date)}</TableCell>
                <TableCell className="font-medium">
                  {p.shops?.shop_name ?? "—"}
                  {p.shops?.label_name && (
                    <p className="text-xs text-muted-foreground">{p.shops.label_name}</p>
                  )}
                </TableCell>
                <TableCell className="num text-right">{p.orders?.order_no ?? "—"}</TableCell>
                <TableCell className="num text-right font-semibold">{inr(p.amount)}</TableCell>
                <TableCell>
                  <Select
                    value={p.status ?? "Pending"}
                    onValueChange={(status) => update.mutate({ id: p.id, patch: { status } })}
                  >
                    <SelectTrigger className="w-[130px]">
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
                </TableCell>
                <TableCell>
                  <Input
                    defaultValue={p.collected_by ?? ""}
                    placeholder="Name"
                    maxLength={80}
                    className="w-[150px]"
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value !== (p.collected_by ?? "")) {
                        update.mutate({ id: p.id, patch: { collected_by: value || null } });
                      }
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
