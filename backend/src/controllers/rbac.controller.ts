import type { Request, Response } from "express";

import { Permission, permissionName } from "../models/permission.model.js";
import { ADMIN_ROLE_SLUG, Role, slugifyRoleName } from "../models/role.model.js";
import { User } from "../models/user.model.js";
import {
  assertPermissionIdsExist,
  invalidatePermissionCache,
  SUPERUSER_PERMISSION,
} from "../services/rbac.service.js";
import { ApiError } from "../utils/api-error.js";
import { created, ok } from "../utils/api-response.js";
import { searchRegex } from "../utils/query.js";

/* ------------------------------------------------------------- permissions */

/**
 * The permission catalogue drives the admin UI's matrix: grouped by module,
 * one row per resource, one checkbox per action.
 */
export async function listPermissions(req: Request, res: Response) {
  const filter: Record<string, unknown> = {};
  if (typeof req.query.search === "string" && req.query.search.trim()) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ name: rx }, { label: rx }, { group: rx }];
  }

  const permissions = await Permission.find(filter).sort({ group: 1, label: 1, action: 1 }).lean();

  const grouped = new Map<string, Map<string, { label: string; actions: Array<{ id: string; action: string; name: string }> }>>();
  for (const p of permissions) {
    const group = grouped.get(p.group) ?? new Map();
    const resource = group.get(p.resource) ?? { label: p.label, actions: [] };
    resource.actions.push({ id: p._id, action: p.action, name: p.name });
    group.set(p.resource, resource);
    grouped.set(p.group, group);
  }

  return ok(res, {
    permissions: permissions.map((p) => ({
      id: p._id,
      name: p.name,
      resource: p.resource,
      action: p.action,
      label: p.label,
      description: p.description,
      group: p.group,
      isSystem: p.isSystem,
    })),
    groups: Array.from(grouped.entries()).map(([group, resources]) => ({
      group,
      resources: Array.from(resources.entries()).map(([resource, value]) => ({
        resource,
        label: value.label,
        actions: value.actions,
      })),
    })),
  });
}

export async function createPermission(req: Request, res: Response) {
  const body = req.body as {
    resource: string;
    action: string;
    label: string;
    description: string;
    group: string;
  };

  const name = permissionName(body.resource, body.action);
  if (await Permission.exists({ name })) {
    throw ApiError.conflict(`Permission "${name}" already exists`);
  }

  const permission = await Permission.create({ ...body, name });
  invalidatePermissionCache();
  return created(res, permission.toJSON());
}

export async function deletePermission(req: Request, res: Response) {
  const permission = await Permission.findById(req.params.id);
  if (!permission) throw ApiError.notFound("Permission not found");
  if (permission.isSystem) throw ApiError.badRequest("Built-in permissions cannot be deleted");

  await Promise.all([
    Role.updateMany({ permissions: permission._id }, { $pull: { permissions: permission._id } }),
    User.updateMany(
      { directPermissions: permission._id },
      { $pull: { directPermissions: permission._id } },
    ),
  ]);
  await permission.deleteOne();
  invalidatePermissionCache();

  return ok(res, { message: "Permission deleted" });
}

/* -------------------------------------------------------------------- roles */

