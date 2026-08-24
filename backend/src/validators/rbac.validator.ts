import { z } from "zod";

import { PERMISSION_ACTIONS } from "../models/permission.model.js";
import { passwordSchema } from "./auth.validator.js";
import { idString, listQuery } from "./common.validator.js";

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
  role: idString,
  directPermissions: z.array(idString).max(200).optional().default([]),
  isActive: z.boolean().optional().default(true),
});

export const updateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    fullName: z.string().trim().min(2).max(120).optional(),
    role: idString.optional(),
    directPermissions: z.array(idString).max(200).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

export const resetPasswordSchema = z.object({ password: passwordSchema });

export const userListQuery = listQuery.extend({
  role: idString.optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, "Role name is too short").max(60),
  description: z.string().trim().max(300).optional().default(""),
  permissions: z.array(idString).max(500).optional().default([]),
  /** Members of this role appear in a shop's "Handled by" picker. */
  handlesShops: z.boolean().optional().default(false),
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(300).optional(),
    permissions: z.array(idString).max(500).optional(),
    handlesShops: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

export const setRolePermissionsSchema = z.object({
  permissions: z.array(idString).max(500),
});

/**
 * Permissions can be created at runtime so a new page/module can be governed
 * without a code change — the RBAC system is data-driven by design.
 */
export const createPermissionSchema = z.object({
  resource: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_*-]+$/, "Use lowercase letters, numbers, dashes or underscores"),
  action: z.enum(PERMISSION_ACTIONS),
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().default(""),
  group: z.string().trim().max(60).optional().default("General"),
});
