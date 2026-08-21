import { Schema, model } from "mongoose";

import { platformSchemaOptions, uuidId } from "./base.js";

/**
 * Permissions are data, not code.
 *
 * A permission is a (resource, action) pair — "orders:create", "reports:view".
 * New pages/actions are added by inserting rows (or seeding them), never by
 * editing an enum in the source, which is what keeps the RBAC system
 * extensible: a new module ships its permissions in the seed and admins can
 * immediately attach them to roles.
 *
 * The wildcard permission `*:manage` means "everything" and is what the Admin
 * role holds in addition to the explicit list, so a brand-new permission is
 * automatically covered for admins.
 */
export const PERMISSION_ACTIONS = ["view", "create", "update", "delete", "manage"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const WILDCARD_RESOURCE = "*";

export function permissionName(resource: string, action: string): string {
  return `${resource}:${action}`;
}

export interface IPermission {
  _id: string;
  /** Page/module the permission guards, e.g. "orders", "users", "*". */
  resource: string;
  action: PermissionAction;
  /** Denormalized `resource:action`, unique — the id used across the API. */
  name: string;
  /** Human label for the permission matrix UI, e.g. "Orders". */
  label: string;
  description: string;
  /** Grouping for the admin UI (e.g. "Operations", "Administration"). */
  group: string;
  /** Seeded permissions can't be deleted through the API. */
  isSystem: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const permissionSchema = new Schema<IPermission>(
  {
    _id: uuidId,
    resource: { type: String, required: true, trim: true, lowercase: true },
    action: { type: String, required: true, enum: PERMISSION_ACTIONS },
    name: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    group: { type: String, trim: true, default: "General" },
    isSystem: { type: Boolean, default: false },
  },
  platformSchemaOptions(),
);

permissionSchema.index({ resource: 1, action: 1 }, { unique: true });
permissionSchema.index({ group: 1, resource: 1 });

permissionSchema.pre("validate", function assignName(next) {
  if (this.resource && this.action) this.name = permissionName(this.resource, this.action);
  next();
});

export const Permission = model<IPermission>("Permission", permissionSchema, "permissions");
