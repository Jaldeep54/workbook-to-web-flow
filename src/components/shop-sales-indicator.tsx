import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { shopAnalysisQuery } from "@/lib/queries";
import {
  getShopSalesPerformance,
  salesPerformanceLabel,
  type SalesPerformanceStatus,
} from "@/lib/domain";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";

const BADGE_CLASS: Record<SalesPerformanceStatus, string> = {
  very_good: "border-transparent bg-success text-success-foreground",
  good: "border-success/40 bg-success/10 text-success",
  low: "border-transparent bg-warning text-warning-foreground",
  very_low: "border-transparent bg-destructive text-destructive-foreground",
  no_area: "border-transparent bg-muted text-muted-foreground",
  insufficient_area_data: "border-transparent bg-muted text-muted-foreground",
  no_area_data: "border-transparent bg-muted text-muted-foreground",
};

const NO_DATA_MESSAGE: Record<"no_area" | "insufficient_area_data" | "no_area_data", string> = {
  no_area: "Assign this shop to a Shop Area to compare its performance.",
  insufficient_area_data: "No other shops in this shop's area yet to compare against.",
  no_area_data: "No shops in this area have recorded sales yet.",
};

/**
 * Compact "how is this shop doing against its area?" card for the New Order
 * form. Reads the exact same shop_analysis() data (and the exact same
 * getShopSalesPerformance() thresholds) as the Shop Analysis tab, so the two
 * never show conflicting numbers.
 */
export function ShopSalesIndicator({ shopId }: { shopId: string }) {
  const { data, isLoading } = useQuery(shopAnalysisQuery(shopId));

  if (isLoading) {
    return (
      <div className="surface-card animate-pulse p-3 text-xs text-muted-foreground">
        Checking shop performance…
      </div>
    );
  }
  if (!data) return null;

  const shopAverage = data.monthlySales.shop?.average ?? 0;
  const perf = getShopSalesPerformance(
    shopAverage,
    data.monthlySales.area?.average ?? null,
    !!data.shop.areaId,
    data.monthlySales.areaEligibleShopCount,
  );
  const hasComparison = perf.percentageDifference !== null;

  return (
    <div className="surface-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Shop Sales Performance
        </p>
        <Badge className={cn(BADGE_CLASS[perf.status])}>{salesPerformanceLabel(perf.status)}</Badge>
      </div>

      {hasComparison ? (
        <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Shop avg monthly sales:{" "}
            <span className="font-medium text-foreground">{inr(perf.shopAverage)}</span>
          </span>
          <span>
            Area avg monthly sales:{" "}
            <span className="font-medium text-foreground">{inr(perf.areaAverage ?? 0)}</span>
          </span>
          <span className="font-medium text-foreground">
            {perf.percentageDifference! >= 0 ? "+" : ""}
            {perf.percentageDifference!.toFixed(1)}%{" "}
            {perf.percentageDifference! >= 0 ? "above" : "below"} area average
          </span>
        </div>
      ) : (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertCircle className="size-3.5 shrink-0" />
          {perf.status === "no_area" ||
          perf.status === "insufficient_area_data" ||
          perf.status === "no_area_data"
            ? NO_DATA_MESSAGE[perf.status]
            : null}
        </p>
      )}
    </div>
  );
}
