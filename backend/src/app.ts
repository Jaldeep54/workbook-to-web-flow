import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import morgan from "morgan";

import { corsOrigins, env, isTest } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { apiRateLimiter } from "./middleware/rate-limit.js";
import routes from "./routes/index.js";

/**
 * The Express app, kept separate from server.ts so tests can mount it against
 * an in-memory MongoDB without binding a port.
 */
export function createApp(): Express {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      // Credentials are on (the refresh cookie), so the allowed origins are an
      // explicit list — never a reflected wildcard.
      origin(origin, callback) {
        if (!origin || corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (!isTest) app.use(morgan("tiny"));
  app.use(env.API_PREFIX, apiRateLimiter, routes);

  app.get("/", (_req, res) => {
    res.json({
      success: true,
      data: { name: "Klinzo Operations API", version: "1.0.0", docs: `${env.API_PREFIX}/health` },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
