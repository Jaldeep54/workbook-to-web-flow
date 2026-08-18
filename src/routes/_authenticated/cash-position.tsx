import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  cashPositionSummaryQuery,
  investmentsQuery,
  payoutsQuery,
  type InvestmentRow,
  type PayoutRow,
} from "@/lib/queries";
import { CASH_POSITION_PEOPLE, type CashPositionPerson } from "@/lib/domain";
import { dateLabel, inr, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/cash-position")({
  head: () => ({
    meta: [
      { title: "Cash Position — Klinzo Operations" },
      {
        name: "description",
        content: "All-time investments, payouts and money in hand across the whole business.",
      },
      { property: "og:title", content: "Cash Position — Klinzo Operations" },
      {
        property: "og:description",
        content: "Running cash balance: investments, payments, costs and payouts.",
      },
    ],
  }),
  component: CashPositionPage,
});

const CASH_POSITION_INVALIDATE_KEYS = ["cash_position_summary", "investments", "payouts"];

function CashPositionPage() {
  const summary = useQuery(cashPositionSummaryQuery);
  const s = summary.data;
  const moneyInHand =
    (s?.investmentsTotal ?? 0) +
    (s?.paymentsReceivedTotal ?? 0) -
    ((s?.variableCostsTotal ?? 0) + (s?.payoutsTotal ?? 0));

  return (
    <>
      <PageHeader
        title="Cash Position"
        description="All-time cash balance — not scoped to a single month"
      />

      <div className="mb-6">
        <StatCard
          label="Money in hand"
          value={inr(moneyInHand)}
          sub="Investments + Payments received − (Variable costs + Payouts)"
          tone={moneyInHand >= 0 ? "positive" : "negative"}
        />
      </div>

      <Tabs defaultValue="investments">
        <TabsList>
          <TabsTrigger value="investments">Investments</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>
        <TabsContent value="investments" className="pt-4">
          <InvestmentsSection
            total={s?.investmentsTotal ?? 0}
            byBhavin={s?.investmentsByBhavin ?? 0}
            byJaldeep={s?.investmentsByJaldeep ?? 0}
          />
        </TabsContent>
        <TabsContent value="payouts" className="pt-4">
          <PayoutsSection total={s?.payoutsTotal ?? 0} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function DoneBySelect({
  value,
  onChange,
}: {
  value: CashPositionPerson;
  onChange: (v: CashPositionPerson) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as CashPositionPerson)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CASH_POSITION_PEOPLE.map((p) => (
          <SelectItem key={p} value={p}>
            {p}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InvestmentsSection({
  total,
  byBhavin,
  byJaldeep,
}: {
  total: number;
  byBhavin: number;
  byJaldeep: number;
}) {
  const qc = useQueryClient();
  const { data: investments = [], isLoading } = useQuery(investmentsQuery);
  const [open, setOpen] = useState(false);
  const [investmentDate, setInvestmentDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [doneBy, setDoneBy] = useState<CashPositionPerson>("Bhavin");
  const [deleting, setDeleting] = useState<InvestmentRow | null>(null);

  const invalidateAll = () => {
    for (const key of CASH_POSITION_INVALIDATE_KEYS) void qc.invalidateQueries({ queryKey: [key] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("investments" as never).insert({
        investment_date: investmentDate,
        amount: Number(amount) || 0,
        done_by: doneBy,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Investment recorded");
      setOpen(false);
      setAmount("");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("investments" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Investment removed");
      setDeleting(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total invested" value={inr(total)} tone="accent" />
          <StatCard label="By Bhavin" value={inr(byBhavin)} />
          <StatCard label="By Jaldeep" value={inr(byJaldeep)} />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add investment
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Add investment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Investment date</Label>
                <Input
                  type="date"
                  value={investmentDate}
                  onChange={(e) => setInvestmentDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Investment amount</Label>
                <Input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Investment done by</Label>
                <DoneBySelect value={doneBy} onChange={setDoneBy} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!amount || create.isPending}>
                Save investment
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
              <TableHead>Done by</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  Loading investments…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && investments.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                  No investments recorded yet.
                </TableCell>
              </TableRow>
            )}
            {investments.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{dateLabel(row.investment_date)}</TableCell>
                <TableCell>{row.done_by}</TableCell>
                <TableCell className="num text-right font-semibold">{inr(row.amount)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setDeleting(row)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this investment?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleting &&
              `${inr(deleting.amount)} by ${deleting.done_by} on ${dateLabel(deleting.investment_date)}`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PayoutsSection({ total }: { total: number }) {
  const qc = useQueryClient();
  const { data: payouts = [], isLoading } = useQuery(payoutsQuery);
  const [open, setOpen] = useState(false);
  const [payoutDate, setPayoutDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [doneBy, setDoneBy] = useState<CashPositionPerson>("Bhavin");
  const [deleting, setDeleting] = useState<PayoutRow | null>(null);

  const invalidateAll = () => {
    for (const key of CASH_POSITION_INVALIDATE_KEYS) void qc.invalidateQueries({ queryKey: [key] });
  };

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("payouts" as never).insert({
        payout_date: payoutDate,
        amount: Number(amount) || 0,
        done_by: doneBy,
      } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Payout recorded");
      setOpen(false);
      setAmount("");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("payouts" as never)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Payout removed");
      setDeleting(null);
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex-1">
          <StatCard label="Total paid out" value={inr(total)} tone="negative" />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add payout
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Add payout</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Payout date</Label>
                <Input
                  type="date"
                  value={payoutDate}
                  onChange={(e) => setPayoutDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Payout amount</Label>
                <Input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Payout done by</Label>
                <DoneBySelect value={doneBy} onChange={setDoneBy} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!amount || create.isPending}>
                Save payout
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
              <TableHead>Done by</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  Loading payouts…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && payouts.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                  No payouts recorded yet.
                </TableCell>
              </TableRow>
            )}
            {payouts.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{dateLabel(row.payout_date)}</TableCell>
                <TableCell>{row.done_by}</TableCell>
                <TableCell className="num text-right font-semibold">{inr(row.amount)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setDeleting(row)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this payout?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleting &&
              `${inr(deleting.amount)} by ${deleting.done_by} on ${dateLabel(deleting.payout_date)}`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
