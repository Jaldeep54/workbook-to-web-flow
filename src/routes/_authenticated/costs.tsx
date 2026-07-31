import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { costsQuery } from "@/lib/records";
import { COST_TYPES, currentMonth, monthKey, monthLabel } from "@/lib/domain";
import { dateLabel, inr, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/costs")({
  head: () => ({
    meta: [
      { title: "Variable costs — Klinzo Operations" },
      { name: "description", content: "Log transport, salary, rent and other variable costs that reduce monthly profit." },
      { property: "og:title", content: "Variable costs — Klinzo Operations" },
      { property: "og:description", content: "Monthly variable cost register." },
    ],
  }),
  component: CostsPage,
});

function CostsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [costDate, setCostDate] = useState(todayISO());
  const [costType, setCostType] = useState<string>("Transport");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const { data: costs = [], isLoading } = useQuery(costsQuery(month));
  const total = costs.reduce((a, c) => a + Number(c.amount), 0);

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("variable_costs").insert({
        cost_date: costDate,
        cost_type: costType,
        amount: Number(amount) || 0,
        note: note || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Cost added");
      setOpen(false);
      setAmount("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["variable_costs"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
      void qc.invalidateQueries({ queryKey: ["available_months"] });
      setMonth(monthKey(costDate));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("variable_costs").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Cost removed");
      void qc.invalidateQueries({ queryKey: ["variable_costs"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader
        title="Variable costs"
        description={`Costs recorded for ${monthLabel(month)}`}
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `klinzo-costs-${month}`,
                  costs.map((c) => ({ Date: c.cost_date, Type: c.cost_type, Amount: c.amount, Note: c.note ?? "" })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> Add cost
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add variable cost</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount</Label>
                    <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Type</Label>
                    <Select value={costType} onValueChange={setCostType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COST_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">Note</Label>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => create.mutate()} disabled={!amount || create.isPending}>
                    Save cost
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Total variable cost" value={inr(total)} tone="negative" />
        <StatCard label="Entries" value={String(costs.length)} />
      </div>

      <div className="surface-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Loading costs…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && costs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  No costs recorded in {monthLabel(month)}.
                </TableCell>
              </TableRow>
            )}
            {costs.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{dateLabel(c.cost_date)}</TableCell>
                <TableCell>{c.cost_type}</TableCell>
                <TableCell className="text-muted-foreground">{c.note ?? "—"}</TableCell>
                <TableCell className="num text-right font-semibold">{inr(c.amount)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => remove.mutate(c.id)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}