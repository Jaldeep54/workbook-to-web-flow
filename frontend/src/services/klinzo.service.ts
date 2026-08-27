import type { LabelProduct, LabelSuggestionStatus, Product, Shop, ShopArea } from "@/lib/domain";
import { api, apiRequest, apiRequestWithMeta } from "./api-client";

/**
 * Typed wrappers around the Klinzo Operations API, grouped by module.
 *
 * Field names mirror the API (and the workbook before it) exactly — shop_name,
 * order_lines, total_sales — so there is one vocabulary from MongoDB through
 * to the tables that render it, and no translation layer to drift.
 */

/* ------------------------------------------------------------------- shops */

export type ShopWithImage = Shop & { image_url?: string | null; product_ids?: string[] };
export type ShopProductLink = { shop_id: string; product_id: string };

export const shopsApi = {
  list: (params: { search?: string; areaId?: string; isActive?: boolean } = {}) =>
    api.get<ShopWithImage[]>("/shops", {
      search: params.search,
      areaId: params.areaId,
      isActive: params.isActive,
      limit: 500,
      sortBy: "shop_name",
    }),
  get: (id: string) => api.get<ShopWithImage>(`/shops/${id}`),
  create: (payload: Record<string, unknown>) => api.post<ShopWithImage>("/shops", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<ShopWithImage>(`/shops/${id}`, payload),
  deactivate: (id: string) => api.post<ShopWithImage>(`/shops/${id}/deactivate`),
  remove: (id: string) => api.delete<{ message: string }>(`/shops/${id}`),
  nextCode: () => api.get<{ code: string }>("/shops/next-code"),
  productLinks: () => api.get<ShopProductLink[]>("/shops/products"),
  /** People a shop can be "Handled by" — see `ShopHandler`. */
  handlers: () => api.get<ShopHandler[]>("/shops/handlers"),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return api.upload<{ image_path: string; image_url: string }>(`/shops/${id}/image`, form);
  },
  removeImage: (id: string) =>
    api.delete<{ image_path: null; image_url: null }>(`/shops/${id}/image`),
  history: (id: string) => api.get<ShopHistory>(`/shops/${id}/history`),
  analysis: (id: string, months?: number) =>
    api.get<ShopAnalysis>(`/shops/${id}/analysis`, { months }),
};

/**
 * A person a shop can be assigned to. These are the active user accounts of
 * every role flagged "members handle shops" (Admin → Roles & permissions), so
 * retiring a salesman means deactivating their account — they leave this list
 * at once while the shops they handled keep showing their name.
 */
export type ShopHandler = {
  id: string;
  full_name: string;
  role_name: string;
};

export const shopAreasApi = {
  list: () => api.get<ShopArea[]>("/shop-areas"),
  /** Find-or-create by name; the backend dedupes case-insensitively. */
  upsert: (name: string) => api.post<ShopArea>("/shop-areas", { name }),
  update: (id: string, name: string) => api.patch<ShopArea>(`/shop-areas/${id}`, { name }),
  /**
   * An area still holding shops is refused unless the caller says what should
   * happen to them: `reassignTo` moves them to another area, `force` leaves
   * them with no area at all.
   */
  remove: (id: string, options?: { reassignTo?: string; force?: boolean }) =>
    api.delete<{ message: string; shops_affected: number }>(`/shop-areas/${id}`, {
      ...(options?.reassignTo ? { reassignTo: options.reassignTo } : {}),
      ...(options?.force ? { force: "true" } : {}),
    }),
};

/* --------------------------------------------------------------- catalogue */

export const productsApi = {
  list: () => api.get<Product[]>("/products"),
  update: (id: string, payload: Partial<Product>) => api.patch<Product>(`/products/${id}`, payload),
};

export const labelProductsApi = {
  list: () => api.get<LabelProduct[]>("/label-products"),
  update: (id: string, payload: Partial<LabelProduct>) =>
    api.patch<LabelProduct>(`/label-products/${id}`, payload),
};

/* ------------------------------------------------------------------ orders */

