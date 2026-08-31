import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { DataPagination, usePagination } from "@/components/data-pagination";
import { FinancialYearPicker } from "@/components/financial-year-picker";
import { MonthPicker } from "@/components/month-picker";
import { RecordCard, RecordCards, RecordField } from "@/components/record-card";
import { SearchInput, matchesSearch } from "@/components/search-input";
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
import { Can, RESOURCES } from "@/hooks/usePermissions";
import { RequirePermission } from "@/components/require-permission";
import { costsApi } from "@/services/klinzo.service";
import { costsQuery } from "@/lib/records";
import { COST_TYPES, currentFinancialYear, currentMonth, monthKey, monthLabel } from "@/lib/domain";
import { dateLabel, inr, todayISO } from "@/lib/format";
import { downloadCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/costs")({
  component: () => (
    <RequirePermission resource={RESOURCES.costs}>
      <CostsPage />
    </RequirePermission>
  ),
});

function CostsPage() {
  const qc = useQueryClient();
  const [fy, setFy] = useState(currentFinancialYear());
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [costDate, setCostDate] = useState(todayISO());
  const [costType, setCostType] = useState<string>("Transport");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const { data: allCosts = [], isLoading } = useQuery(costsQuery(month));

  const costs = useMemo(
    () => allCosts.filter((c) => matchesSearch(search, c.cost_type, c.note)),
    [allCosts, search],
  );
  // The total covers every row the filters leave, not just the visible page.
  const total = costs.reduce((a, c) => a + Number(c.amount), 0);
  const pagination = usePagination(costs, { resetKey: `${month}-${search}` });

  const emptyMessage =
    allCosts.length === 0
      ? `No costs recorded in ${monthLabel(month)}.`
      : "No costs match the current search.";

  const create = useMutation({
    mutationFn: async () => {
      await costsApi.create({
        cost_date: costDate,
        cost_type: costType,
        amount: Number(amount) || 0,
        note: note || null,
      });
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
    mutationFn: (id: string) => costsApi.remove(id),
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
            <FinancialYearPicker
              value={fy}
              onChange={(newFy, suggestedMonth) => {
                setFy(newFy);
                setMonth(suggestedMonth);
              }}
              dates={costs.map((c) => c.cost_date)}
            />
            <MonthPicker value={month} onChange={setMonth} financialYear={fy} />
            <SearchInput value={search} onChange={setSearch} placeholder="Search type or note…" />
            <Button
              variant="outline"
              className="col-span-2 sm:col-span-1"
              onClick={() =>
                downloadCsv(
                  `klinzo-costs-${month}`,
                  costs.map((c) => ({
                    Date: c.cost_date,
                    Type: c.cost_type,
                    Amount: c.amount,
                    Note: c.note ?? "",
                  })),
                )
              }
            >
              <Download className="size-4" /> Export
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <Can resource={RESOURCES.costs} action="create">
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="size-4" /> Add cost
                  </Button>
                </DialogTrigger>
              </Can>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add variable cost</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={costDate}
                      onChange={(e) => setCostDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount</Label>
                    <Input
                      type="number"
                      min={0}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
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

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="Total variable cost" value={inr(total)} tone="negative" />
        <StatCard label="Entries" value={String(costs.length)} />
      </div>

      <div className="surface-card overflow-hidden">
        {/* Table from sm up; a cost has few enough fields to card up below. */}
        <div className="hidden overflow-x-auto sm:block">
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
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
              {pagination.pageRows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{dateLabel(c.cost_date)}</TableCell>
                  <TableCell>{c.cost_type}</TableCell>
                  <TableCell className="text-muted-foreground">{c.note ?? "—"}</TableCell>
                  <TableCell className="num text-right font-semibold">{inr(c.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Can resource={RESOURCES.costs} action="delete">
                      <Button variant="ghost" size="icon" onClick={() => remove.mutate(c.id)}>
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <RecordCards className="sm:hidden">
          {isLoading && <p className="p-6 text-center text-muted-foreground">Loading costs…</p>}
          {!isLoading && costs.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          )}
          {pagination.pageRows.map((c) => (
            <RecordCard
              key={c.id}
              title={c.cost_type}
              subtitle={dateLabel(c.cost_date)}
              badge={<span className="num font-semibold">{inr(c.amount)}</span>}
              actions={
                <Can resource={RESOURCES.costs} action="delete">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => remove.mutate(c.id)}
                  >
                    <Trash2 className="size-4" /> Delete
                  </Button>
                </Can>
              }
            >
              {c.note && <RecordField label="Note">{c.note}</RecordField>}
            </RecordCard>
          ))}
        </RecordCards>

        <DataPagination pagination={pagination} noun="cost entries" />
      </div>
    </>
  );
}
