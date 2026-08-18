import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LabelProduct, LabelSuggestionStatus, Product, Shop, ShopArea } from "./domain";
import { LABEL_SUGGESTION_HISTORY_MONTHS, SHOP_ANALYSIS_MONTHS } from "./domain";
import { getShopImageUrl } from "./shop-image";

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export const productsQuery = queryOptions({
  queryKey: ["products"],
  staleTime: 5 * 60 * 1000,
  queryFn: async () =>
    unwrap<Product[]>((await supabase.from("products").select("*").order("sort_order")) as never),
});

export const labelProductsQuery = queryOptions({
  queryKey: ["label_products"],
  staleTime: 5 * 60 * 1000,
  queryFn: async () =>
    unwrap<LabelProduct[]>(
      (await supabase.from("label_products").select("*").order("sort_order")) as never,
    ),
});

export const shopsQuery = queryOptions({
  queryKey: ["shops"],
  staleTime: 60 * 1000,
  queryFn: async () =>
    unwrap<Shop[]>((await supabase.from("shops").select("*").order("shop_name")) as never),
});

/** Shared across every page that filters or displays a shop's area — the single source of truth. */
export const shopAreasQuery = queryOptions({
  queryKey: ["shop_areas"],
  staleTime: 60 * 1000,
  queryFn: async () =>
    unwrap<ShopArea[]>(
      (await supabase
        .from("shop_areas" as never)
        .select("id, name")
        .order("name")) as never,
    ),
});

/** Finds an existing area by name (case/whitespace-insensitive) or creates it. */
export async function upsertShopArea(name: string): Promise<ShopArea> {
  const { data, error } = await supabase.rpc(
    "upsert_shop_area" as never,
    { p_name: name } as never,
  );
  if (error) throw new Error(error.message);
  return data as unknown as ShopArea;
}

/** Signed URL for a shop's photo — re-fetched well before the 1-hour signature expires. */
export const shopImageUrlQuery = (path: string | null) =>
  queryOptions({
    queryKey: ["shop_image_url", path],
    queryFn: () => getShopImageUrl(path as string),
    enabled: !!path,
    staleTime: 45 * 60 * 1000,
  });

export const availableMonthsQuery = queryOptions({
  queryKey: ["available_months"],
  staleTime: 60 * 1000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc("available_months");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ month: string }>).map((r) => r.month);
  },
});

export type DashboardSummary = {
  month: string;
  orderCount: number;
  orderQty: number;
  orderByProduct: Record<string, number>;
  deliveryCount: number;
  deliveryQty: number;
  deliveryByProduct: Record<string, number>;
  totalSales: number;
  totalFixedCost: number;
  paymentCount: number;
  paymentsReceived: number;
  variableCost: number;
  labelOrderCount: number;
  labelByProduct: Record<string, number>;
  totalLabels: number;
};

export const summaryQuery = (month: string) =>
  queryOptions({
    queryKey: ["dashboard_summary", month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_summary", { p_month: month });
      if (error) throw new Error(error.message);
      return data as unknown as DashboardSummary;
    },
  });

/**
 * Area-scoped sibling of dashboard_summary — same fields, plus a 3-month
 * sales trend, a product revenue-share breakdown for the month, and the
 * area's (or whole business's) top 5 shops by sales. Used by the Overview
 * page once a Shop Area is selected via ShopAreaFilter; areaId null/"all"
 * behaves identically to summaryQuery (whole business).
 */
export type DashboardSummaryByArea = DashboardSummary & {
  areaId: string | null;
  monthlySales: Array<{ month: string; totalSales: number }>;
  productMix: Array<{
    productId: string;
    shortName: string;
    sortOrder: number;
    amount: number;
    sharePct: number;
  }>;
  topShops: Array<{ shopId: string; shopName: string; sales: number }>;
};

