import { useMemo, type ReactNode } from "react";

import { useAuth } from "./useAuth";

/**
 * Permission checks for the UI.
 *
 * These mirror the server's rules exactly (see backend
 * services/rbac.service.ts): a grant matches when the user holds `*:manage`,
 * `<resource>:manage`, or the exact `<resource>:<action>`.
 *
 * This is presentation only — hiding a button the user can't use. Every one of
 * these actions is independently enforced by the API, so a user who calls the
 * endpoint directly still gets a 403.
 */
export type PermissionAction = "view" | "create" | "update" | "delete" | "manage";

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

export function evaluate(
  permissions: string[] | undefined,
  resource: string,
  action: PermissionAction,
): boolean {
  if (!permissions?.length) return false;
  if (permissions.includes("*:manage")) return true;
  if (permissions.includes(`${resource}:manage`)) return true;
  return permissions.includes(`${resource}:${action}`);
}

export function usePermissions() {
  const { user } = useAuth();
  const permissions = user?.permissions;

  return useMemo(
    () => ({
      permissions: permissions ?? [],
      /** `can("orders", "create")` */
      can: (resource: string, action: PermissionAction) => evaluate(permissions, resource, action),
      canAny: (checks: Array<[string, PermissionAction]>) =>
        checks.some(([resource, action]) => evaluate(permissions, resource, action)),
      isAdmin: Boolean(permissions?.includes("*:manage")),
    }),
    [permissions],
  );
}

/**
 * Renders its children only when the user holds the permission. `fallback`
 * covers the "show something instead" cases (a disabled hint, an empty state).
 */
export function Can({
  resource,
  action,
  children,
  fallback = null,
}: {
  resource: string;
  action: PermissionAction;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = usePermissions();
  return <>{can(resource, action) ? children : fallback}</>;
}