export type ShopRef = { code: string; shop_name: string; label_name: string | null } | null;

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

export type OrderInput = {
  shop_id: string;
  order_date: string;
  delivery_date: string;
  notes?: string | null;
  order_lines: Array<{ product_id: string; qty: number }>;
};

export const ordersApi = {
  list: (params: {
    month?: string;
    shopId?: string;
    areaId?: string;
    date?: string;
    pending?: boolean;
  }) =>
    api.get<OrderRecord[]>("/orders", {
      month: params.month,
      shopId: params.shopId,
      areaId: params.areaId,
      date: params.date,
      pending: params.pending ? "true" : undefined,
      limit: 500,
    }),
  deliverySheet: (date: string, areaId?: string) =>
    api.get<OrderRecord[]>("/orders/delivery-sheet", { date, areaId }),
  dueDates: (financialYear: string) => api.get<string[]>("/orders/due-dates", { financialYear }),
  create: (payload: OrderInput) => api.post<OrderRecord>("/orders", payload),
  update: (id: string, payload: OrderInput) => api.put<OrderRecord>(`/orders/${id}`, payload),
  setStatus: (id: string, status: string, deliveryDate?: string | null) =>
    api.patch<OrderRecord>(`/orders/${id}/status`, {
      status,
      ...(deliveryDate ? { delivery_date: deliveryDate } : {}),
    }),
  remove: (id: string) => api.delete<{ message: string }>(`/orders/${id}`),
};

/* -------------------------------------------------------------- deliveries */

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

export const deliveriesApi = {
  list: (params: { month?: string; shopId?: string; areaId?: string }) =>
    api.get<DeliveryRecord[]>("/deliveries", { ...params, limit: 500 }),
  create: (payload: { order_id: string; delivery_date: string; status?: string }) =>
    api.post<DeliveryRecord>("/deliveries", payload),
  update: (id: string, payload: { status?: string; delivery_date?: string }) =>
    api.patch<DeliveryRecord>(`/deliveries/${id}`, payload),
  remove: (id: string) => api.delete<{ message: string }>(`/deliveries/${id}`),
};

/* ---------------------------------------------------------------- payments */

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

export const paymentsApi = {
  list: (params: { month?: string; shopId?: string; areaId?: string }) =>
    api.get<PaymentRecord[]>("/payments", { ...params, limit: 500 }),
  update: (
    id: string,
    payload: { status?: string; collected_by?: string | null; collected_date?: string | null },
  ) => api.patch<PaymentRecord>(`/payments/${id}`, payload),
};

/* ------------------------------------------------------------ label orders */

export type LabelOrderRecord = {
  id: string;
  shop_id: string;
  order_no: number;
  order_date: string | null;
  total_labels: number;
  shops: ShopRef;
  label_order_lines: Array<{ label_product_id: string; sheets: number; products: number }>;
};

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

export type ShopLabelSummary = {
  shop_id: string;
  shop_name: string;
  design_type: number;
  low_stock_count: number;
  has_label_order: boolean;
  include_in_dashboard: boolean;
};

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

export const labelOrdersApi = {
  list: (params: { month?: string; shopId?: string; areaId?: string; date?: string }) =>
    api.get<LabelOrderRecord[]>("/label-orders", { ...params, limit: 500 }),
  create: (payload: {
    shop_id: string;
    order_date: string;
    lines: Array<{ label_product_id: string; sheets: number }>;
  }) => api.post<LabelOrderRecord>("/label-orders", payload),
  /** Places the whole selection from the suggestion screen in one call. */
  createBulk: (payload: {
    order_date: string;
    orders: Array<{
      shop_id: string;
      lines: Array<{ label_product_id: string; sheets: number }>;
    }>;
  }) =>
    api.post<{
      order_date: string;
      successes: Array<{ shop_id: string; id: string; order_no: number }>;
      failures: Array<{ shop_id: string; message: string }>;
    }>("/label-orders/bulk", payload),
  remove: (id: string) => api.delete<{ message: string }>(`/label-orders/${id}`),
};

