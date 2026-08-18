import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type ShopRef = { code: string; shop_name: string; label_name: string | null } | null;

export type OrderRecord = {
  id: string;
  shop_id: string;
  order_no: number;
  order_date: string | null;
  delivery_date: string | null;
  status: string | null;
  total_qty: number;
  notes: string | null;
  shops: ShopRef;
  order_lines: Array<{ product_id: string; qty: number }>;
};

const ORDER_SELECT =
  "id, shop_id, order_no, order_date, delivery_date, status, total_qty, notes, shops(code, shop_name, label_name), order_lines(product_id, qty)";

export const ordersQuery = (month: string, shopId: string | "all") =>
  queryOptions({
    queryKey: ["orders", month, shopId],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("month", month)
        .order("order_date", { ascending: false })
        .limit(1000);
      if (shopId !== "all") q = q.eq("shop_id", shopId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as OrderRecord[];
    },
  });

/** Delivery sheet — every order scheduled for delivery on one date. */
export const deliverySheetQuery = (date: string) =>
  queryOptions({
    queryKey: ["delivery_sheet", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("delivery_date", date)
        .order("order_no")
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as OrderRecord[];
    },
  });

export type DeliveryRecord = {
  id: string;
  shop_id: string;
  order_id: string;
  delivery_date: string | null;
  status: string | null;
  total_qty: number;
  total_sales: number;
  labelling_cost: number;
  packaging_cost: number;
  production_cost: number;
  total_fixed_cost: number;
  profit: number;
  shops: ShopRef;
  orders: { order_no: number } | null;
  delivery_lines: Array<{ product_id: string; qty: number }>;
};

export const deliveriesQuery = (month: string, shopId: string | "all") =>
  queryOptions({
    queryKey: ["deliveries", month, shopId],
    queryFn: async () => {
      let q = supabase
        .from("deliveries")
        .select(
          "id, shop_id, order_id, delivery_date, status, total_qty, total_sales, labelling_cost, packaging_cost, production_cost, total_fixed_cost, profit, shops(code, shop_name, label_name), orders(order_no), delivery_lines(product_id, qty)",
        )
        .eq("month", month)
        .order("delivery_date", { ascending: false })
        .limit(1000);
      if (shopId !== "all") q = q.eq("shop_id", shopId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DeliveryRecord[];
    },
  });

export type PaymentRecord = {
  id: string;
  shop_id: string;
  order_id: string;
  payment_date: string | null;
  status: string | null;
  collected_by: string | null;
  collected_date: string | null;
  amount: number;
  shops: ShopRef;
  orders: { order_no: number } | null;
};

export const paymentsQuery = (month: string, shopId: string | "all") =>
  queryOptions({
    queryKey: ["payments", month, shopId],
    queryFn: async () => {
      let q = supabase
        .from("payments")
        .select("id, shop_id, order_id, payment_date, status, collected_by, collected_date, amount, shops(code, shop_name, label_name), orders(order_no)")
        .eq("month", month)
        .order("payment_date", { ascending: false })
        .limit(1000);
      if (shopId !== "all") q = q.eq("shop_id", shopId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PaymentRecord[];
    },
  });

export type LabelOrderRecord = {
  id: string;
  shop_id: string;
  order_no: number;
  order_date: string | null;
  total_labels: number;
  shops: ShopRef;
  label_order_lines: Array<{ label_product_id: string; sheets: number; products: number }>;
};

export const labelOrdersQuery = (month: string, shopId: string | "all") =>
  queryOptions({
    queryKey: ["label_orders", month, shopId],
    queryFn: async () => {
      let q = supabase
        .from("label_orders")
        .select("id, shop_id, order_no, order_date, total_labels, shops(code, shop_name, label_name), label_order_lines(label_product_id, sheets, products)")
        .eq("month", month)
        .order("order_date", { ascending: false })
        .limit(1000);
      if (shopId !== "all") q = q.eq("shop_id", shopId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as LabelOrderRecord[];
    },
  });

export type CostRecord = {
  id: string;
  cost_date: string;
  amount: number;
  cost_type: string;
  note: string | null;
};

export const costsQuery = (month: string) =>
  queryOptions({
    queryKey: ["variable_costs", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variable_costs")
        .select("id, cost_date, amount, cost_type, note")
        .eq("month", month)
        .order("cost_date", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as CostRecord[];
    },
  });

/** Next order number for a shop (mirrors the workbook's sequential order slots). */
export async function nextOrderNo(table: "orders" | "label_orders", shopId: string) {
  const { data, error } = await supabase
    .from(table)
    .select("order_no")
    .eq("shop_id", shopId)
    .order("order_no", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data?.[0] as { order_no: number } | undefined)?.order_no ?? 0) + 1;
}