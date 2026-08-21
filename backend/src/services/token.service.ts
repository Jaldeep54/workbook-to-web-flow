import { createHash, randomBytes } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";

import { env } from "../config/env.js";
import { RefreshToken } from "../models/refresh-token.model.js";
import { ApiError } from "../utils/api-error.js";

/**
 * Short-lived access tokens (JWT, sent in the Authorization header) plus
 * long-lived opaque refresh tokens (random bytes, delivered in an httpOnly
 * cookie and stored only as a SHA-256 hash).
 *
 * Access tokens are never persisted; they carry the user id and a `tv` stamp
 * that is compared against the user's `tokensValidFrom`, so changing a
 * password or deactivating an account invalidates issued tokens immediately.
 */
export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: string;
  /** tokensValidFrom, epoch ms — issued-before-this tokens are rejected. */
  tv: number;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: "klinzo-ops-api",
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: "klinzo-ops-api" }) as AccessTokenPayload;
  } catch (error) {
    const message =
      error instanceof jwt.TokenExpiredError ? "Access token expired" : "Invalid access token";
    throw ApiError.unauthorized(message);
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshTtlMs(): number {
  const raw = env.JWT_REFRESH_EXPIRES_IN.trim();
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]] ?? 86_400_000;
  return value * unit;
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + refreshTtlMs());
}

export const refreshCookieMaxAge = refreshTtlMs;

export async function issueRefreshToken(
  userId: string,
  context: { userAgent?: string | null; ip?: string | null } = {},
): Promise<string> {
  const token = randomBytes(48).toString("base64url");
  await RefreshToken.create({
    user: userId,
    tokenHash: hashToken(token),
    expiresAt: refreshTokenExpiry(),
    userAgent: context.userAgent ?? null,
    ip: context.ip ?? null,
  });
  return token;
}

/**
 * Rotates a refresh token: the presented token is revoked and a fresh one
 * issued. Presenting an already-revoked token is treated as replay/theft and
 * revokes every live token for that user.
 */
export async function rotateRefreshToken(
  presented: string,
  context: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ userId: string; token: string }> {
  const tokenHash = hashToken(presented);
  const stored = await RefreshToken.findOne({ tokenHash });

  if (!stored) throw ApiError.unauthorized("Invalid refresh token");

  if (stored.revokedAt) {
    await RefreshToken.updateMany(
      { user: stored.user, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    throw ApiError.unauthorized("Refresh token has already been used");
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized("Refresh token expired");
  }

  const next = await issueRefreshToken(stored.user, context);
  stored.revokedAt = new Date();
  stored.replacedByTokenHash = hashToken(next);
  await stored.save();

  return { userId: stored.user, token: next };
}

export async function revokeRefreshToken(presented: string): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: hashToken(presented), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
