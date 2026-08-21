import type { NextFunction, Request, RequestHandler, Response } from "express";

import { can, canAny } from "../services/rbac.service.js";
import { ApiError } from "../utils/api-error.js";

/**
 * The enforcement point for RBAC. Hiding a button in the UI is a convenience;
 * this is the actual security boundary — every mutating and every data-reading
 * route mounts one of these, so calling an endpoint directly with a valid
 * token but the wrong role still returns 403.
 */
export function authorize(resource: string, action: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!can(req.user.permissions, resource, action)) {
      return next(
        ApiError.forbidden(`Missing permission "${resource}:${action}" for this action`),
      );
    }
    next();
  };
}

/** Passes when the user holds at least one of the listed permissions. */
export function authorizeAny(
  required: Array<{ resource: string; action: string }>,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!canAny(req.user.permissions, required)) {
      const label = required.map((r) => `${r.resource}:${r.action}`).join(" or ");
      return next(ApiError.forbidden(`Missing permission ${label} for this action`));
    }
    next();
  };
}

/**
 * Allows a user through when they're acting on their own record, otherwise
 * falls back to the given permission (e.g. reading your own profile vs.
 * reading anyone's).
 */
export function authorizeSelfOr(resource: string, action: string, paramName = "id"): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.params[paramName] === req.user.id) return next();
    if (!can(req.user.permissions, resource, action)) {
      return next(ApiError.forbidden(`Missing permission "${resource}:${action}" for this action`));
    }
    next();
  };
}