export const labelStockApi = {
  stock: () => api.get<LabelStockRow[]>("/labels/stock"),
  summary: () => api.get<ShopLabelSummary[]>("/labels/stock-summary"),
  suggestions: (historyMonths?: number) =>
    api.get<LabelOrderSuggestionRow[]>("/labels/suggestions", { historyMonths }),
};

/* ---------------------------------------------------------------- finances */

export type CostRecord = {
  id: string;
  cost_date: string;
  amount: number;
  cost_type: string;
  note: string | null;
};

export type MoneyMovement = {
  id: string;
  amount: number;
  done_by: "Bhavin" | "Jaldeep";
  created_at: string;
};

export type InvestmentRow = MoneyMovement & { investment_date: string };
export type PayoutRow = MoneyMovement & { payout_date: string };

export type CashPositionSummary = {
  investmentsTotal: number;
  investmentsByBhavin: number;
  investmentsByJaldeep: number;
  paymentsReceivedTotal: number;
  variableCostsTotal: number;
  payoutsTotal: number;
  moneyInHand: number;
};

export const costsApi = {
  list: (month: string) => api.get<CostRecord[]>("/costs", { month, limit: 500 }),
  create: (payload: {
    cost_date: string;
    cost_type: string;
    amount: number;
    note?: string | null;
  }) => api.post<CostRecord>("/costs", payload),
  remove: (id: string) => api.delete<{ message: string }>(`/costs/${id}`),
};

export const cashPositionApi = {
  summary: () => api.get<CashPositionSummary>("/cash-position/summary"),
  investments: () => api.get<InvestmentRow[]>("/cash-position/investments", { limit: 500 }),
  createInvestment: (payload: { investment_date: string; amount: number; done_by: string }) =>
    api.post<InvestmentRow>("/cash-position/investments", payload),
  removeInvestment: (id: string) =>
    api.delete<{ message: string }>(`/cash-position/investments/${id}`),
  payouts: () => api.get<PayoutRow[]>("/cash-position/payouts", { limit: 500 }),
  createPayout: (payload: { payout_date: string; amount: number; done_by: string }) =>
    api.post<PayoutRow>("/cash-position/payouts", payload),
  removePayout: (id: string) => api.delete<{ message: string }>(`/cash-position/payouts/${id}`),
};

/* --------------------------------------------------------------- dashboard */

export type DashboardSummary = {
  month: string;
  areaId: string | null;
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
  paymentsPending: number;
  variableCost: number;
  labelOrderCount: number;
  labelByProduct: Record<string, number>;
  totalLabels: number;
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

export type ProductQtyRow = {
  product_id: string;
  product_key: string;
  short_name: string;
  sort_order: number;
  total_qty: number;
};

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

export const dashboardApi = {
  summary: (month: string, areaId?: string) =>
    api.get<DashboardSummary>("/dashboard/summary", { month, areaId }),
  availableMonths: () => api.get<string[]>("/dashboard/available-months"),
  orderQtyByProduct: () => api.get<ProductQtyRow[]>("/dashboard/order-qty-by-product"),
  skuOpportunity: () => api.get<SkuOpportunityRow[]>("/dashboard/sku-opportunity"),
};

/* -------------------------------------------------- shop analysis & history */

export type ShopAnalysisProductRow = { productId: string; shortName: string; sortOrder: number };
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

export type ShopHistory = {
  orders: Array<{
    id: string;
    order_no: number;
    order_date: string | null;
    delivery_date: string | null;
    status: string | null;
    total_qty: number;
    notes: string | null;
    order_lines: Array<{ product_id: string; qty: number }>;
  }>;
  deliveries: Array<{
    id: string;
    order_id: string;
    delivery_date: string | null;
    status: string | null;
    total_qty: number;
    total_sales: number;
    total_fixed_cost: number;
    profit: number;
  }>;
  payments: Array<{
    id: string;
    payment_date: string | null;
    status: string | null;
    collected_by: string | null;
    collected_date: string | null;
    amount: number;
  }>;
};

/* ------------------------------------------------------- bills and imports */

export type BillLineItem = {
  itemName: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  amount: number;
};

export type BillPayload = {
  orderId: string;
  invoiceNo: number;
  deliveryDateRaw: string;
  shopName: string;
  shopAddress: string | null;
  lines: BillLineItem[];
  totalAmount: number;
};

export const billsApi = {
  /** Invoice numbers and prices come from the server; the PDF is rendered here. */
  generate: (orderIds: string[]) => api.post<BillPayload[]>("/bills", { orderIds }),
};

export type ImportResult = {
  shops: number;
  orders: number;
  deliveries: number;
  payments: number;
  labelOrders: number;
  costs: number;
  warnings: string[];
};

export const importApi = {
  workbook: (file: File) => {
    const form = new FormData();
    form.append("workbook", file);
    return api.upload<ImportResult>("/import/workbook", form);
  },
};

/* ----------------------------------------------------------- users & roles */

export type ManagedUser = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; name: string; slug: string } | null;
  directPermissions: string[];
  permissions?: string[];
};

