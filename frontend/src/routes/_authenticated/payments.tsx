import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CheckCircle2, Download, Wallet } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { FinancialYearPicker } from "@/components/financial-year-picker";
import { MonthPicker } from "@/components/month-picker";
import { ShopAreaFilter, ShopFilter } from "@/components/filter-bar";
import { RecordCard, RecordCards, RecordField } from "@/components/record-card";
import { SearchInput, matchesSearch } from "@/components/search-input";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
import { RESOURCES, usePermissions } from "@/hooks/usePermissions";
import { paymentsApi, type PaymentCollector } from "@/services/klinzo.service";
import { shopsQuery } from "@/lib/queries";
import { paymentCollectorsQuery, paymentsQuery, type PaymentRecord } from "@/lib/records";
import { currentFinancialYear, currentMonth, monthLabel } from "@/lib/domain";
import { dateLabel, inr, num } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/payments")({
  component: () => (
    <RequirePermission resource={RESOURCES.payments}>
      <PaymentsPage />
    </RequirePermission>
  ),
});

/** "Collected by — nobody yet"; Radix forbids an empty-string SelectItem value. */
const NO_COLLECTOR = "__none__";

const STATUS_FILTERS = [
  { value: "all", label: "All payments" },
  { value: "Pending", label: "Not paid" },
  { value: "Partial", label: "Part paid" },
  { value: "Received", label: "Paid in full" },
] as const;

/** What a row's controls need, whichever of the two layouts is rendering it. */
type RowProps = {
  payment: PaymentRecord;
  canUpdate: boolean;
  pending: boolean;
  onReceived: (payment: PaymentRecord, raw: string) => void;
  onSettle: (payment: PaymentRecord) => void;
  onCollector: (payment: PaymentRecord, userId: string | null) => void;
  onCollectedDate: (payment: PaymentRecord, date: string | null) => void;
  collectors: PaymentCollector[];
};

/**
 * Payments — what each delivered order is worth, what has come in against it,
 * and what the shopkeeper still owes.
 *
 * Shops pay in instalments, so the row a collector works from is the balance,
 * not a yes/no status: they type in what they were handed and the API works
 * out whether that leaves the bill pending, part paid or settled. A payment's
 * status is therefore never picked from a dropdown here — it is shown.
 *
 * The records appear as a table on a desktop and as stacked cards on a phone.
 * Both are driven by the same state and the same mutations, and both render
 * the same four controls below, so the two can never drift apart.
 */
