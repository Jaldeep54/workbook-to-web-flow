import { Permission, WILDCARD_RESOURCE, permissionName } from "../models/permission.model.js";
import { Role } from "../models/role.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/api-error.js";

/**
 * Permission evaluation.
 *
 * A user's effective permission set is the union of:
 *   - every permission attached to their role, and
 *   - any `directPermissions` granted to them individually.
 *
 * A grant matches a requested (resource, action) when the set contains:
 *   - `*:manage`            — the superuser grant the Admin role holds, so new
 *                             permissions are covered without re-seeding roles;
 *   - `<resource>:manage`   — full control of one module implies every action
 *                             on it (view/create/update/delete);
 *   - `<resource>:<action>` — the exact grant.
 *
 * Nothing here is hard-coded per role: roles and permissions are rows, and
 * adding a module means seeding its permissions, not editing this file.
 */
export type PermissionSet = Set<string>;

export const SUPERUSER_PERMISSION = permissionName(WILDCARD_RESOURCE, "manage");

export function can(permissions: PermissionSet, resource: string, action: string): boolean {
  if (permissions.has(SUPERUSER_PERMISSION)) return true;
  if (permissions.has(permissionName(resource, "manage"))) return true;
  return permissions.has(permissionName(resource, action));
}

export function canAny(
  permissions: PermissionSet,
  required: Array<{ resource: string; action: string }>,
): boolean {
  return required.some((r) => can(permissions, r.resource, r.action));
}

type CacheEntry = { names: string[]; expiresAt: number };
const roleCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

/** Called whenever a role's permissions or a permission row changes. */
export function invalidatePermissionCache(roleId?: string): void {
  if (roleId) roleCache.delete(roleId);
  else roleCache.clear();
}

async function permissionNamesForIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const docs = await Permission.find({ _id: { $in: ids } }, { name: 1 }).lean();
  return docs.map((d) => d.name);
}

async function rolePermissionNames(roleId: string): Promise<string[]> {
  const cached = roleCache.get(roleId);
  if (cached && cached.expiresAt > Date.now()) return cached.names;

  const role = await Role.findById(roleId, { permissions: 1 }).lean();
  const names = role ? await permissionNamesForIds(role.permissions as string[]) : [];
  roleCache.set(roleId, { names, expiresAt: Date.now() + CACHE_TTL_MS });
  return names;
}

/** Effective permission names for one user (role grants + direct grants). */
export async function effectivePermissions(user: {
  role: string;
  directPermissions?: string[];
}): Promise<PermissionSet> {
  const [fromRole, fromUser] = await Promise.all([
    rolePermissionNames(user.role),
    permissionNamesForIds((user.directPermissions ?? []) as string[]),
  ]);
  return new Set([...fromRole, ...fromUser]);
}

/** Rejects unknown permission ids early, with a clear message. */
export async function assertPermissionIdsExist(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const unique = Array.from(new Set(ids));
  const found = await Permission.countDocuments({ _id: { $in: unique } });
  if (found !== unique.length) {
    throw ApiError.badRequest("One or more permission ids do not exist");
  }
}

/**
 * Guard against locking every administrator out: the last active user holding
 * the superuser grant can't be deactivated, deleted, or moved to a role that
 * doesn't have it.
 */
export async function countActiveSuperusers(excludeUserId?: string): Promise<number> {
  const superuser = await Permission.findOne({ name: SUPERUSER_PERMISSION }, { _id: 1 }).lean();
  if (!superuser) return 0;

  const roleIds = (await Role.find({ permissions: superuser._id }, { _id: 1 }).lean()).map(
    (r) => r._id,
  );

  const filter: Record<string, unknown> = {
    isActive: true,
    $or: [{ role: { $in: roleIds } }, { directPermissions: superuser._id }],
  };
  if (excludeUserId) filter._id = { $ne: excludeUserId };

  return User.countDocuments(filter);
}

export async function assertNotLastSuperuser(userId: string, message: string): Promise<void> {
  const user = await User.findById(userId, { role: 1, directPermissions: 1, isActive: 1 }).lean();
  if (!user || !user.isActive) return;

  const permissions = await effectivePermissions({
    role: user.role,
    directPermissions: user.directPermissions as string[],
  });
  if (!permissions.has(SUPERUSER_PERMISSION)) return;

  const remaining = await countActiveSuperusers(userId);
  if (remaining === 0) throw ApiError.badRequest(message);
}
