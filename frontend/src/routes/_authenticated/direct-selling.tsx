import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { MonthPicker } from "@/components/month-picker";
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
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { RequirePermission } from "@/components/require-permission";
import { Can, RESOURCES } from "@/hooks/usePermissions";
import { directSalesApi, type DirectSale } from "@/services/klinzo.service";
import { productsQuery } from "@/lib/queries";
import { currentMonth } from "@/lib/domain";
import { inr, dateLabel, todayISO } from "@/lib/format";
import type { Product } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/direct-selling")({
  component: () => (
    <RequirePermission resource={RESOURCES.directSelling}>
      <DirectSellingPage />
    </RequirePermission>
  ),
});

const STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  partial: "Partial",
  unpaid: "Unpaid",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  paid: "default",
  partial: "secondary",
  unpaid: "destructive",
};

type FormState = {
  product_id: string;
  product_name: string;
  sold_by: string;
  sold_date: string;
  quantity: number;
  selling_price: number;
  production_cost: number;
  label_cost: number;
  jar_pouch_cost: number;
  payment_amount: number;
  payment_status: "paid" | "partial" | "unpaid";
};

const emptyForm = (): FormState => ({
  product_id: "",
  product_name: "",
  sold_by: "",
  sold_date: todayISO(),
  quantity: 1,
  selling_price: 0,
  production_cost: 0,
  label_cost: 0,
  jar_pouch_cost: 0,
  payment_amount: 0,
  payment_status: "unpaid",
});

