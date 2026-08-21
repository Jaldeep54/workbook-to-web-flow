import type { NextFunction, Request, Response } from "express";

import { User } from "../models/user.model.js";
import { effectivePermissions, type PermissionSet } from "../services/rbac.service.js";
import { verifyAccessToken } from "../services/token.service.js";
import { ApiError } from "../utils/api-error.js";
import { asyncHandler } from "../utils/async-handler.js";

export type AuthenticatedUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  permissions: PermissionSet;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

/**
 * Verifies the access token, then re-reads the user on every request so a
 * deactivated account, a changed role, or a revoked permission takes effect
 * immediately instead of at the next token expiry.
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized("Missing bearer token");

  const payload = verifyAccessToken(token);

  const user = await User.findById(payload.sub, {
    email: 1,
    fullName: 1,
    role: 1,
    directPermissions: 1,
    isActive: 1,
    tokensValidFrom: 1,
  }).lean();

  if (!user) throw ApiError.unauthorized("Account no longer exists");
  if (!user.isActive) throw ApiError.forbidden("This account has been deactivated");

  const validFrom = user.tokensValidFrom ? new Date(user.tokensValidFrom).getTime() : 0;
  if (payload.tv < validFrom) {
    throw ApiError.unauthorized("Session is no longer valid, please sign in again");
  }

  req.user = {
    id: user._id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    permissions: await effectivePermissions({
      role: user.role,
      directPermissions: user.directPermissions as string[],
    }),
  };

  next();
});
