import { Schema, model } from "mongoose";

import { platformSchemaOptions, uuidId } from "./base.js";

/**
 * A role is a named bundle of permissions. Roles are created and edited at
 * runtime by an administrator — "Marketing", "Editor", "Accounts" — and the
 * only thing the code knows about is the Admin role's slug, used to stop the
 * last administrator from locking everyone out.
 */
export const ADMIN_ROLE_SLUG = "admin";

export function slugifyRoleName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface IRole {
  _id: string;
  name: string;
  slug: string;
  description: string;
  /** Permission ids (Permission._id). Empty means "no access to anything". */
  permissions: string[];
  /** System roles (Admin) can't be renamed away or deleted. */
  isSystem: boolean;
  /**
   * Marks the role as one whose members handle shops in the field — the
   * "Handled by" picker on a shop lists the active users of every role with
   * this flag. Kept as a role flag rather than a hardcoded slug so an
   * administrator can rename or add sales roles without a code change.
   */
  handlesShops: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const roleSchema = new Schema<IRole>(
  {
    _id: uuidId,
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, trim: true, default: "" },
    permissions: { type: [String], ref: "Permission", default: [] },
    isSystem: { type: Boolean, default: false },
    handlesShops: { type: Boolean, default: false },
  },
  platformSchemaOptions(),
);

roleSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

roleSchema.pre("validate", function assignSlug(next) {
  if (!this.slug && this.name) this.slug = slugifyRoleName(this.name);
  next();
});

export const Role = model<IRole>("Role", roleSchema, "roles");