export const summaryByAreaQuery = (month: string, areaId: string | "all") =>
  queryOptions({
    queryKey: ["dashboard_summary_by_area", month, areaId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "dashboard_summary_by_area" as never,
        {
          p_month: month,
          p_area_id: areaId === "all" ? null : areaId,
        } as never,
      );
      if (error) throw new Error(error.message);
      return data as unknown as DashboardSummaryByArea;
    },
  });

export type LabelStockRow = {
  shop_id: string;
  shop_name: string;
  design_type: number;
  label_product_id: string;
  label_product_key: string;
  label_product_name: string;
  sort_order: number;
  low_stock_threshold: number;
  stock: number;
  is_low: boolean;
  shop_sells_product: boolean;
};

export const labelStockQuery = queryOptions({
  queryKey: ["label_stock"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("label_stock_view" as never)
      .select("*")
      .order("shop_name")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as LabelStockRow[];
  },
});

export type ShopLabelSummary = {
  shop_id: string;
  shop_name: string;
  design_type: number;
  low_stock_count: number;
  has_label_order: boolean;
  include_in_dashboard: boolean;
};

export const labelStockSummaryQuery = queryOptions({
  queryKey: ["label_stock_summary"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("shop_label_stock_summary" as never)
      .select("*")
      .order("shop_name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ShopLabelSummary[];
  },
});

/**
 * Cash Position — all-time totals (never scoped to a month) behind one RPC,
 * same reasoning as dashboard_summary()/shop_analysis(): a single source of
 * truth instead of pulling every payment/cost/investment/payout row into the
 * browser to sum client-side.
 */
export type CashPositionSummary = {
  investmentsTotal: number;
  investmentsByBhavin: number;
  investmentsByJaldeep: number;
  paymentsReceivedTotal: number;
  variableCostsTotal: number;
  payoutsTotal: number;
};

export const cashPositionSummaryQuery = queryOptions({
  queryKey: ["cash_position_summary"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("cash_position_summary" as never);
    if (error) throw new Error(error.message);
    return data as unknown as CashPositionSummary;
  },
});

export type MoneyMovement = {
  id: string;
  amount: number;
  done_by: "Bhavin" | "Jaldeep";
  created_at: string;
};

export type InvestmentRow = MoneyMovement & { investment_date: string };

export const investmentsQuery = queryOptions({
  queryKey: ["investments"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("investments" as never)
      .select("id, investment_date, amount, done_by, created_at")
      .order("investment_date", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as InvestmentRow[];
  },
});

export type PayoutRow = MoneyMovement & { payout_date: string };

export const payoutsQuery = queryOptions({
  queryKey: ["payouts"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("payouts" as never)
      .select("id, payout_date, amount, done_by, created_at")
      .order("payout_date", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PayoutRow[];
  },
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

/** Which of the six products each shop works with. */
export type ShopProduct = { shop_id: string; product_id: string };

export const shopProductsQuery = queryOptions({
  queryKey: ["shop_products"],
  staleTime: 60 * 1000,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("shop_products" as never)
      .select("shop_id, product_id");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ShopProduct[];
  },
});

export type SkuOpportunityRow = {
  shop_id: string;
  shop_name: string;
  label_name: string | null;
  address: string | null;
  is_active: boolean;
  active_products: string[] | null;
  inactive_products: string[] | null;
  avg_monthly_sales: number;
  total_sales: number;
  active_months: number;
};

export const skuOpportunityQuery = queryOptions({
  queryKey: ["sku_opportunity"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("shop_sku_opportunity" as never)
      .select("*")
      .order("shop_name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SkuOpportunityRow[];
  },
});

export type ProductQtyRow = {
  product_id: string;
  product_key: string;
  short_name: string;
  sort_order: number;
  total_qty: number;
};

/** Lifetime ordered quantity per product, across every shop. */
export const orderQtyByProductQuery = queryOptions({
  queryKey: ["order_qty_by_product"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("order_qty_by_product" as never);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ProductQtyRow[];
  },
});

/** Sequential shop code, based on the number of shops on file. */
export async function fetchNextShopCode(): Promise<string> {
  const { data, error } = await supabase.rpc("next_shop_code" as never);
  if (error) throw new Error(error.message);
  return String(data ?? 1);
}

/**
 * Shop Analysis — product mix, order frequency and monthly sales for one shop
 * versus its Shop Area peers. Backed entirely by the shop_analysis() RPC so the
 * Shop Analysis tab and the New Order form's Shop Sales Indicator always read
 * identical numbers (see getShopSalesPerformance in domain.ts for how the
 * monthlySales figures below turn into a Very Low/Low/Good/Very Good status).
 */
export type ShopAnalysisProductRow = {
  productId: string;
  shortName: string;
  sortOrder: number;
};
export type ShopAnalysisMixRow = ShopAnalysisProductRow & { qty?: number; sharePct: number };
export type ShopAnalysisSalesRow = ShopAnalysisProductRow & { average: number };

export type ShopAnalysis = {
  shop: { id: string; name: string; areaId: string | null; areaName: string | null };
  analysisPeriod: { months: number; label: string; startDate: string; endDate: string };
  activeProducts: Array<{
    id: string;
    key: string;
    name: string;
    shortName: string;
    sortOrder: number;
  }>;
  productMix: {
    shop: ShopAnalysisMixRow[];
    shopTotalQty: number;
    area: ShopAnalysisMixRow[];
    areaEligibleShops: number;
  };
  orderFrequency: {
    shop: { avgDays: number; orderCount: number } | null;
    area: { avgDays: number; eligibleShops: number } | null;
  };
  monthlySales: {
    shop: { average: number; activeMonths: number; byProduct: ShopAnalysisSalesRow[] } | null;
    area: { average: number; eligibleShops: number; byProduct: ShopAnalysisSalesRow[] } | null;
    areaEligibleShopCount: number;
  };
};

export const shopAnalysisQuery = (shopId: string, months: number = SHOP_ANALYSIS_MONTHS) =>
  queryOptions({
    queryKey: ["shop_analysis", shopId, months],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "shop_analysis" as never,
        {
          p_shop_id: shopId,
          p_months: months,
        } as never,
      );
      if (error) throw new Error(error.message);
      return data as unknown as ShopAnalysis;
    },
    enabled: !!shopId,
    staleTime: 60 * 1000,
  });

/**
 * Label Order Suggestion — one row per shop x label_product the shop carries.
 * Backed entirely by the label_order_suggestions() RPC: current stock reuses
 * label_stock_view's exact formula, average monthly usage is a simple average
 * of order_lines history, and status/suggested_sheets follow directly from
 * the low_stock_threshold-based 1-month/2-month target rule, computed off an
 * effective (never-negative) stock figure (see domain.ts and the migration
 * for the full methodology).
 */
export type LabelOrderSuggestionRow = {
  shop_id: string;
  shop_name: string;
  shop_code: string;
  label_product_id: string;
  label_product_key: string;
  label_product_name: string;
  label_product_short_name: string;
  label_product_sort_order: number;
  product_id: string;
  labels_per_sheet: number;
  sheet_cost: number;
  low_stock_threshold: number;
  current_stock: number;
  has_stock_data_issue: boolean;
  avg_monthly_usage: number;
  one_month_target: number;
  two_month_target: number;
  additional_required: number;
  suggested_sheets: number;
  expected_stock_after_order: number;
  status: LabelSuggestionStatus;
};

export const labelOrderSuggestionsQuery = queryOptions({
  queryKey: ["label_order_suggestions"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc(
      "label_order_suggestions" as never,
      { p_history_months: LABEL_SUGGESTION_HISTORY_MONTHS } as never,
    );
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as LabelOrderSuggestionRow[];
  },
  staleTime: 60 * 1000,
});
