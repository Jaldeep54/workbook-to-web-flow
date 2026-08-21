import rateLimit from "express-rate-limit";

import { env, isTest } from "../config/env.js";

const shared = {
  standardHeaders: true as const,
  legacyHeaders: false,
  // The suite hammers the same endpoints from one address on purpose; limiting
  // there would test the limiter instead of the API.
  skip: () => isTest,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many requests, please try again later" },
  },
};

/** Baseline limit for the whole API. */
export const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  ...shared,
});

/** Tighter limit on credential endpoints to blunt password guessing. */
export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  skipSuccessfulRequests: true,
  ...shared,
});
