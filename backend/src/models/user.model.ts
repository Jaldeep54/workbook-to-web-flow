import bcrypt from "bcryptjs";
import { Schema, model } from "mongoose";

import { env } from "../config/env.js";
import { platformSchemaOptions, uuidId } from "./base.js";

/**
 * Users authenticate with an email + bcrypt-hashed password. The hash is
 * `select: false`, so it can never leak into a response by accident — code
 * that needs it (login, password change) asks for it explicitly.
 *
 * Authorization comes from the user's role, plus optional `directPermissions`
 * granted to that one user on top of their role (the "give this marketing user
 * delete on Page B as well" case) — a union, evaluated in services/rbac.
 */
export interface IUser {
  _id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: string;
  /** Extra permission ids granted to this user beyond their role. */
  directPermissions: string[];
  isActive: boolean;
  lastLoginAt: Date | null;
  /** Invalidates every access token issued before this moment. */
  tokensValidFrom: Date;
  createdBy: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new Schema<IUser>(
  {
    _id: uuidId,
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address"],
    },
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    role: { type: String, ref: "Role", required: true },
    directPermissions: { type: [String], ref: "Permission", default: [] },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    tokensValidFrom: { type: Date, default: () => new Date() },
    createdBy: { type: String, ref: "User", default: null },
  },
  platformSchemaOptions(),
);

userSchema.index({ role: 1 });
userSchema.index({ isActive: 1, fullName: 1 });

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export const User = model<IUser>("User", userSchema, "users");
