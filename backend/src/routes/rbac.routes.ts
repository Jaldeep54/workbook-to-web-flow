import { Router } from "express";

import { RESOURCES } from "../config/permissions.js";
import * as rbac from "../controllers/rbac.controller.js";
import * as users from "../controllers/user.controller.js";
import { authorize, authorizeSelfOr } from "../middleware/authorize.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { idParam, listQuery } from "../validators/common.validator.js";
import {
  createPermissionSchema,
  createRoleSchema,
  createUserSchema,
  resetPasswordSchema,
  setRolePermissionsSchema,
  updateRoleSchema,
  updateUserSchema,
  userListQuery,
} from "../validators/rbac.validator.js";

/**
 * User, role and permission administration.
 *
 * Every route is guarded by an explicit permission: an authenticated user with
 * no `users:*` grant gets 403 here even though they can use the rest of the
 * app perfectly well.
 */
export const userRouter = Router();

userRouter.get(
  "/",
  authorize(RESOURCES.users, "view"),
  validate({ query: userListQuery }),
  asyncHandler(users.listUsers),
);
userRouter.post(
  "/",
  authorize(RESOURCES.users, "create"),
  validate({ body: createUserSchema }),
  asyncHandler(users.createUser),
);
userRouter.get(
  "/:id",
  authorizeSelfOr(RESOURCES.users, "view"),
  validate({ params: idParam }),
  asyncHandler(users.getUser),
);
userRouter.patch(
  "/:id",
  authorize(RESOURCES.users, "update"),
  validate({ params: idParam, body: updateUserSchema }),
  asyncHandler(users.updateUser),
);
userRouter.post(
  "/:id/password",
  authorize(RESOURCES.users, "manage"),
  validate({ params: idParam, body: resetPasswordSchema }),
  asyncHandler(users.resetUserPassword),
);
userRouter.delete(
  "/:id",
  authorize(RESOURCES.users, "delete"),
  validate({ params: idParam }),
  asyncHandler(users.deleteUser),
);

export const roleRouter = Router();

roleRouter.get("/", authorize(RESOURCES.roles, "view"), asyncHandler(rbac.listRoles));
roleRouter.post(
  "/",
  authorize(RESOURCES.roles, "create"),
  validate({ body: createRoleSchema }),
  asyncHandler(rbac.createRole),
);
roleRouter.get(
  "/:id",
  authorize(RESOURCES.roles, "view"),
  validate({ params: idParam }),
  asyncHandler(rbac.getRole),
);
roleRouter.patch(
  "/:id",
  authorize(RESOURCES.roles, "update"),
  validate({ params: idParam, body: updateRoleSchema }),
  asyncHandler(rbac.updateRole),
);
roleRouter.put(
  "/:id/permissions",
  authorize(RESOURCES.roles, "manage"),
  validate({ params: idParam, body: setRolePermissionsSchema }),
  asyncHandler(rbac.setRolePermissions),
);
roleRouter.delete(
  "/:id",
  authorize(RESOURCES.roles, "delete"),
  validate({ params: idParam }),
  asyncHandler(rbac.deleteRole),
);

export const permissionRouter = Router();

permissionRouter.get(
  "/",
  authorize(RESOURCES.permissions, "view"),
  validate({ query: listQuery }),
  asyncHandler(rbac.listPermissions),
);
permissionRouter.post(
  "/",
  authorize(RESOURCES.permissions, "create"),
  validate({ body: createPermissionSchema }),
  asyncHandler(rbac.createPermission),
);
permissionRouter.delete(
  "/:id",
  authorize(RESOURCES.permissions, "delete"),
  validate({ params: idParam }),
  asyncHandler(rbac.deletePermission),
);
