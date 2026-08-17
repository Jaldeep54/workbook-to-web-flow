import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RotateCcw, Send, X } from "lucide-react";
import { toast } from "sonner";

import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  labelStockQuery,
  shopsQuery,
  type LabelOrderSuggestionRow,
} from "@/lib/queries";
import { nextOrderNo } from "@/lib/records";
import {
  LABEL_SUGGESTION_HISTORY_MONTHS,
  labelSuggestionStatusLabel,
  labelsFromSheets,
  monthKey,
  type LabelSuggestionStatus,
} from "@/lib/domain";
import { dateLabel, inr, num, todayISO } from "@/lib/format";
import { shopLabel } from "@/components/filter-bar";
import { cn } from "@/lib/utils";

const STATUS_RANK: Record<LabelSuggestionStatus, number> = {
  urgent: 0,
  recommended: 1,
  monitor: 2,
  no_order_required: 3,
};

const STATUS_DOT: Record<LabelSuggestionStatus, string> = {
  urgent: "🔴",
  recommended: "🟠",
  monitor: "🟡",
  no_order_required: "🟢",
};

const STATUS_BADGE_CLASS: Record<LabelSuggestionStatus, string> = {
  urgent: "border-transparent bg-destructive text-destructive-foreground",
  recommended: "border-transparent bg-warning text-warning-foreground",
  monitor: "border-transparent bg-secondary text-secondary-foreground",
  no_order_required: "border-transparent bg-muted text-muted-foreground",
};

type ShopGroup = {
  shopId: string;
  shopName: string;
  shopCode: string;
  rollupStatus: LabelSuggestionStatus;
  rowByLabelProduct: Map<string, LabelOrderSuggestionRow>;
  /** Added by the user via "Add a shop manually" — not a system suggestion, always shown. */
  manual: boolean;
};

const cellKey = (shopId: string, labelProductId: string) => `${shopId}:${labelProductId}`;

/** Plain-language explanation for the breakdown panel's "Why?" section. */
function reasonFor(row: LabelOrderSuggestionRow): string {
  let base: string;
  switch (row.status) {
    case "urgent":
      base = "Current stock is below the low stock threshold.";
      break;
    case "recommended":
      base = "Current stock is below the 1-month target.";
      break;
    case "monitor":
      base = "Current stock is below the 2-month target.";
      break;
    default:
      base = "Current stock meets the 2-month target.";
  }
  if (row.has_stock_data_issue) {
    base +=
      " Stock data issue: recorded stock is negative (test data) — treated as zero for this recommendation.";
  }
  return base;
}

const emptyLabelRow = (
  shopId: string,
  shopName: string,
  labelProduct: {
    id: string;
    key: string;
    name: string;
    short_name: string;
    sort_order: number;
    product_id: string;
    labels_per_sheet: number;
    sheet_cost: number;
    low_stock_threshold: number;
  },
  currentStock: number,
): LabelOrderSuggestionRow => ({
  shop_id: shopId,
  shop_name: shopName,
  shop_code: "",
  label_product_id: labelProduct.id,
  label_product_key: labelProduct.key,
  label_product_name: labelProduct.name,
  label_product_short_name: labelProduct.short_name,
  label_product_sort_order: labelProduct.sort_order,
  product_id: labelProduct.product_id,
  labels_per_sheet: labelProduct.labels_per_sheet,
  sheet_cost: labelProduct.sheet_cost,
  low_stock_threshold: labelProduct.low_stock_threshold,
  current_stock: currentStock,
  has_stock_data_issue: currentStock < 0,
  avg_monthly_usage: 0,
  one_month_target: labelProduct.low_stock_threshold,
  two_month_target: labelProduct.low_stock_threshold,
  additional_required: 0,
  suggested_sheets: 0,
  expected_stock_after_order: currentStock,
  status: "no_order_required",
});