function PaymentsPage() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canUpdate = can(RESOURCES.payments, "update");

  const [fy, setFy] = useState(currentFinancialYear());
  const [month, setMonth] = useState(currentMonth());
  const [shopFilter, setShopFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: collectors = [] } = useQuery(paymentCollectorsQuery);
  const { data: allPayments = [], isLoading } = useQuery(paymentsQuery(month, shopFilter));

  /**
   * The month's payments for the chosen area and shop. The money cards below
   * describe *this* set: narrowing by status or searching for a shop changes
   * which rows are listed, but "what is still owed this month" has to keep
   * meaning the same thing whichever of those the user is looking through.
   */
  const scoped = useMemo(() => {
    if (areaFilter === "all") return allPayments;
    const shopIdsInArea = new Set(shops.filter((s) => s.area_id === areaFilter).map((s) => s.id));
    return allPayments.filter((p) => shopIdsInArea.has(p.shop_id));
  }, [allPayments, shops, areaFilter]);

  const filtered = useMemo(
    () =>
      scoped.filter(
        (p) =>
          (statusFilter === "all" || p.status === statusFilter) &&
          matchesSearch(
            search,
            p.shops?.shop_name,
            p.shops?.label_name,
            p.shops?.code,
            p.orders?.order_no,
            p.collected_by,
          ),
      ),
    [scoped, statusFilter, search],
  );

  const pagination = usePagination(filtered, {
    resetKey: `${month}-${shopFilter}-${areaFilter}-${statusFilter}-${search}`,
  });

  const totals = useMemo(() => {
    const billed = scoped.reduce((a, p) => a + Number(p.amount), 0);
    const received = scoped.reduce((a, p) => a + Number(p.amount_received), 0);
    return {
      billed,
      received,
      outstanding: scoped.reduce((a, p) => a + Number(p.balance), 0),
      settledCount: scoped.filter((p) => p.status === "Received").length,
      partialCount: scoped.filter((p) => p.status === "Partial").length,
      owingCount: scoped.filter((p) => p.status !== "Received").length,
      collectedPct: billed > 0 ? Math.round((received / billed) * 100) : 0,
    };
  }, [scoped]);

  const update = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: {
        amount_received?: number;
        collected_by_user_id?: string | null;
        collected_date?: string | null;
      };
    }) => paymentsApi.update(id, patch),
    onSuccess: (payment) => {
      toast.success(
        payment.status === "Received"
          ? `${payment.shops?.shop_name ?? "Shop"} has settled this bill in full`
          : "Payment updated",
      );
      for (const key of [
        "payments",
        "dashboard_summary",
        "cash_position_summary",
        "available_months",
        "shop_history",
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Commits a typed-in received amount, ignoring anything that isn't a change. */
  const commitReceived = (payment: PaymentRecord, raw: string) => {
    const value = raw.trim() === "" ? 0 : Number(raw);
    if (Number.isNaN(value) || value < 0) {
      toast.error("Enter the amount received as a number");
      return;
    }
    if (value > payment.amount) {
      toast.error(`That is more than the ${inr(payment.amount)} owed on this order`);
      return;
    }
    if (value === Number(payment.amount_received)) return;
    update.mutate({ id: payment.id, patch: { amount_received: value } });
  };

  const rowProps = {
    canUpdate,
    pending: update.isPending,
    collectors,
    onReceived: commitReceived,
    onSettle: (payment: PaymentRecord) =>
      update.mutate({ id: payment.id, patch: { amount_received: payment.amount } }),
    onCollector: (payment: PaymentRecord, userId: string | null) =>
      update.mutate({ id: payment.id, patch: { collected_by_user_id: userId } }),
    onCollectedDate: (payment: PaymentRecord, date: string | null) =>
      update.mutate({ id: payment.id, patch: { collected_date: date } }),
  };

  const emptyMessage =
    scoped.length === 0
      ? `No payments in ${monthLabel(month)}. Mark orders delivered on the delivery sheet to raise payments.`
      : "No payments match the current search or status filter.";

  return (
    <>
      <PageHeader
        title="Payments"
        description={`${num(scoped.length)} payments raised from deliveries in ${monthLabel(month)} · ${inr(totals.outstanding)} still to collect`}
        actions={
          <>
            <FinancialYearPicker
              value={fy}
              onChange={(newFy, suggestedMonth) => {
                setFy(newFy);
                setMonth(suggestedMonth);
              }}
              dates={allPayments.map((p) => p.payment_date)}
            />
            <MonthPicker value={month} onChange={setMonth} financialYear={fy} />
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full bg-card sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SearchInput value={search} onChange={setSearch} placeholder="Search shop or order…" />
            <Button
              variant="outline"
              className="col-span-2 sm:col-span-1"
              onClick={() =>
                downloadCsv(
                  `klinzo-payments-${month}`,
                  filtered.map((p) => ({
                    Date: p.payment_date ?? "",
                    Shop: p.shops?.shop_name ?? "",
                    "Label name": p.shops?.label_name ?? "",
                    "Order no": p.orders?.order_no ?? "",
                    "Bill amount": p.amount,
                    Received: p.amount_received,
                    "Balance due": p.balance,
                    Status: p.status ?? "",
                    "Collected by": p.collected_by ?? "",
                    "Date of collection": p.collected_date ?? "",
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Billed this month"
          value={inr(totals.billed)}
          sub={`across ${num(scoped.length)} delivered orders`}
          icon={Wallet}
        />
        <StatCard
          label="Received"
          value={inr(totals.received)}
          sub={`${totals.collectedPct}% of what was billed`}
          tone="positive"
        />
        <StatCard
          label="Balance pending"
          value={inr(totals.outstanding)}
          sub={
            totals.outstanding > 0
              ? `${num(totals.owingCount)} shop${totals.owingCount === 1 ? "" : "s"} still owe money`
              : "Every bill this month is settled"
          }
          tone={totals.outstanding > 0 ? "negative" : "positive"}
        />
        <StatCard
          label="Settled in full"
          value={`${num(totals.settledCount)} / ${num(scoped.length)}`}
          sub={
            totals.partialCount > 0
              ? `${num(totals.partialCount)} more part paid`
              : "No part payments outstanding"
          }
          tone={totals.settledCount === scoped.length && scoped.length > 0 ? "positive" : "default"}
          icon={CheckCircle2}
        />
      </div>

      {scoped.length > 0 && (
        <div className="surface-card mb-6 p-4 sm:p-5">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Collection progress
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {inr(totals.received)} collected of {inr(totals.billed)} billed in{" "}
                {monthLabel(month)}
              </p>
            </div>
            <p className="num shrink-0 font-display text-xl font-semibold">
              {totals.collectedPct}%
            </p>
          </div>
          <Progress value={totals.collectedPct} className="h-2" />
        </div>
      )}

      <div className="surface-card overflow-hidden">
        {/* Table from lg up; the same records as cards below that. Nine
            columns do not fit a tablet, so md gets the cards too. */}
        <div className="hidden overflow-x-auto lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead className="text-right">Order</TableHead>
                <TableHead className="whitespace-nowrap text-right">Bill amount</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Collected by</TableHead>
                <TableHead className="whitespace-nowrap">Date of collection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    Loading payments…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
              {pagination.pageRows.map((p) => (
                <TableRow
                  key={p.id}
                  className={p.status === "Received" ? "bg-success/5" : undefined}
                >
                  <TableCell className="whitespace-nowrap">{dateLabel(p.payment_date)}</TableCell>
                  <TableCell className="font-medium">
                    {p.shops?.shop_name ?? "—"}
                    {p.shops?.label_name && (
                      <p className="text-xs text-muted-foreground">{p.shops.label_name}</p>
                    )}
                  </TableCell>
                  <TableCell className="num text-right">{p.orders?.order_no ?? "—"}</TableCell>
                  <TableCell className="num text-right font-semibold">{inr(p.amount)}</TableCell>
                  <TableCell>
                    <ReceivedControl payment={p} {...rowProps} className="justify-end" />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "num text-right font-semibold",
                      p.balance > 0 ? "text-destructive" : "text-success",
                    )}
                  >
                    {p.balance > 0 ? inr(p.balance) : "—"}
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge payment={p} />
                  </TableCell>
                  <TableCell>
                    <CollectorControl payment={p} {...rowProps} className="w-[160px]" />
                  </TableCell>
                  <TableCell>
                    <CollectedDateControl payment={p} {...rowProps} className="w-[150px]" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <RecordCards className="lg:hidden">
          {isLoading && <p className="p-6 text-center text-muted-foreground">Loading payments…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          )}
          {pagination.pageRows.map((p) => (
            <RecordCard
              key={p.id}
              className={p.status === "Received" ? "bg-success/5" : undefined}
              title={p.shops?.shop_name ?? "—"}
              subtitle={
                <>
                  {p.shops?.label_name && <span>{p.shops.label_name} · </span>}
                  Order {p.orders?.order_no ?? "—"} · {dateLabel(p.payment_date)}
                </>
              }
              badge={<PaymentStatusBadge payment={p} />}
            >
              <RecordField label="Bill amount">
                <span className="num font-semibold">{inr(p.amount)}</span>
              </RecordField>
              <RecordField label="Balance">
                <span
                  className={cn(
                    "num font-semibold",
                    p.balance > 0 ? "text-destructive" : "text-success",
                  )}
                >
                  {p.balance > 0 ? inr(p.balance) : "Settled"}
                </span>
              </RecordField>
              <RecordField label="Received">
                <ReceivedControl payment={p} {...rowProps} className="justify-end" />
              </RecordField>
              <RecordField label="Collected by" align="stretch">
                <CollectorControl payment={p} {...rowProps} className="w-full sm:max-w-[260px]" />
              </RecordField>
              <RecordField label="Date of collection" align="stretch">
                <CollectedDateControl
                  payment={p}
                  {...rowProps}
                  className="w-full sm:max-w-[260px]"
                />
              </RecordField>
            </RecordCard>
          ))}
        </RecordCards>

        <DataPagination pagination={pagination} noun="payments" />
      </div>
    </>
  );
}

/**
 * What the shop handed over, plus the shortcut for the common case of the
 * whole bill arriving at once.
 */
function ReceivedControl({
  payment,
  canUpdate,
  pending,
  onReceived,
  onSettle,
  className,
}: RowProps & { className?: string }) {
  const settled = payment.status === "Received";
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Input
        // Re-mounted whenever the stored figure changes, so the box always
        // shows what the server actually holds.
        key={`${payment.id}-${payment.amount_received}`}
        type="number"
        min={0}
        max={payment.amount}
        step="0.01"
        inputMode="decimal"
        defaultValue={payment.amount_received || ""}
        placeholder="0"
        readOnly={!canUpdate}
        aria-label={`Amount received from ${payment.shops?.shop_name ?? "shop"}`}
        className="num h-9 w-[110px] text-right sm:h-8"
        onBlur={(e) => canUpdate && onReceived(payment, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {canUpdate && !settled && (
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground hover:text-success sm:size-8"
          aria-label={`Mark ${payment.shops?.shop_name ?? "this bill"} paid in full`}
          title="Paid in full"
          disabled={pending}
          onClick={() => onSettle(payment)}
        >
          <CheckCircle2 className="size-4" />
        </Button>
      )}
    </div>
  );
}

function CollectorControl({
  payment,
  canUpdate,
  collectors,
  onCollector,
  className,
}: RowProps & { className?: string }) {
  return (
    <Select
      value={payment.collected_by_user_id ?? NO_COLLECTOR}
      disabled={!canUpdate}
      onValueChange={(value) => onCollector(payment, value === NO_COLLECTOR ? null : value)}
    >
      <SelectTrigger className={className} aria-label="Collected by">
        {/* The stored name, not the account, is what a historical row is really
            about — so a collector whose account has gone still reads correctly. */}
        <SelectValue placeholder={payment.collected_by ?? "Nobody yet"}>
          {payment.collected_by ?? "Nobody yet"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_COLLECTOR}>Nobody yet</SelectItem>
        {collectors.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.full_name}
            {c.role_name && (
              <span className="ml-1.5 text-xs text-muted-foreground">{c.role_name}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CollectedDateControl({
  payment,
  canUpdate,
  onCollectedDate,
  className,
}: RowProps & { className?: string }) {
  return (
    <Input
      type="date"
      key={`${payment.id}-${payment.collected_date ?? ""}`}
      defaultValue={payment.collected_date ?? ""}
      readOnly={!canUpdate}
      aria-label="Date of collection"
      className={className}
      onBlur={(e) => {
        const value = e.target.value;
        if (value !== (payment.collected_date ?? "")) onCollectedDate(payment, value || null);
      }}
    />
  );
}

/**
 * The status a payment's two money figures add up to. Settled bills get the
 * green tick — the one thing a collector scanning the column is looking for.
 */
function PaymentStatusBadge({ payment }: { payment: PaymentRecord }) {
  if (payment.status === "Received") {
    return (
      <Badge className="gap-1 whitespace-nowrap border-transparent bg-success text-success-foreground hover:bg-success/90">
        <CheckCircle2 className="size-3.5" /> Paid in full
      </Badge>
    );
  }
  if (payment.status === "Partial") {
    return (
      <Badge variant="outline" className="whitespace-nowrap border-warning text-warning">
        Part paid · {inr(payment.balance)} left
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="whitespace-nowrap">
      Not paid
    </Badge>
  );
}
