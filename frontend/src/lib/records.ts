import { queryOptions } from "@tanstack/react-query";

import {
  costsApi,
  deliveriesApi,
  labelOrdersApi,
  ordersApi,
  paymentsApi,
} from "@/services/klinzo.service";

/**
 * Month-scoped record lists — the tables behind Orders, Deliveries, Payments,
 * Label orders and Costs. Filtering happens on the server (month, shop, area,
 * date), so a browser never holds more rows than the screen shows.
 */
export const ordersQuery = (month: string, shopId: string | "all") =>
  queryOptions({
    queryKey: ["orders", month, shopId],
    queryFn: () => ordersApi.list({ month, shopId: shopId === "all" ? undefined : shopId }),
  });

/** Delivery sheet — every order scheduled for delivery on one date. */
export const deliverySheetQuery = (date: string) =>
  queryOptions({
    queryKey: ["delivery_sheet", date],
    queryFn: () => ordersApi.deliverySheet(date),
  });

/** Orders that don't have a delivery recorded yet. */
export const pendingOrdersQuery = queryOptions({
  queryKey: ["pending_orders"],
  queryFn: () => ordersApi.list({ pending: true }),
});

export const deliveryDueDatesQuery = (financialYear: string) =>
  queryOptions({
    queryKey: ["delivery_due_dates", financialYear],
    queryFn: () => ordersApi.dueDates(financialYear),
  });

export const deliveriesQuery = (month: string, shopId: string | "all") =>
  queryOptions({
    queryKey: ["deliveries", month, shopId],
    queryFn: () => deliveriesApi.list({ month, shopId: shopId === "all" ? undefined : shopId }),
  });

export const paymentsQuery = (month: string, shopId: string | "all") =>
  queryOptions({
    queryKey: ["payments", month, shopId],
    queryFn: () => paymentsApi.list({ month, shopId: shopId === "all" ? undefined : shopId }),
  });

export const labelOrdersQuery = (month: string, shopId: string | "all") =>
  queryOptions({
    queryKey: ["label_orders", month, shopId],
    queryFn: () => labelOrdersApi.list({ month, shopId: shopId === "all" ? undefined : shopId }),
  });

export const costsQuery = (month: string) =>
  queryOptions({
    queryKey: ["variable_costs", month],
    queryFn: () => costsApi.list(month),
  });

export type {
  CostRecord,
  DeliveryRecord,
  LabelOrderRecord,
  OrderRecord,
  PaymentRecord,
} from "@/services/klinzo.service";
