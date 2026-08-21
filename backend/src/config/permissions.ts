/**
 * The permission catalogue.
 *
 * Every page/module the app exposes appears here once, with the actions that
 * make sense for it. This list is the input to the seed (which writes the
 * `permissions` collection) and the vocabulary the route table guards with —
 * so adding a module means adding an entry here and re-running the seed, never
 * editing authorization logic.
 *
 * Roles are *not* defined here: they're created by administrators at runtime
 * (the seed only bootstraps Admin plus two illustrative examples).
 */
export const RESOURCES = {
  dashboard: "dashboard",
  shops: "shops",
  shopAreas: "shop_areas",
  products: "products",
  labelProducts: "label_products",
  orders: "orders",
  deliveries: "deliveries",
  payments: "payments",
  labelOrders: "label_orders",
  labelStock: "label_stock",
  costs: "costs",
  cashPosition: "cash_position",
  reports: "reports",
  skuOpportunity: "sku_opportunity",
  bills: "bills",
  imports: "imports",
  users: "users",
  roles: "roles",
  permissions: "permissions",
} as const;

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES];

export type PermissionDefinition = {
  resource: string;
  label: string;
  group: string;
  description: string;
  actions: Array<"view" | "create" | "update" | "delete" | "manage">;
};

const CRUD = ["view", "create", "update", "delete"] as const;

export const PERMISSION_CATALOGUE: PermissionDefinition[] = [
  {
    resource: RESOURCES.dashboard,
    label: "Dashboard",
    group: "Operations",
    description: "Monthly overview: sales, profit, payments and label totals",
    actions: ["view"],
  },
  {
    resource: RESOURCES.shops,
    label: "Shops",
    group: "Operations",
    description: "Shop directory, contact details, location and product mix",
    actions: [...CRUD, "manage"],
  },
  {
    resource: RESOURCES.shopAreas,
    label: "Shop Areas",
    group: "Operations",
    description: "The area lookup every module filters by",
    actions: [...CRUD],
  },
  {
    resource: RESOURCES.orders,
    label: "Orders",
    group: "Operations",
    description: "Shop orders, the delivery sheet and order status changes",
    actions: [...CRUD, "manage"],
  },
  {
    resource: RESOURCES.deliveries,
    label: "Deliveries",
    group: "Operations",
    description: "Recorded deliveries with their frozen sales and cost figures",
    actions: [...CRUD],
  },
  {
    resource: RESOURCES.payments,
    label: "Payments",
    group: "Operations",
    description: "Collections raised from delivered orders",
    actions: ["view", "update"],
  },
  {
    resource: RESOURCES.labelOrders,
    label: "Label Orders",
    group: "Labels",
    description: "Label printing orders per shop",
    actions: [...CRUD],
  },
  {
    resource: RESOURCES.labelStock,
    label: "Label Stock",
    group: "Labels",
    description: "Label stock dashboard and reorder suggestions",
    actions: ["view"],
  },
  {
    resource: RESOURCES.costs,
    label: "Variable Costs",
    group: "Finance",
    description: "The monthly variable cost register",
    actions: [...CRUD],
  },
  {
    resource: RESOURCES.cashPosition,
    label: "Cash Position",
    group: "Finance",
    description: "Investments, payouts and money in hand",
    actions: [...CRUD],
  },
  {
    resource: RESOURCES.reports,
    label: "Reports",
    group: "Insights",
    description: "Cross-module reporting and exports",
    actions: ["view"],
  },
  {
    resource: RESOURCES.skuOpportunity,
    label: "SKU Opportunity",
    group: "Insights",
    description: "Which products each shop does and doesn't carry",
    actions: ["view"],
  },
  {
    resource: RESOURCES.products,
    label: "Product Rates",
    group: "Settings",
    description: "Selling price, production and packaging rates",
    actions: [...CRUD],
  },
  {
    resource: RESOURCES.labelProducts,
    label: "Label Rates",
    group: "Settings",
    description: "Labels per sheet, sheet cost and low-stock thresholds",
    actions: [...CRUD],
  },
  {
    resource: RESOURCES.bills,
    label: "Bills",
    group: "Operations",
    description: "Invoice and delivery challan generation",
    actions: ["view", "create"],
  },
  {
    resource: RESOURCES.imports,
    label: "Excel Import",
    group: "Administration",
    description: "Bulk import from the original workbook",
    actions: ["create"],
  },
  {
    resource: RESOURCES.users,
    label: "User Management",
    group: "Administration",
    description: "Create users, assign roles and reset passwords",
    actions: [...CRUD, "manage"],
  },
  {
    resource: RESOURCES.roles,
    label: "Role Management",
    group: "Administration",
    description: "Create roles and attach permissions to them",
    actions: [...CRUD, "manage"],
  },
  {
    resource: RESOURCES.permissions,
    label: "Permission Catalogue",
    group: "Administration",
    description: "The list of permissions roles can be built from",
    actions: ["view", "create", "delete"],
  },
];
