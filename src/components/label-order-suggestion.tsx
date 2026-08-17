import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";

import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  labelProductsQuery,
  labelOrderSuggestionsQuery,
  type LabelOrderSuggestionRow,
} from "@/lib/queries";
import { nextOrderNo } from "@/lib/records";
import {
  getProcurementDates,
  labelSuggestionStatusLabel,
  labelsFromSheets,
  monthKey,
  type LabelSuggestionStatus,
} from "@/lib/domain";
import { dateLabel, inr, num, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_RANK: Record<LabelSuggestionStatus, number> = {
  emergency: 0,
  order_recommended: 1,
  watch: 2,
  no_order: 3,
};

const STATUS_DOT: Record<LabelSuggestionStatus, string> = {
  emergency: "🔴",
  order_recommended: "🟠",
  watch: "🟡",
  no_order: "🟢",
};

const STATUS_BADGE_CLASS: Record<LabelSuggestionStatus, string> = {
  emergency: "border-transparent bg-destructive text-destructive-foreground",
  order_recommended: "border-transparent bg-warning text-warning-foreground",
  watch: "border-transparent bg-secondary text-secondary-foreground",
  no_order: "border-transparent bg-muted text-muted-foreground",
};

type ShopGroup = {
  shopId: string;
  shopName: string;
  shopCode: string;
  rollupStatus: LabelSuggestionStatus;
  rowByLabelProduct: Map<string, LabelOrderSuggestionRow>;
};

const cellKey = (shopId: string, labelProductId: string) => `${shopId}:${labelProductId}`;

/**
 * Label Order Suggestion tab — sits beside the existing Label Orders tab.
 * Reads label_order_suggestions() for the recommendation, renders it in the
 * exact printer-facing column layout as the existing Label Orders table, and
 * on "Place Order" reuses the existing shop-specific label_orders /
 * label_order_lines insert + nextOrderNo() logic — no separate ordering
 * mechanism, and every order still shows up under Label Orders.
 */
export function LabelOrderSuggestionTab({
  onOrdersPlaced,
}: {
  onOrdersPlaced?: (month: string) => void;
}) {
  const qc = useQueryClient();
  const { planningDate, nextProcurementDate } = useMemo(() => getProcurementDates(), []);
  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const {
    data: rows = [],
    isLoading,
    refetch,
  } = useQuery(labelOrderSuggestionsQuery(nextProcurementDate));

  // Only ever populated by explicit user action — never overwritten by a refetch,
  // only cleared via the confirmed "Regenerate Suggestions" action.
  const [edited, setEdited] = useState<Record<string, number>>({});
  const [includeOverride, setIncludeOverride] = useState<Record<string, boolean>>({});
  const [showWatch, setShowWatch] = useState(false);
  const [expandedShop, setExpandedShop] = useState<string | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);

  const groups: ShopGroup[] = useMemo(() => {
    const byShop = new Map<string, ShopGroup>();
    for (const r of rows) {
      let g = byShop.get(r.shop_id);
      if (!g) {
        g = {
          shopId: r.shop_id,
          shopName: r.shop_name,
          shopCode: r.shop_code,
          rollupStatus: "no_order",
          rowByLabelProduct: new Map(),
        };
        byShop.set(r.shop_id, g);
      }
      g.rowByLabelProduct.set(r.label_product_id, r);
      if (STATUS_RANK[r.status] < STATUS_RANK[g.rollupStatus]) g.rollupStatus = r.status;
    }
    return Array.from(byShop.values()).sort(
      (a, b) =>
        STATUS_RANK[a.rollupStatus] - STATUS_RANK[b.rollupStatus] ||
        a.shopName.localeCompare(b.shopName),
    );
  }, [rows]);

  const visibleGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          g.rollupStatus === "emergency" ||
          g.rollupStatus === "order_recommended" ||
          (showWatch && g.rollupStatus === "watch"),
      ),
    [groups, showWatch],
  );

  const isIncluded = (g: ShopGroup) =>
    includeOverride[g.shopId] ??
    (g.rollupStatus === "emergency" || g.rollupStatus === "order_recommended");

  const finalQty = (row: LabelOrderSuggestionRow) =>
    edited[cellKey(row.shop_id, row.label_product_id)] ?? row.suggested_sheets;

  const totals = useMemo(() => {
    let shopsCount = 0;
    let designsCount = 0;
    let sheets = 0;
    let labels = 0;
    let sheetCost = 0;
    for (const g of visibleGroups) {
      const included =
        includeOverride[g.shopId] ??
        (g.rollupStatus === "emergency" || g.rollupStatus === "order_recommended");
      if (!included) continue;
      let shopHasSheets = false;
      for (const lp of labelProducts) {
        const row = g.rowByLabelProduct.get(lp.id);
        if (!row) continue;
        const qty = edited[cellKey(g.shopId, lp.id)] ?? row.suggested_sheets;
        if (qty > 0) {
          shopHasSheets = true;
          designsCount += 1;
          sheets += qty;
          labels += labelsFromSheets(qty, row.labels_per_sheet);
          sheetCost += qty * row.sheet_cost;
        }
      }
      if (shopHasSheets) shopsCount += 1;
    }
    const orderCharges = 0; // No existing per-order charge rule to preserve — kept as its own line for clarity.
    return {
      shopsCount,
      designsCount,
      sheets,
      labels,
      sheetCost,
      orderCharges,
      total: sheetCost + orderCharges,
    };
  }, [visibleGroups, labelProducts, edited, includeOverride]);

  const regenerate = () => {
    setEdited({});
    setIncludeOverride({});
    void refetch();
    setRegenerateOpen(false);
    toast.success("Suggestions regenerated");
  };

  const placeOrders = useMutation({
    mutationFn: async () => {
      const shopsToOrder = visibleGroups.filter(isIncluded);

      let placed = 0;
      for (const g of shopsToOrder) {
        const lines = labelProducts
          .map((lp) => {
            const row = g.rowByLabelProduct.get(lp.id);
            if (!row) return null;
            const qty = finalQty(row);
            if (qty <= 0) return null;
            return {
              label_product_id: lp.id,
              sheets: qty,
              products: labelsFromSheets(qty, row.labels_per_sheet),
            };
          })
          .filter(
            (l): l is { label_product_id: string; sheets: number; products: number } => l !== null,
          );
        if (lines.length === 0) continue;

        const totalLabels = lines.reduce((a, l) => a + l.products, 0);
        const orderNo = await nextOrderNo("label_orders", g.shopId);
        const { data, error } = await supabase
          .from("label_orders")
          .insert({
            shop_id: g.shopId,
            order_no: orderNo,
            order_date: todayISO(),
            total_labels: totalLabels,
          })
          .select("id")
          .single();
        if (error) throw new Error(`${g.shopName}: ${error.message}`);

        const { error: lineError } = await supabase
          .from("label_order_lines")
          .insert(lines.map((l) => ({ label_order_id: (data as { id: string }).id, ...l })));
        if (lineError) throw new Error(`${g.shopName}: ${lineError.message}`);
        placed += 1;
      }
      return placed;
    },
    onSuccess: (placed) => {
      toast.success(`Placed ${placed} label order${placed === 1 ? "" : "s"}`);
      setPlaceOpen(false);
      setEdited({});
      setIncludeOverride({});
      void qc.invalidateQueries({ queryKey: ["label_orders"] });
      void qc.invalidateQueries({ queryKey: ["label_stock"] });
      void qc.invalidateQueries({ queryKey: ["label_stock_summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
      void qc.invalidateQueries({ queryKey: ["available_months"] });
      void qc.invalidateQueries({ queryKey: ["label_order_suggestions"] });
      onOrdersPlaced?.(monthKey(todayISO()));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const colSpan = labelProducts.length + 3;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Label Order Suggestion</h2>
          <p className="text-xs text-muted-foreground">
            Planning date: {dateLabel(planningDate)} · Next procurement:{" "}
            {dateLabel(nextProcurementDate)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="show-watch" checked={showWatch} onCheckedChange={setShowWatch} />
            <Label htmlFor="show-watch" className="text-xs">
              Show Watch items
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRegenerateOpen(true)}>
            <RotateCcw className="size-4" /> Regenerate Suggestions
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Shops requiring labels" value={String(totals.shopsCount)} />
        <StatCard label="Label designs" value={String(totals.designsCount)} />
        <StatCard label="Total sheets" value={num(totals.sheets)} tone="accent" />
        <StatCard label="Estimated sheet cost" value={inr(totals.sheetCost, 2)} />
        <StatCard label="Estimated order charges" value={inr(totals.orderCharges, 2)} />
        <StatCard label="Estimated total" value={inr(totals.total, 2)} tone="accent" />
      </div>

      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead className="w-10"></TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Status</TableHead>
                {labelProducts.map((lp) => (
                  <TableHead key={lp.id} className="text-right">
                    {lp.short_name}
                  </TableHead>
                ))}
                <TableHead className="text-right">Labels</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">
                    Calculating suggestions…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && visibleGroups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="py-12 text-center text-muted-foreground">
                    No shops currently need label orders.
                  </TableCell>
                </TableRow>
              )}
              {visibleGroups.map((g) => {
                const rowLabels = labelProducts.reduce((a, lp) => {
                  const row = g.rowByLabelProduct.get(lp.id);
                  if (!row) return a;
                  const qty = finalQty(row);
                  return a + (qty > 0 ? labelsFromSheets(qty, row.labels_per_sheet) : 0);
                }, 0);
                const isExpanded = expandedShop === g.shopId;
                return (
                  <Fragment key={g.shopId}>
                    <TableRow>
                      <TableCell>
                        <Checkbox
                          checked={isIncluded(g)}
                          onCheckedChange={(checked) =>
                            setIncludeOverride((prev) => ({
                              ...prev,
                              [g.shopId]: checked === true,
                            }))
                          }
                          aria-label={`Include ${g.shopName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setExpandedShop(isExpanded ? null : g.shopId)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={isExpanded ? "Collapse details" : "Show why"}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{g.shopName}</TableCell>
                      <TableCell>
                        <Badge className={cn(STATUS_BADGE_CLASS[g.rollupStatus])}>
                          {STATUS_DOT[g.rollupStatus]} {labelSuggestionStatusLabel(g.rollupStatus)}
                        </Badge>
                      </TableCell>
                      {labelProducts.map((lp) => {
                        const row = g.rowByLabelProduct.get(lp.id);
                        if (!row) {
                          return (
                            <TableCell key={lp.id} className="num text-right text-muted-foreground">
                              —
                            </TableCell>
                          );
                        }
                        const key = cellKey(g.shopId, lp.id);
                        const qty = finalQty(row);
                        const isEdited = edited[key] !== undefined;
                        return (
                          <TableCell key={lp.id} className="text-right">
                            <Input
                              type="number"
                              min={0}
                              step="1"
                              value={qty}
                              onChange={(e) =>
                                setEdited((prev) => ({
                                  ...prev,
                                  [key]: e.target.value === "" ? 0 : Number(e.target.value),
                                }))
                              }
                              className={cn(
                                "num ml-auto h-8 w-16 text-right",
                                isEdited && "border-warning ring-1 ring-warning/50",
                              )}
                              title={
                                isEdited ? `System suggested ${row.suggested_sheets}` : undefined
                              }
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="num text-right font-semibold">
                        {num(rowLabels)}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${g.shopId}-detail`}>
                        <TableCell colSpan={colSpan} className="bg-secondary/30 p-4">
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {labelProducts.map((lp) => {
                              const row = g.rowByLabelProduct.get(lp.id);
                              if (!row) return null;
                              return (
                                <div key={lp.id} className="surface-card p-3 text-xs">
                                  <p className="mb-1.5 flex items-center justify-between font-semibold">
                                    <span>{lp.short_name}</span>
                                    <Badge
                                      className={cn(STATUS_BADGE_CLASS[row.status], "text-[10px]")}
                                    >
                                      {STATUS_DOT[row.status]}{" "}
                                      {labelSuggestionStatusLabel(row.status)}
                                    </Badge>
                                  </p>
                                  <div className="num space-y-0.5 text-muted-foreground">
                                    <Row label="Current stock" value={num(row.current_stock)} />
                                    <Row
                                      label="Monthly consumption"
                                      value={`${num(row.monthly_forecast)}${row.has_limited_history ? " (limited history)" : ""}`}
                                    />
                                    <Row
                                      label="2-month requirement"
                                      value={num(row.two_month_requirement)}
                                    />
                                    <Row label="Safety buffer" value={num(row.safety_buffer)} />
                                    <Row label="Target" value={num(row.target_stock)} />
                                    <Row
                                      label="Additional requirement"
                                      value={num(row.additional_requirement)}
                                    />
                                    <Row
                                      label="Labels per sheet"
                                      value={num(row.labels_per_sheet)}
                                    />
                                    <Row
                                      label="Suggested"
                                      value={`${num(row.suggested_sheets)} sheets`}
                                    />
                                    {row.is_growth && (
                                      <Row label="Trend" value="High growth in recent orders" />
                                    )}
                                    {row.is_emergency && row.projected_stockout_date && (
                                      <Row
                                        label="Projected stockout"
                                        value={dateLabel(row.projected_stockout_date)}
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-end border-t border-border p-3">
          <Button onClick={() => setPlaceOpen(true)} disabled={totals.sheets === 0}>
            <Send className="size-4" /> Place Order
          </Button>
        </div>
      </div>

      <AlertDialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate suggestions?</AlertDialogTitle>
            <AlertDialogDescription>
              Regenerating suggestions will replace your current manual edits. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={regenerate}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={placeOpen} onOpenChange={setPlaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Label Order</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="num space-y-1 pt-2 text-sm text-foreground">
                <Row label="Planning date" value={dateLabel(planningDate)} />
                <Row label="Shops" value={String(totals.shopsCount)} />
                <Row label="Label designs" value={String(totals.designsCount)} />
                <Row label="Total sheets" value={num(totals.sheets)} />
                <Row label="Total labels" value={num(totals.labels)} />
                <Row label="Estimated sheet cost" value={inr(totals.sheetCost, 2)} />
                <Row label="Estimated order charges" value={inr(totals.orderCharges, 2)} />
                <Row label="Estimated total" value={inr(totals.total, 2)} />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => placeOrders.mutate()}
              disabled={placeOrders.isPending}
            >
              Place Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
