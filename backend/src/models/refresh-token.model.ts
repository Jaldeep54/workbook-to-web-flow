import { Schema, model } from "mongoose";

import { platformSchemaOptions, uuidId } from "./base.js";

/**
 * Refresh tokens are stored hashed (never in plain text) and rotated on every
 * use: refreshing revokes the presented token and issues a new one. Reuse of
 * an already-revoked token is treated as theft and revokes the whole family
 * for that user.
 *
 * Expired rows are removed automatically by the TTL index.
 */
export interface IRefreshToken {
  _id: string;
  user: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    _id: uuidId,
    user: { type: String, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenHash: { type: String, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  platformSchemaOptions(),
);

refreshTokenSchema.index({ user: 1, revokedAt: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<IRefreshToken>("RefreshToken", refreshTokenSchema, "refresh_tokens");