function DirectSellingPage() {
  const qc = useQueryClient();

  // Filters
  const [month, setMonth] = useState<string>(currentMonth());
  const [tillDate, setTillDate] = useState(false);
  const [soldByFilter, setSoldByFilter] = useState("");

  // Build query params
  const queryParams = tillDate
    ? { toDate: todayISO(), soldBy: soldByFilter || undefined }
    : { month, soldBy: soldByFilter || undefined };

  const { data, isLoading } = useQuery({
    queryKey: ["direct_sales", queryParams],
    queryFn: () => directSalesApi.list(queryParams),
    staleTime: 30_000,
  });

  const { data: products = [] } = useQuery(productsQuery);
  const activeProducts = products.filter((p) => p.is_active);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const profit = form.selling_price - form.production_cost - form.label_cost - form.jar_pouch_cost;

  // When product or quantity changes, recalculate unit costs
  const applyProduct = (product: Product, qty: number) => {
    setForm((f) => ({
      ...f,
      product_id: product.id,
      product_name: product.name,
      quantity: qty,
      selling_price: +(product.selling_price * qty).toFixed(2),
      production_cost: +(product.production_cost * qty).toFixed(2),
      label_cost: +(product.label_cost_per_unit * qty).toFixed(2),
      jar_pouch_cost: +(product.packaging_cost * qty).toFixed(2),
    }));
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (sale: DirectSale) => {
    setEditingId(sale.id);
    setForm({
      product_id: sale.product_id,
      product_name: sale.product_name,
      sold_by: sale.sold_by,
      sold_date: sale.sold_date,
      quantity: sale.quantity,
      selling_price: sale.selling_price,
      production_cost: sale.production_cost,
      label_cost: sale.label_cost,
      jar_pouch_cost: sale.jar_pouch_cost,
      payment_amount: sale.payment_amount,
      payment_status: sale.payment_status,
    });
    setDialogOpen(true);
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["direct_sales"] });
    void qc.invalidateQueries({ queryKey: ["cash_position_summary"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, profit };
      return editingId ? directSalesApi.update(editingId, payload) : directSalesApi.create(payload);
    },
    onSuccess: () => {
      toast.success(editingId ? "Sale updated" : "Sale recorded");
      setDialogOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => directSalesApi.remove(id),
    onSuccess: () => {
      toast.success("Sale deleted");
      setDeletingId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? { totalSales: 0, totalProfit: 0 };
  const byProduct = data?.byProduct ?? [];

  return (
    <>
      <PageHeader
        title="Direct Selling"
        description="Record and track direct cash sales by product and seller."
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          variant={tillDate ? "default" : "outline"}
          size="sm"
          onClick={() => setTillDate((v) => !v)}
        >
          {tillDate ? "Till date (through today)" : "By month"}
        </Button>
        {!tillDate && <MonthPicker value={month} onChange={setMonth} />}
        <Input
          placeholder="Filter by seller..."
          value={soldByFilter}
          onChange={(e) => setSoldByFilter(e.target.value)}
          className="w-48"
        />
      </div>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
        <StatCard label="Total Sales" value={inr(summary.totalSales)} />
        <StatCard label="Total Profit" value={inr(summary.totalProfit)} />
      </div>

      {/* Product-wise breakdown */}
      {byProduct.length > 0 && (
        <div className="surface-card mb-4">
          <p className="border-b border-border px-4 py-2 text-sm font-medium">Product-wise sales</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Total Sales</TableHead>
                <TableHead className="text-right">Total Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byProduct.map((p) => (
                <TableRow key={p.product_id}>
                  <TableCell className="font-medium">{p.product_name}</TableCell>
                  <TableCell className="text-right">{p.quantity}</TableCell>
                  <TableCell className="num text-right">{inr(p.total_sales)}</TableCell>
                  <TableCell className="num text-right">{inr(p.total_profit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sales list */}
      <div className="surface-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-sm font-medium">
            {rows.length} sale{rows.length !== 1 ? "s" : ""}
          </span>
          <Can resource={RESOURCES.directSelling} action="create">
            <Button size="sm" onClick={openAdd}>
              <Plus className="mr-1 size-4" /> New Sale
            </Button>
          </Can>
        </div>
        {isLoading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No sales recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Sold By</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="whitespace-nowrap">{dateLabel(sale.sold_date)}</TableCell>
                  <TableCell>{sale.product_name}</TableCell>
                  <TableCell>{sale.sold_by}</TableCell>
                  <TableCell className="text-right">{sale.quantity}</TableCell>
                  <TableCell className="num text-right">{inr(sale.selling_price)}</TableCell>
                  <TableCell className="num text-right">{inr(sale.profit)}</TableCell>
                  <TableCell className="num text-right">{inr(sale.payment_amount)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[sale.payment_status]}>
                      {STATUS_LABELS[sale.payment_status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Can resource={RESOURCES.directSelling} action="update">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(sale)}>
                          <Pencil className="size-4" />
                        </Button>
                      </Can>
                      <Can resource={RESOURCES.directSelling} action="delete">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeletingId(sale.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Sale" : "Record Direct Sale"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {/* Product */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right">Product</Label>
              <div className="col-span-2">
                <Select
                  value={form.product_id}
                  onValueChange={(val) => {
                    const p = activeProducts.find((x) => x.id === val);
                    if (p) applyProduct(p, form.quantity);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Quantity */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right">Quantity</Label>
              <Input
                type="number"
                min={1}
                className="col-span-2"
                value={form.quantity}
                onChange={(e) => {
                  const qty = Math.max(1, Number(e.target.value));
                  const p = activeProducts.find((x) => x.id === form.product_id);
                  if (p) {
                    applyProduct(p, qty);
                  } else {
                    setForm((f) => ({ ...f, quantity: qty }));
                  }
                }}
              />
            </div>
            {/* Sold By */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right">Sold By</Label>
              <Input
                className="col-span-2"
                value={form.sold_by}
                onChange={(e) => setForm((f) => ({ ...f, sold_by: e.target.value }))}
              />
            </div>
            {/* Sold Date */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right">Date</Label>
              <Input
                type="date"
                className="col-span-2"
                value={form.sold_date}
                onChange={(e) => setForm((f) => ({ ...f, sold_date: e.target.value }))}
              />
            </div>
            {/* Cost fields */}
            {(
              [
                ["selling_price", "Selling Price"],
                ["production_cost", "Production Cost"],
                ["label_cost", "Label Cost"],
                ["jar_pouch_cost", "Jar & Pouch Cost"],
              ] as const
            ).map(([key, lbl]) => (
              <div key={key} className="grid grid-cols-3 items-center gap-2">
                <Label className="text-right">{lbl}</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  className="col-span-2 num text-right"
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
                />
              </div>
            ))}
            {/* Profit (read-only) */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right text-muted-foreground">Profit</Label>
              <div className="col-span-2 num px-3 py-2 text-right font-medium">{inr(profit)}</div>
            </div>
            {/* Payment Amount */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right">Payment Recd.</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                className="col-span-2 num text-right"
                value={form.payment_amount}
                onChange={(e) => setForm((f) => ({ ...f, payment_amount: Number(e.target.value) }))}
              />
            </div>
            {/* Payment Status */}
            <div className="grid grid-cols-3 items-center gap-2">
              <Label className="text-right">Payment Status</Label>
              <div className="col-span-2">
                <Select
                  value={form.payment_status}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, payment_status: v as "paid" | "partial" | "unpaid" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || !form.product_id || !form.sold_by}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : editingId ? "Update" : "Record Sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sale?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => deletingId && remove.mutate(deletingId)}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
