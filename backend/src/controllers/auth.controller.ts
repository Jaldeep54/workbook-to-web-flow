import type { CookieOptions, Request, Response } from "express";

import { env, isProduction } from "../config/env.js";
import { Permission } from "../models/permission.model.js";
import { Role } from "../models/role.model.js";
import { User, hashPassword, verifyPassword } from "../models/user.model.js";
import { effectivePermissions } from "../services/rbac.service.js";
import {
  issueRefreshToken,
  refreshCookieMaxAge,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from "../services/token.service.js";
import { ApiError } from "../utils/api-error.js";
import { ok } from "../utils/api-response.js";

/**
 * Session handling.
 *
 * The access token is returned in the response body and kept in memory by the
 * frontend; the refresh token only ever travels in an httpOnly, SameSite
 * cookie, so a successful XSS can't read it and a cross-site page can't use
 * it. Rotation is handled in token.service.
 */
export const REFRESH_COOKIE = "klinzo_refresh_token";

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE ?? isProduction,
    sameSite: isProduction ? "none" : "lax",
    domain: env.COOKIE_DOMAIN,
    path: `${env.API_PREFIX}/auth`,
    maxAge: refreshCookieMaxAge(),
  };
}

async function sessionPayload(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw ApiError.unauthorized("Account no longer exists");

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
    role: role
      ? { id: role._id, name: role.name, slug: role.slug, isSystem: role.isSystem }
      : null,
    /** Flat `resource:action` list — the frontend gates its UI on this. */
    permissions: Array.from(permissions).sort(),
  };
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as { email: string; password: string };

  const user = await User.findOne({ email }).select("+passwordHash");
  // Same response whether the email is unknown or the password is wrong —
  // never confirm which accounts exist.
  const invalid = ApiError.unauthorized("Invalid email or password");
  if (!user) throw invalid;
  if (!(await verifyPassword(password, user.passwordHash))) throw invalid;
  if (!user.isActive) throw ApiError.forbidden("This account has been deactivated");

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken({
    sub: user._id,
    email: user.email,
    role: user.role,
    tv: user.tokensValidFrom ? new Date(user.tokensValidFrom).getTime() : 0,
  });
  const refreshToken = await issueRefreshToken(user._id, {
    userAgent: req.get("user-agent"),
    ip: req.ip,
  });

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return ok(res, { accessToken, user: await sessionPayload(user._id) });
}

export async function refresh(req: Request, res: Response) {
  const presented = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? req.body?.refreshToken;
  if (!presented) throw ApiError.unauthorized("No refresh token supplied");

  const { userId, token } = await rotateRefreshToken(presented, {
    userAgent: req.get("user-agent"),
    ip: req.ip,
  });

  const user = await User.findById(userId).lean();
  if (!user) throw ApiError.unauthorized("Account no longer exists");
  if (!user.isActive) throw ApiError.forbidden("This account has been deactivated");

  const accessToken = signAccessToken({
    sub: user._id,
    email: user.email,
    role: user.role,
    tv: user.tokensValidFrom ? new Date(user.tokensValidFrom).getTime() : 0,
  });

  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
  return ok(res, { accessToken, user: await sessionPayload(user._id) });
}

export async function logout(req: Request, res: Response) {
  const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (presented) await revokeRefreshToken(presented);
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  return ok(res, { message: "Signed out" });
}

export async function me(req: Request, res: Response) {
  return ok(res, await sessionPayload(req.user!.id));
}

export async function updateProfile(req: Request, res: Response) {
  await User.updateOne({ _id: req.user!.id }, { $set: { fullName: req.body.fullName } });
  return ok(res, await sessionPayload(req.user!.id));
}

/**
 * Changing a password revokes every refresh token and bumps `tokensValidFrom`,
 * so any session opened with the old password stops working immediately.
 */
export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  const user = await User.findById(req.user!.id).select("+passwordHash");
  if (!user) throw ApiError.unauthorized();
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.badRequest("Current password is incorrect");
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw ApiError.badRequest("New password must be different from the current one");
  }

  user.passwordHash = await hashPassword(newPassword);
  user.tokensValidFrom = new Date();
  await user.save();
  await revokeAllRefreshTokens(user._id);

  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
  return ok(res, { message: "Password updated — please sign in again" });
}

/** The permission catalogue the current user actually holds. */
export async function myPermissions(req: Request, res: Response) {
  const names = Array.from(req.user!.permissions);
  const docs = await Permission.find({ name: { $in: names } })
    .sort({ group: 1, resource: 1, action: 1 })
    .lean();
  return ok(res, {
    names: names.sort(),
    permissions: docs.map((d) => ({
      id: d._id,
      name: d.name,
      resource: d.resource,
      action: d.action,
      label: d.label,
      group: d.group,
    })),
  });
}
