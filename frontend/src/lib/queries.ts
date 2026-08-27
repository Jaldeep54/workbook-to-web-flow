import { queryOptions } from "@tanstack/react-query";

import { LABEL_SUGGESTION_HISTORY_MONTHS, SHOP_ANALYSIS_MONTHS } from "./domain";
import {
  cashPositionApi,
  dashboardApi,
  labelProductsApi,
  labelStockApi,
  productsApi,
  shopAreasApi,
  shopsApi,
} from "@/services/klinzo.service";

/**
 * Shared TanStack Query definitions.
 *
 * Every one of these is a thin wrapper over a service call — the query keys
 * (and therefore every `invalidateQueries` call across the app) are unchanged
 * from before the migration, so cache invalidation still behaves identically.
 */
export const productsQuery = queryOptions({
  queryKey: ["products"],
  staleTime: 5 * 60 * 1000,
  queryFn: () => productsApi.list(),
});

export const labelProductsQuery = queryOptions({
  queryKey: ["label_products"],
  staleTime: 5 * 60 * 1000,
  queryFn: () => labelProductsApi.list(),
});

export const shopsQuery = queryOptions({
  queryKey: ["shops"],
  staleTime: 60 * 1000,
  queryFn: () => shopsApi.list(),
});

/** Shared across every page that filters or displays a shop's area. */
export const shopAreasQuery = queryOptions({
  queryKey: ["shop_areas"],
  staleTime: 60 * 1000,
  queryFn: () => shopAreasApi.list(),
});

/** The people a shop can be "Handled by" — active users of shop-handling roles. */
export const shopHandlersQuery = queryOptions({
  queryKey: ["shop_handlers"],
  staleTime: 60 * 1000,
  queryFn: () => shopsApi.handlers(),
});

/** Which of the products each shop works with. */
export const shopProductsQuery = queryOptions({
  queryKey: ["shop_products"],
  staleTime: 60 * 1000,
  queryFn: () => shopsApi.productLinks(),
});

export const availableMonthsQuery = queryOptions({
  queryKey: ["available_months"],
  staleTime: 60 * 1000,
  queryFn: () => dashboardApi.availableMonths(),
});

/**
 * Overview KPIs. `areaId` of "all" means the whole business — the same
 * endpoint answers both, so the two views can never disagree.
 */
export const summaryByAreaQuery = (month: string, areaId: string | "all") =>
  queryOptions({
    queryKey: ["dashboard_summary", month, areaId],
    queryFn: () => dashboardApi.summary(month, areaId === "all" ? undefined : areaId),
  });

export const labelStockQuery = queryOptions({
  queryKey: ["label_stock"],
  queryFn: () => labelStockApi.stock(),
});

export const labelStockSummaryQuery = queryOptions({
  queryKey: ["label_stock_summary"],
  queryFn: () => labelStockApi.summary(),
});

export const cashPositionSummaryQuery = queryOptions({
  queryKey: ["cash_position_summary"],
  queryFn: () => cashPositionApi.summary(),
});

export const investmentsQuery = queryOptions({
  queryKey: ["investments"],
  queryFn: () => cashPositionApi.investments(),
});

export const payoutsQuery = queryOptions({
  queryKey: ["payouts"],
  queryFn: () => cashPositionApi.payouts(),
});

export const skuOpportunityQuery = queryOptions({
  queryKey: ["sku_opportunity"],
  queryFn: () => dashboardApi.skuOpportunity(),
});

/** Lifetime ordered quantity per product, across every shop. */
export const orderQtyByProductQuery = queryOptions({
  queryKey: ["order_qty_by_product"],
  queryFn: () => dashboardApi.orderQtyByProduct(),
});

/** Sequential shop code, based on the shops already on file. */
export async function fetchNextShopCode(): Promise<string> {
  const { code } = await shopsApi.nextCode();
  return code;
}

/**
 * Shop Analysis — product mix, order frequency and monthly sales for one shop
 * versus its area peers. Both the Shop Analysis tab and the New Order form's
 * Shop Sales Indicator read this one query, so they always agree.
 */
export const shopAnalysisQuery = (shopId: string, months: number = SHOP_ANALYSIS_MONTHS) =>
  queryOptions({
    queryKey: ["shop_analysis", shopId, months],
    queryFn: () => shopsApi.analysis(shopId, months),
    enabled: !!shopId,
    staleTime: 60 * 1000,
  });

/**
 * Label Order Suggestion — one row per shop x label product the shop carries.
 * See the API's label-stock service for the full methodology (threshold-based
 * 1-month/2-month targets computed off a never-negative effective stock).
 */
export const labelOrderSuggestionsQuery = queryOptions({
  queryKey: ["label_order_suggestions"],
  queryFn: () => labelStockApi.suggestions(LABEL_SUGGESTION_HISTORY_MONTHS),
  staleTime: 60 * 1000,
});

export const invalidateKeys = [
  ["dashboard_summary"],
  ["available_months"],
  ["label_stock"],
  ["label_stock_summary"],
  ["orders"],
  ["deliveries"],
  ["payments"],
  ["label_orders"],
  ["variable_costs"],
  ["shops"],
];

export type {
  CashPositionSummary,
  DashboardSummary,
  InvestmentRow,
  LabelOrderSuggestionRow,
  LabelStockRow,
  MoneyMovement,
  PayoutRow,
  ProductQtyRow,
  ShopAnalysis,
  ShopAnalysisMixRow,
  ShopAnalysisSalesRow,
  ShopHandler,
  ShopLabelSummary,
  ShopProductLink as ShopProduct,
  SkuOpportunityRow,
} from "@/services/klinzo.service";

/** Kept for callers that still import the area-scoped summary type by name. */
export type { DashboardSummary as DashboardSummaryByArea } from "@/services/klinzo.service";
