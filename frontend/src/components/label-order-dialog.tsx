import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { ShopAreaFilter } from "@/components/filter-bar";
import { SearchableShopSelect } from "@/components/shop-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { labelOrdersApi } from "@/services/klinzo.service";
import {
  labelOrderSuggestionsQuery,
  labelProductsQuery,
  labelStockQuery,
  shopsQuery,
} from "@/lib/queries";
import { labelsFromSheets } from "@/lib/domain";
import { inr, num, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One label the selected shop is running short of. */
type RefillItem = {
  labelProductId: string;
  name: string;
  stock: number;
  threshold: number;
  labelsPerSheet: number;
  suggestedSheets: number;
};

/**
 * The New Label Order form — the single form every label order is recorded
 * through, whether it is opened from the Label orders tab or from a shop's
 * row on the Stock dashboard.
 *
 * `presetShopId` opens it with that shop already chosen. Whichever way the
 * shop gets picked, any label it sells that is below its minimum stock shows
 * up in a "Refill stock" panel with the recommended sheets; a shop with
 * nothing low gets exactly the plain form.
 */
export function LabelOrderDialog({
  open,
  onOpenChange,
  presetShopId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetShopId?: string | null;
  /** Called with the saved order's date, e.g. to move the orders list to its month. */
  onSaved?: (orderDate: string) => void;
}) {
  const qc = useQueryClient();
  const [shopId, setShopId] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [orderDate, setOrderDate] = useState(todayISO());
  const [sheets, setSheets] = useState<Record<string, number>>({});
  /** The shop the refill figures were last copied in for, so it happens once. */
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);

  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: stockRows = [] } = useQuery({ ...labelStockQuery, enabled: open });
  const { data: suggestions = [] } = useQuery({ ...labelOrderSuggestionsQuery, enabled: open });

  // A fresh form on every open, starting from the row's shop when there is one.
  useEffect(() => {
    if (!open) return;
    const preset = presetShopId ? shops.find((s) => s.id === presetShopId) : undefined;
    setShopId(presetShopId ?? "");
    setAreaFilter(preset?.area_id ?? "all");
    setOrderDate(todayISO());
    setSheets({});
    setPrefilledFor(null);
    // `shops` is deliberately left out: a background refetch must not wipe
    // what the user has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetShopId]);

  /**
   * Low means below the same `low_stock_threshold` the stock table turns red
   * on, and only for labels the shop still sells. The sheet count comes from
   * the Label Order Suggestion engine when it has a figure for this label;
   * otherwise it is the fewest sheets that lift stock back to the minimum.
   */
  const refill = useMemo<RefillItem[]>(() => {
    if (!shopId) return [];
    const suggested = new Map(
      suggestions
        .filter((r) => r.shop_id === shopId)
        .map((r) => [r.label_product_id, r.suggested_sheets]),
    );
    return stockRows
      .filter((r) => r.shop_id === shopId && r.shop_sells_product && r.is_low)
      .map((r) => {
        const lp = labelProducts.find((p) => p.id === r.label_product_id);
        const perSheet = lp?.labels_per_sheet || 1;
        const shortfall = Math.max(0, r.low_stock_threshold - Number(r.stock));
        const fallback = Math.max(1, Math.ceil(shortfall / perSheet));
        return {
          labelProductId: r.label_product_id,
          name: lp?.short_name ?? r.label_product_name,
          stock: Number(r.stock),
          threshold: r.low_stock_threshold,
          labelsPerSheet: perSheet,
          suggestedSheets: suggested.get(r.label_product_id) || fallback,
        };
      })
      .sort(
        (a, b) =>
          (labelProducts.find((p) => p.id === a.labelProductId)?.sort_order ?? 0) -
          (labelProducts.find((p) => p.id === b.labelProductId)?.sort_order ?? 0),
      );
  }, [shopId, stockRows, suggestions, labelProducts]);

  const refillIds = useMemo(() => new Set(refill.map((r) => r.labelProductId)), [refill]);

  const applySuggested = () =>
    setSheets((current) => ({
      ...current,
      ...Object.fromEntries(refill.map((r) => [r.labelProductId, r.suggestedSheets])),
    }));

  // Opened from a stock row, the point is refilling that shop — so its
  // shortfall is copied in once, as soon as the figures arrive. Every value
  // stays editable, and nothing is saved until "Save label order".
  useEffect(() => {
    if (!open || !presetShopId || shopId !== presetShopId) return;
    if (prefilledFor === shopId || refill.length === 0) return;
    applySuggested();
    setPrefilledFor(shopId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetShopId, shopId, refill, prefilledFor]);

  const totals = labelProducts.reduce(
    (acc, lp) => {
      const s = Number(sheets[lp.id]) || 0;
      acc.sheets += s;
      acc.labels += labelsFromSheets(s, lp.labels_per_sheet);
      acc.cost += s * lp.sheet_cost;
      return acc;
    },
    { sheets: 0, labels: 0, cost: 0 },
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!shopId) throw new Error("Choose a shop");
      // Order numbering and the labels-produced figure are the server's job,
      // so two people saving at once can't land on the same order number.
      await labelOrdersApi.create({
        shop_id: shopId,
        order_date: orderDate,
        lines: labelProducts
          .filter((lp) => (sheets[lp.id] ?? 0) > 0)
          .map((lp) => ({ label_product_id: lp.id, sheets: sheets[lp.id] })),
      });
    },
    onSuccess: () => {
      toast.success("Label order recorded");
      onOpenChange(false);
      for (const key of [
        "label_orders",
        "label_stock",
        "label_stock_summary",
        "label_order_suggestions",
        "dashboard_summary",
        "available_months",
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      onSaved?.(orderDate);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New label order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Shop area</Label>
              <ShopAreaFilter
                value={areaFilter}
                onChange={(area) => {
                  setAreaFilter(area);
                  setShopId("");
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Shop</Label>
              <SearchableShopSelect
                value={shopId}
                onChange={setShopId}
                areaId={areaFilter !== "all" ? areaFilter : null}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Order date</Label>
            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </div>
        </div>

        {refill.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" /> Refill stock
              </p>
              <Button type="button" variant="outline" size="sm" onClick={applySuggested}>
                Use suggested sheets
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="num w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-1 text-left font-medium">Label</th>
                    <th className="py-1 text-right font-medium">In stock</th>
                    <th className="py-1 text-right font-medium">Minimum</th>
                    <th className="py-1 text-right font-medium">Short by</th>
                    <th className="py-1 text-right font-medium">Suggested sheets</th>
                  </tr>
                </thead>
                <tbody>
                  {refill.map((r) => (
                    <tr key={r.labelProductId} className="border-t border-destructive/20">
                      <td className="py-1.5 font-medium">{r.name}</td>
                      <td className="py-1.5 text-right text-destructive">{num(r.stock)}</td>
                      <td className="py-1.5 text-right">{num(r.threshold)}</td>
                      <td className="py-1.5 text-right">
                        {num(Math.max(0, r.threshold - r.stock))}
                      </td>
                      <td className="py-1.5 text-right font-semibold">
                        {num(r.suggestedSheets)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          = {num(r.suggestedSheets * r.labelsPerSheet)} labels
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sheets printed
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {labelProducts.map((lp) => (
              <div key={lp.id} className="space-y-1.5">
                <Label className="text-xs" htmlFor={`sheet-${lp.id}`}>
                  {lp.short_name}{" "}
                  <span className="text-muted-foreground">×{num(lp.labels_per_sheet)}</span>
                  {refillIds.has(lp.id) && (
                    <span className="ml-1 font-medium text-destructive">· refill</span>
                  )}
                </Label>
                <Input
                  id={`sheet-${lp.id}`}
                  type="number"
                  min={0}
                  className={cn("num", refillIds.has(lp.id) && "border-destructive/60")}
                  value={sheets[lp.id] ?? ""}
                  onChange={(e) =>
                    setSheets({
                      ...sheets,
                      [lp.id]: e.target.value === "" ? 0 : Number(e.target.value),
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <div className="num grid grid-cols-3 gap-2 rounded-lg bg-secondary p-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Sheets</p>
            <p className="font-medium">{num(totals.sheets)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Labels</p>
            <p className="font-medium">{num(totals.labels)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Printing cost</p>
            <p className="font-medium">{inr(totals.cost, 2)}</p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={!shopId || create.isPending}>
            Save label order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
