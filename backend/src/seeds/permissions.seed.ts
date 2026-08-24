import { PERMISSION_CATALOGUE } from "../config/permissions.js";
import { logger } from "../config/logger.js";
import { Permission, WILDCARD_RESOURCE, permissionName } from "../models/permission.model.js";
import { ADMIN_ROLE_SLUG, Role } from "../models/role.model.js";
import { invalidatePermissionCache } from "../services/rbac.service.js";

/**
 * Seeds the permission catalogue and the bootstrap roles.
 *
 * Idempotent: re-running adds anything new and refreshes labels/descriptions
 * without touching role assignments an administrator has made. The Admin role
 * is the one exception — it is always re-granted everything, so a new module's
 * permissions never leave the administrator locked out of it.
 */
export async function seedPermissions(): Promise<Map<string, string>> {
  const definitions = [
    ...PERMISSION_CATALOGUE.flatMap((entry) =>
      entry.actions.map((action) => ({
        resource: entry.resource,
        action,
        name: permissionName(entry.resource, action),
        label: entry.label,
        description: entry.description,
        group: entry.group,
        isSystem: true,
      })),
    ),
    {
      resource: WILDCARD_RESOURCE,
      action: "manage" as const,
      name: permissionName(WILDCARD_RESOURCE, "manage"),
      label: "Full Access",
      description: "Unrestricted access to every module, including ones added later",
      group: "Administration",
      isSystem: true,
    },
  ];

  await Permission.bulkWrite(
    definitions.map((definition) => ({
      updateOne: {
        filter: { name: definition.name },
        update: {
          $set: {
            resource: definition.resource,
            action: definition.action,
            label: definition.label,
            description: definition.description,
            group: definition.group,
            isSystem: true,
          },
          $setOnInsert: { name: definition.name },
        },
        upsert: true,
      },
    })),
  );

  const stored = await Permission.find({}, { name: 1 }).lean();
  logger.info(`Seeded ${definitions.length} permissions (${stored.length} total in catalogue)`);
  invalidatePermissionCache();

  return new Map(stored.map((p) => [p.name, p._id]));
}

/**
 * Bootstrap roles.
 *
 * Admin is a system role holding the wildcard grant. The other two are
 * ordinary, fully editable examples that show what granular assignment looks
 * like — an administrator can rename, re-scope or delete them.
 */
export async function seedRoles(permissionIdByName: Map<string, string>): Promise<Map<string, string>> {
  const id = (name: string) => permissionIdByName.get(name);
  const ids = (names: string[]) => names.map(id).filter((v): v is string => Boolean(v));

  const definitions = [
    {
      name: "Admin",
      slug: ADMIN_ROLE_SLUG,
      description: "Full access to every module and to user, role and permission management",
      isSystem: true,
      handlesShops: false,
      permissions: Array.from(permissionIdByName.values()),
    },
    {
      name: "Marketing",
      slug: "marketing",
      description:
        "Field/marketing staff: works with shops and orders, reads reports, no access to finance or administration",
      isSystem: false,
      permissions: ids([
        "dashboard:view",
        "shops:view",
        "shops:create",
        "shops:update",
        "shop_areas:view",
        "shop_areas:create",
        "orders:view",
        "orders:create",
        "orders:update",
        "deliveries:view",
        "label_stock:view",
        "reports:view",
        "sku_opportunity:view",
        "products:view",
        "label_products:view",
      ]),
      handlesShops: false,
    },
    {
      name: "Salesman",
      slug: "salesman",
      description:
        "Field sales: the people a shop can be 'Handled by'. Works with shops and orders, no finance or administration",
      isSystem: false,
      // Members of any role flagged `handlesShops` populate a shop's
      // "Handled by" picker — deactivate the user to retire them from it.
      handlesShops: true,
      permissions: ids([
        "dashboard:view",
        "shops:view",
        "shops:create",
        "shops:update",
        "shop_areas:view",
        "orders:view",
        "orders:create",
        "orders:update",
        "deliveries:view",
        "products:view",
      ]),
    },
    {
      name: "Accounts",
      slug: "accounts",
      description: "Collections and cash: payments, costs and the cash position, read-only elsewhere",
      isSystem: false,
      permissions: ids([
        "dashboard:view",
        "shops:view",
        "orders:view",
        "deliveries:view",
        "payments:view",
        "payments:update",
        "costs:view",
        "costs:create",
        "costs:update",
        "costs:delete",
        "cash_position:view",
        "cash_position:create",
        "cash_position:delete",
        "reports:view",
        "bills:view",
        "bills:create",
      ]),
      handlesShops: false,
    },
  ];

  for (const definition of definitions) {
    const existing = await Role.findOne({ slug: definition.slug });
    if (!existing) {
      await Role.create(definition);
      continue;
    }
    // Never clobber an administrator's own permission choices on re-seed;
    // Admin is refreshed so newly added permissions are always covered.
    if (definition.slug === ADMIN_ROLE_SLUG) {
      existing.permissions = definition.permissions;
      existing.isSystem = true;
      await existing.save();
    }
  }

  const roles = await Role.find({}, { slug: 1 }).lean();
  logger.info(`Roles available: ${roles.map((r) => r.slug).join(", ")}`);
  invalidatePermissionCache();

  return new Map(roles.map((r) => [r.slug, r._id]));
}