async function presentRole(roleId: string) {
  const role = await Role.findById(roleId).lean();
  if (!role) throw ApiError.notFound("Role not found");
  const [permissions, userCount] = await Promise.all([
    Permission.find({ _id: { $in: role.permissions } })
      .sort({ group: 1, label: 1, action: 1 })
      .lean(),
    User.countDocuments({ role: roleId }),
  ]);

  return {
    id: role._id,
    name: role.name,
    slug: role.slug,
    description: role.description,
    isSystem: role.isSystem,
    handlesShops: role.handlesShops ?? false,
    userCount,
    permissions: permissions.map((p) => ({
      id: p._id,
      name: p.name,
      resource: p.resource,
      action: p.action,
      label: p.label,
      group: p.group,
    })),
    permissionIds: permissions.map((p) => p._id),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export async function listRoles(_req: Request, res: Response) {
  const roles = await Role.find().sort({ name: 1 }).lean();
  const counts = await User.aggregate<{ _id: string; count: number }>([
    { $group: { _id: "$role", count: { $sum: 1 } } },
  ]);
  const countByRole = new Map(counts.map((c) => [c._id, c.count]));

  return ok(
    res,
    roles.map((role) => ({
      id: role._id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystem: role.isSystem,
      handlesShops: role.handlesShops ?? false,
      permissionIds: role.permissions ?? [],
      permissionCount: (role.permissions ?? []).length,
      userCount: countByRole.get(role._id) ?? 0,
      createdAt: role.createdAt,
    })),
  );
}

export async function getRole(req: Request, res: Response) {
  return ok(res, await presentRole(req.params.id));
}

export async function createRole(req: Request, res: Response) {
  const body = req.body as {
    name: string;
    description: string;
    permissions: string[];
    handlesShops?: boolean;
  };
  const slug = slugifyRoleName(body.name);
  if (!slug) throw ApiError.badRequest("Role name must contain letters or numbers");
  if (await Role.exists({ slug })) throw ApiError.conflict(`A role named "${body.name}" already exists`);

  await assertPermissionIdsExist(body.permissions ?? []);

  const role = await Role.create({
    name: body.name,
    slug,
    description: body.description ?? "",
    permissions: body.permissions ?? [],
    handlesShops: body.handlesShops ?? false,
  });

  return created(res, await presentRole(role._id));
}

export async function updateRole(req: Request, res: Response) {
  const role = await Role.findById(req.params.id);
  if (!role) throw ApiError.notFound("Role not found");

  const body = req.body as Partial<{
    name: string;
    description: string;
    permissions: string[];
    handlesShops: boolean;
  }>;

  if (body.name && body.name !== role.name) {
    if (role.isSystem) throw ApiError.badRequest("Built-in roles cannot be renamed");
    const slug = slugifyRoleName(body.name);
    if (await Role.exists({ slug, _id: { $ne: role._id } })) {
      throw ApiError.conflict(`A role named "${body.name}" already exists`);
    }
    role.name = body.name;
    role.slug = slug;
  }

  if (body.description !== undefined) role.description = body.description;
  if (body.handlesShops !== undefined) role.handlesShops = body.handlesShops;

  if (body.permissions) {
    await assertPermissionIdsExist(body.permissions);
    // Stripping the superuser grant from the Admin role would leave the system
    // with no way back in.
    if (role.slug === ADMIN_ROLE_SLUG) {
      const superuser = await Permission.findOne({ name: SUPERUSER_PERMISSION }, { _id: 1 }).lean();
      if (superuser && !body.permissions.includes(superuser._id)) {
        throw ApiError.badRequest("The Admin role must keep full access");
      }
    }
    role.permissions = body.permissions;
  }

  await role.save();
  invalidatePermissionCache(role._id);
  return ok(res, await presentRole(role._id));
}

export async function setRolePermissions(req: Request, res: Response) {
  req.body = { permissions: (req.body as { permissions: string[] }).permissions };
  return updateRole(req, res);
}

export async function deleteRole(req: Request, res: Response) {
  const role = await Role.findById(req.params.id);
  if (!role) throw ApiError.notFound("Role not found");
  if (role.isSystem) throw ApiError.badRequest("Built-in roles cannot be deleted");

  const inUse = await User.countDocuments({ role: role._id });
  if (inUse > 0) {
    throw ApiError.conflict(
      `${inUse} user${inUse === 1 ? "" : "s"} still use this role — move them to another role first`,
    );
  }

  await role.deleteOne();
  invalidatePermissionCache(role._id);
  return ok(res, { message: "Role deleted" });
}
