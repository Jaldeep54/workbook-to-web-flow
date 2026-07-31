import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LabelProduct, Product, Shop } from "./domain";

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export const productsQuery = queryOptions({
  queryKey: ["products"],
  staleTime: 5 * 60 * 1000,
  queryFn: async () =>
    unwrap<Product[]>(
      await supabase.from("products").select("*").order("sort_order") as never,
    ),
});

export const labelProductsQuery = queryOptions({
  queryKey: ["label_products"],
  staleTime: 5 * 60 * 1000,
  queryFn: async () =>
    unwrap<LabelProduct[]>(
      await supabase.from("label_products").select("*").order("sort_order") as never,
    ),
});

export const shopsQuery = queryOptions({
  queryKey: ["shops"],
  staleTime: 60 * 1000,
  queryFn: async () =>
    unwrap<Shop[]>(await supabase.from("shops").select("*").order("shop_name") as never),
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