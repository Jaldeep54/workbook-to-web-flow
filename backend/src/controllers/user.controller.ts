import type { Request, Response } from "express";

import { Role } from "../models/role.model.js";
import { User, hashPassword } from "../models/user.model.js";
import {
  assertNotLastSuperuser,
  assertPermissionIdsExist,
  effectivePermissions,
} from "../services/rbac.service.js";
import { revokeAllRefreshTokens } from "../services/token.service.js";
import { ApiError } from "../utils/api-error.js";
import { buildPaginationMeta, created, ok, paginated } from "../utils/api-response.js";
import { parseListQuery, searchRegex } from "../utils/query.js";

/** Users never leave the API with their password hash — it isn't selected. */
async function present(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw ApiError.notFound("User not found");
  const [role, permissions] = await Promise.all([
    Role.findById(user.role).lean(),
    effectivePermissions({ role: user.role, directPermissions: user.directPermissions as string[] }),
  ]);
  return {
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role: role ? { id: role._id, name: role.name, slug: role.slug } : null,
    directPermissions: user.directPermissions ?? [],
    permissions: Array.from(permissions).sort(),
  };
}

export async function listUsers(req: Request, res: Response) {
  const { page, limit, skip, search, sort } = parseListQuery(
    req.query as Record<string, unknown>,
    ["fullName", "email", "createdAt", "lastLoginAt"],
    { sortBy: "fullName" },
  );

  const filter: Record<string, unknown> = {};
  if (search) {
    const rx = searchRegex(search);
    filter.$or = [{ fullName: rx }, { email: rx }];
  }
  if (req.query.role) filter.role = req.query.role;
  if (req.query.isActive) filter.isActive = req.query.isActive === "true";

  const [rows, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  const roles = await Role.find({ _id: { $in: rows.map((r) => r.role) } }).lean();
  const roleById = new Map(roles.map((r) => [r._id, r]));

  return paginated(
    res,
    rows.map((user) => ({
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      role: roleById.get(user.role)
        ? { id: user.role, name: roleById.get(user.role)!.name, slug: roleById.get(user.role)!.slug }
        : null,
      directPermissions: user.directPermissions ?? [],
    })),
    buildPaginationMeta(page, limit, total),
  );
}

export async function getUser(req: Request, res: Response) {
  return ok(res, await present(req.params.id));
}

export async function createUser(req: Request, res: Response) {
  const body = req.body as {
    email: string;
    password: string;
    fullName: string;
    role: string;
    directPermissions: string[];
    isActive: boolean;
  };

  const role = await Role.findById(body.role).lean();
  if (!role) throw ApiError.badRequest("The selected role does not exist");
  await assertPermissionIdsExist(body.directPermissions ?? []);

  if (await User.exists({ email: body.email })) {
    throw ApiError.conflict("A user with this email already exists");
  }

  const user = await User.create({
    email: body.email,
    passwordHash: await hashPassword(body.password),
    fullName: body.fullName,
    role: body.role,
    directPermissions: body.directPermissions ?? [],
    isActive: body.isActive ?? true,
    createdBy: req.user?.id ?? null,
  });

  return created(res, await present(user._id));
}

export async function updateUser(req: Request, res: Response) {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound("User not found");

  const body = req.body as Partial<{
    email: string;
    fullName: string;
    role: string;
    directPermissions: string[];
    isActive: boolean;
  }>;

  if (body.email && body.email !== target.email) {
    if (await User.exists({ email: body.email, _id: { $ne: target._id } })) {
      throw ApiError.conflict("A user with this email already exists");
    }
    target.email = body.email;
  }

  if (body.role && body.role !== target.role) {
    if (!(await Role.exists({ _id: body.role }))) {
      throw ApiError.badRequest("The selected role does not exist");
    }
    // Moving the last remaining administrator onto a lesser role would lock
    // everyone out of user and role management for good.
    await assertNotLastSuperuser(
      target._id,
      "This is the last active administrator — assign the Admin role to someone else first",
    );
    target.role = body.role;
  }

  if (body.directPermissions) {
    await assertPermissionIdsExist(body.directPermissions);
    target.directPermissions = body.directPermissions;
  }

  if (body.fullName) target.fullName = body.fullName;

  if (body.isActive === false && target.isActive) {
    if (target._id === req.user?.id) throw ApiError.badRequest("You cannot deactivate your own account");
    await assertNotLastSuperuser(
      target._id,
      "This is the last active administrator and cannot be deactivated",
    );
    target.isActive = false;
    await revokeAllRefreshTokens(target._id);
    target.tokensValidFrom = new Date();
  } else if (body.isActive === true) {
    target.isActive = true;
  }

  await target.save();
  return ok(res, await present(target._id));
}

/** Admin-set password: revokes the user's sessions so the new one is required. */
export async function resetUserPassword(req: Request, res: Response) {
  const target = await User.findById(req.params.id).select("+passwordHash");
  if (!target) throw ApiError.notFound("User not found");

  target.passwordHash = await hashPassword((req.body as { password: string }).password);
  target.tokensValidFrom = new Date();
  await target.save();
  await revokeAllRefreshTokens(target._id);

  return ok(res, { message: `Password updated for ${target.email}` });
}

export async function deleteUser(req: Request, res: Response) {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound("User not found");
  if (target._id === req.user?.id) throw ApiError.badRequest("You cannot delete your own account");

  await assertNotLastSuperuser(
    target._id,
    "This is the last active administrator and cannot be deleted",
  );

  await revokeAllRefreshTokens(target._id);
  await target.deleteOne();
  return ok(res, { message: "User deleted" });
}
