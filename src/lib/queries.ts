import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LabelProduct, Product, Shop, ShopArea } from "./domain";
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