export type ManagedRole = {
  id: string;
  name: string;
  slug: string;
  description: string;
  isSystem: boolean;
  /** Members of this role fill a shop's "Handled by" picker. */
  handlesShops: boolean;
  permissionIds: string[];
  permissionCount: number;
  userCount: number;
};

export type PermissionRow = {
  id: string;
  name: string;
  resource: string;
  action: string;
  label: string;
  description: string;
  group: string;
  isSystem: boolean;
};

export type PermissionCatalogue = {
  permissions: PermissionRow[];
  groups: Array<{
    group: string;
    resources: Array<{
      resource: string;
      label: string;
      actions: Array<{ id: string; action: string; name: string }>;
    }>;
  }>;
};

export const usersApi = {
  list: (params: { search?: string; role?: string } = {}) =>
    apiRequestWithMeta<ManagedUser[]>("/users", { query: { ...params, limit: 200 } }),
  get: (id: string) => api.get<ManagedUser>(`/users/${id}`),
  create: (payload: {
    email: string;
    password: string;
    fullName: string;
    role: string;
    directPermissions?: string[];
    isActive?: boolean;
  }) => api.post<ManagedUser>("/users", payload),
  update: (
    id: string,
    payload: Partial<{
      email: string;
      fullName: string;
      role: string;
      directPermissions: string[];
      isActive: boolean;
    }>,
  ) => api.patch<ManagedUser>(`/users/${id}`, payload),
  resetPassword: (id: string, password: string) =>
    api.post<{ message: string }>(`/users/${id}/password`, { password }),
  remove: (id: string) => api.delete<{ message: string }>(`/users/${id}`),
};

export const rolesApi = {
  list: () => api.get<ManagedRole[]>("/roles"),
  get: (id: string) => api.get<ManagedRole & { permissions: PermissionRow[] }>(`/roles/${id}`),
  create: (payload: {
    name: string;
    description?: string;
    permissions?: string[];
    handlesShops?: boolean;
  }) => api.post<ManagedRole>("/roles", payload),
  update: (
    id: string,
    payload: {
      name?: string;
      description?: string;
      permissions?: string[];
      handlesShops?: boolean;
    },
  ) => api.patch<ManagedRole>(`/roles/${id}`, payload),
  setPermissions: (id: string, permissions: string[]) =>
    api.put<ManagedRole>(`/roles/${id}/permissions`, { permissions }),
  remove: (id: string) => api.delete<{ message: string }>(`/roles/${id}`),
};

export const permissionsApi = {
  catalogue: () => api.get<PermissionCatalogue>("/permissions"),
  create: (payload: {
    resource: string;
    action: string;
    label: string;
    description?: string;
    group?: string;
  }) => api.post<PermissionRow>("/permissions", payload),
  remove: (id: string) => api.delete<{ message: string }>(`/permissions/${id}`),
};

/** Escape hatch for one-off calls; prefer a named function above. */
export { apiRequest };