/**
 * Label Order Suggestion tab — sits beside the existing Label Orders tab.
 * Reads label_order_suggestions() for the recommendation, renders it in the
 * exact printer-facing column layout as the existing Label Orders table, and
 * on "Place Selected Orders" reuses the existing shop-specific label_orders /
 * label_order_lines insert + nextOrderNo() logic — no separate ordering
 * mechanism, and every order still shows up under Label Orders.
 */
export function LabelOrderSuggestionTab({
  onOrdersPlaced,
}: {
  onOrdersPlaced?: (month: string) => void;
}) {
  const qc = useQueryClient();
  const { data: labelProducts = [] } = useQuery(labelProductsQuery);
  const { data: shops = [] } = useQuery(shopsQuery);
  const { data: labelStock = [] } = useQuery(labelStockQuery);
  const { data: rows = [], isLoading, refetch } = useQuery(labelOrderSuggestionsQuery);

  // Only ever populated by explicit user action — never overwritten by a refetch,
  // only cleared via the confirmed "Regenerate Suggestions" action.
  const [edited, setEdited] = useState<Record<string, number>>({});
  const [includeOverride, setIncludeOverride] = useState<Record<string, boolean>>({});
  const [manualShopIds, setManualShopIds] = useState<string[]>([]);
  const [addShopValue, setAddShopValue] = useState("");
  const [expandedShop, setExpandedShop] = useState<string | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [orderDate, setOrderDate] = useState(todayISO());

  const stockByShopLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of labelStock) m.set(cellKey(r.shop_id, r.label_product_id), Number(r.stock));
    return m;
  }, [labelStock]);

  // Shop-level status is deliberately NOT "the worst individual product status" —
  // a red/urgent product is only the trigger to review the whole shop. Once
  // triggered (or even without an urgent trigger), every product the shop
  // carries that's below ITS OWN 2-month target belongs in one consolidated
  // recommendation, so the printer only has to visit each shop once:
  //   any product below its low-stock threshold      -> shop is Urgent
  //   else any product below its 2-month target       -> shop is Recommended
  //   else (every product at/above its 2-month target) -> shop is No Order Required
  const groups: ShopGroup[] = useMemo(() => {
    const byShop = new Map<string, ShopGroup>();
    for (const r of rows) {
      let g = byShop.get(r.shop_id);
      if (!g) {
        g = {
          shopId: r.shop_id,
          shopName: r.shop_name,
          shopCode: r.shop_code,
          rollupStatus: "no_order_required",
          rowByLabelProduct: new Map(),
          manual: false,
        };
        byShop.set(r.shop_id, g);
      }
      g.rowByLabelProduct.set(r.label_product_id, r);
    }
    for (const g of byShop.values()) {
      const products = Array.from(g.rowByLabelProduct.values());
      const hasUrgent = products.some((r) => r.status === "urgent");
      const hasBelowTwoMonthTarget = products.some((r) => r.status !== "no_order_required");
      g.rollupStatus = hasUrgent
        ? "urgent"
        : hasBelowTwoMonthTarget
          ? "recommended"
          : "no_order_required";
    }
    // Shops added via "Add a shop manually" that the system didn't already
    // flag — synthesized as empty, editable rows for every label product.
    for (const shopId of manualShopIds) {
      if (byShop.has(shopId)) continue; // already a real suggestion — don't shadow it
      const shop = shops.find((s) => s.id === shopId);
      if (!shop) continue;
      const rowByLabelProduct = new Map<string, LabelOrderSuggestionRow>();
      for (const lp of labelProducts) {
        rowByLabelProduct.set(
          lp.id,
          emptyLabelRow(
            shopId,
            shop.shop_name,
            lp,
            stockByShopLabel.get(cellKey(shopId, lp.id)) ?? 0,
          ),
        );
      }
      byShop.set(shopId, {
        shopId,
        shopName: shop.shop_name,
        shopCode: shop.code,
        rollupStatus: "no_order_required",
        rowByLabelProduct,
        manual: true,
      });
    }
    return Array.from(byShop.values()).sort(
      (a, b) =>
        Number(a.manual) - Number(b.manual) ||
        STATUS_RANK[a.rollupStatus] - STATUS_RANK[b.rollupStatus] ||
        a.shopName.localeCompare(b.shopName),
    );
  }, [rows, manualShopIds, shops, labelProducts, stockByShopLabel]);

  // No-order shops are never shown (unless manually added) — everything
  // visible needs action.
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.manual || g.rollupStatus !== "no_order_required"),
    [groups],
  );

  const suggestionGroups = useMemo(() => visibleGroups.filter((g) => !g.manual), [visibleGroups]);

  const isIncluded = (g: ShopGroup) => includeOverride[g.shopId] ?? true;

  const finalQty = (row: LabelOrderSuggestionRow) =>
    edited[cellKey(row.shop_id, row.label_product_id)] ?? row.suggested_sheets;

  const addableShops = useMemo(() => {
    const present = new Set(groups.map((g) => g.shopId));
    return shops
      .filter((s) => s.is_active && !present.has(s.id))
      .sort((a, b) => a.shop_name.localeCompare(b.shop_name));
  }, [groups, shops]);

  const totals = useMemo(() => {
    let recommendedSheets = 0;
    for (const g of suggestionGroups) {
      for (const lp of labelProducts) {
        const row = g.rowByLabelProduct.get(lp.id);
        if (row) recommendedSheets += row.suggested_sheets;
      }
    }

    let selectedSuggestions = 0;
    let sheets = 0;
    let labels = 0;
    let sheetCost = 0;
    for (const g of visibleGroups) {
      const included = includeOverride[g.shopId] ?? true;
      if (!included) continue;
      selectedSuggestions += 1;
      for (const lp of labelProducts) {
        const row = g.rowByLabelProduct.get(lp.id);
        if (!row) continue;
        const qty = edited[cellKey(g.shopId, lp.id)] ?? row.suggested_sheets;
        if (qty > 0) {
          sheets += qty;
          labels += labelsFromSheets(qty, row.labels_per_sheet);
          sheetCost += qty * row.sheet_cost;
        }
      }
    }
    const orderCharges = 0; // No existing per-order charge rule to preserve — kept as its own line for clarity.
    return {
      suggestions: suggestionGroups.length,
      selectedSuggestions,
      recommendedSheets,
      sheets,
      labels,
      sheetCost,
      orderCharges,
      total: sheetCost + orderCharges,
    };
  }, [visibleGroups, suggestionGroups, labelProducts, edited, includeOverride]);

  const selectAll = () =>
    setIncludeOverride((prev) => {
      const next = { ...prev };
      for (const g of visibleGroups) next[g.shopId] = true;
      return next;
    });

  const deselectAll = () =>
    setIncludeOverride((prev) => {
      const next = { ...prev };
      for (const g of visibleGroups) next[g.shopId] = false;
      return next;
    });

  const selectRecommended = () =>
    setIncludeOverride((prev) => {
      const next = { ...prev };
      for (const g of visibleGroups) {
        next[g.shopId] = g.manual
          ? (prev[g.shopId] ?? true)
          : g.rollupStatus === "urgent" || g.rollupStatus === "recommended";
      }
      return next;
    });

  const regenerate = () => {
    setEdited({});
    setIncludeOverride({});
    setManualShopIds([]);
    void refetch();
    setRegenerateOpen(false);
    toast.success("Suggestions regenerated");
  };

  const openPlaceOrders = () => {
    setOrderDate(todayISO());
    setPlaceOpen(true);
  };

  const placeOrders = useMutation({
    mutationFn: async (chosenOrderDate: string) => {
      const shopsToOrder = visibleGroups.filter(isIncluded);
      const successes: string[] = [];
      const failures: { shopName: string; message: string }[] = [];

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

        try {
          const totalLabels = lines.reduce((a, l) => a + l.products, 0);
          const orderNo = await nextOrderNo("label_orders", g.shopId);
          const { data, error } = await supabase
            .from("label_orders")
            .insert({
              shop_id: g.shopId,
              order_no: orderNo,
              order_date: chosenOrderDate,
              total_labels: totalLabels,
            })
            .select("id")
            .single();
          if (error) throw new Error(error.message);

          const { error: lineError } = await supabase
            .from("label_order_lines")
            .insert(lines.map((l) => ({ label_order_id: (data as { id: string }).id, ...l })));
          if (lineError) throw new Error(lineError.message);
          successes.push(g.shopId);
        } catch (e) {
          failures.push({
            shopName: g.shopName,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return { successes, failures, orderDate: chosenOrderDate };
    },
    onSuccess: ({ successes, failures, orderDate: placedDate }) => {
      if (successes.length > 0) {
        toast.success(
          `Placed ${successes.length} label order${successes.length === 1 ? "" : "s"} dated ${dateLabel(placedDate)}`,
        );
      }
      if (failures.length > 0) {
        toast.error(
          `${failures.length} order${failures.length === 1 ? "" : "s"} failed: ${failures
            .map((f) => `${f.shopName} (${f.message})`)
            .join("; ")}`,
        );
      }
      // Failed shops stay selected, with their edits intact, so the user can
      // retry them by clicking Confirm again. Succeeded shops are explicitly
      // force-deselected (not just cleared to default) so a retry — or the
      // still-open dialog's own Confirm button — can never resubmit them
      // before the suggestion list has had a chance to refetch and drop them.
      const succeededSet = new Set(successes);
      setEdited((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([key]) => !succeededSet.has(key.split(":")[0])),
        ),
      );
      setIncludeOverride((prev) => {
        const next = { ...prev };
        for (const id of succeededSet) next[id] = false;
        return next;
      });
      setManualShopIds((prev) => prev.filter((id) => !succeededSet.has(id)));
      if (failures.length === 0) setPlaceOpen(false);
      void qc.invalidateQueries({ queryKey: ["label_orders"] });
      void qc.invalidateQueries({ queryKey: ["label_stock"] });
      void qc.invalidateQueries({ queryKey: ["label_stock_summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard_summary"] });
      void qc.invalidateQueries({ queryKey: ["available_months"] });
      void qc.invalidateQueries({ queryKey: ["label_order_suggestions"] });
      if (successes.length > 0) onOrdersPlaced?.(monthKey(placedDate));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const colSpan = labelProducts.length + 6;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Label Order Suggestion</h2>
          <p className="text-xs text-muted-foreground">
            One consolidated row per shop — every product below its 2-month target, not just the one
            that went red · Usage average from the last {LABEL_SUGGESTION_HISTORY_MONTHS} months
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRegenerateOpen(true)}>
          <RotateCcw className="size-4" /> Regenerate Suggestions
        </Button>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Suggestions" value={String(totals.suggestions)} />
        <StatCard
          label="Selected suggestions"
          value={String(totals.selectedSuggestions)}
          tone="accent"
        />
        <StatCard label="Recommended sheets" value={num(totals.recommendedSheets)} />
        <StatCard label="Selected sheets" value={num(totals.sheets)} tone="accent" />
        <StatCard label="Selected labels" value={num(totals.labels)} />
        <StatCard label="Estimated selected cost" value={inr(totals.total, 2)} tone="accent" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={selectAll}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={deselectAll}>
            Deselect All
          </Button>
          <Button variant="outline" size="sm" onClick={selectRecommended}>
            Select Recommended
          </Button>
          <span className="text-xs text-muted-foreground">
            {totals.selectedSuggestions} of {visibleGroups.length} selected
          </span>
        </div>
        <Select
          value={addShopValue}
          onValueChange={(v) => {
            setManualShopIds((prev) => (prev.includes(v) ? prev : [...prev, v]));
            setAddShopValue("");
          }}
        >
          <SelectTrigger className="w-[240px] bg-card">
            <SelectValue placeholder="+ Add a shop manually" />
          </SelectTrigger>
          <SelectContent>
            {addableShops.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No other shops</div>
            )}
            {addableShops.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {shopLabel(s.shop_name, s.label_name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                <TableHead className="w-10"></TableHead>
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
                const hasDataIssue = Array.from(g.rowByLabelProduct.values()).some(
                  (r) => r.has_stock_data_issue,
                );
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
                      <TableCell className="font-medium">
                        {g.shopName}
                        {hasDataIssue && (
                          <span
                            className="ml-1.5 text-xs text-destructive"
                            title="Negative stock recorded for this shop — treated as a data/test issue, not normal demand"
                          >
                            ⚠
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {g.manual ? (
                          <Badge className="border-transparent bg-secondary text-secondary-foreground">
                            Manual
                          </Badge>
                        ) : (
                          <Badge className={cn(STATUS_BADGE_CLASS[g.rollupStatus])}>
                            {STATUS_DOT[g.rollupStatus]}{" "}
                            {labelSuggestionStatusLabel(g.rollupStatus)}
                          </Badge>
                        )}
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
                      <TableCell>
                        {g.manual && (
                          <button
                            type="button"
                            onClick={() => {
                              setManualShopIds((prev) => prev.filter((id) => id !== g.shopId));
                              setIncludeOverride((prev) => {
                                const { [g.shopId]: _drop, ...rest } = prev;
                                return rest;
                              });
                            }}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${g.shopName}`}
                          >
                            <X className="size-4" />
                          </button>
                        )}
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
                                    {!g.manual && (
                                      <Badge
                                        className={cn(
                                          STATUS_BADGE_CLASS[row.status],
                                          "text-[10px]",
                                        )}
                                      >
                                        {STATUS_DOT[row.status]}{" "}
                                        {labelSuggestionStatusLabel(row.status)}
                                      </Badge>
                                    )}
                                  </p>
                                  <p className="mb-2 text-foreground">
                                    {g.manual
                                      ? "Manually added — enter the quantities to order for this shop."
                                      : reasonFor(row)}
                                  </p>
                                  <div className="num space-y-0.5 text-muted-foreground">
                                    <Row label="Current stock" value={num(row.current_stock)} />
                                    <Row
                                      label="Low stock threshold"
                                      value={num(row.low_stock_threshold)}
                                    />
                                    <Row
                                      label="Avg monthly usage"
                                      value={num(row.avg_monthly_usage)}
                                    />
                                    <Row label="1-month target" value={num(row.one_month_target)} />
                                    <Row label="2-month target" value={num(row.two_month_target)} />
                                    <Row
                                      label="Additional required"
                                      value={num(row.additional_required)}
                                    />
                                    <Row
                                      label="Labels per sheet"
                                      value={num(row.labels_per_sheet)}
                                    />
                                    <Row
                                      label="Suggested"
                                      value={`${num(row.suggested_sheets)} sheets`}
                                    />
                                    <Row
                                      label="Stock after order"
                                      value={num(row.expected_stock_after_order)}
                                    />
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
          <Button onClick={openPlaceOrders} disabled={totals.sheets === 0}>
            <Send className="size-4" /> Place Selected Orders
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
            <AlertDialogTitle>Place selected label orders</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="num space-y-1 pt-2 text-sm text-foreground">
                <Row label="Selected shops" value={String(totals.selectedSuggestions)} />
                <Row label="Total sheets" value={num(totals.sheets)} />
                <Row label="Total labels" value={num(totals.labels)} />
                <Row label="Estimated sheet cost" value={inr(totals.sheetCost, 2)} />
                <Row label="Estimated order charges" value={inr(totals.orderCharges, 2)} />
                <Row label="Estimated total" value={inr(totals.total, 2)} />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="place-order-date" className="text-xs">
              Order date
            </Label>
            <Input
              id="place-order-date"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Any date is allowed — this is not restricted to the 1st/16th planning cycle.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!orderDate) {
                  toast.error("Choose an order date");
                  return;
                }
                placeOrders.mutate(orderDate);
              }}
              disabled={placeOrders.isPending}
            >
              Confirm & Place Orders
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
