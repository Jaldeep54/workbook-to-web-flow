import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 doesn't forward rejected promises to the error middleware — every
 * async route handler is wrapped in this so a thrown ApiError (or any bug)
 * always lands in one place.
 */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
