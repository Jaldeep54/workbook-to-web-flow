import { Router } from "express";
import mongoose from "mongoose";

import { serveShopImage } from "../controllers/misc.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ok } from "../utils/api-response.js";
import authRoutes from "./auth.routes.js";
import {
  billRouter,
  cashPositionRouter,
  costRouter,
  dashboardRouter,
  deliveryRouter,
  importRouter,
  labelOrderRouter,
  labelProductRouter,
  labelStockRouter,
  orderRouter,
  paymentRouter,
  productRouter,
  shopAreaRouter,
  shopRouter,
} from "./domain.routes.js";
import { permissionRouter, roleRouter, userRouter } from "./rbac.routes.js";

/**
 * The API surface.
 *
 * Only three things are reachable without a token: the health check, login,
 * and the signed image URLs (which carry their own HMAC — an `<img>` tag can't
 * send an Authorization header). Everything else sits behind `authenticate`
 * and then a per-route permission check.
 */
const router = Router();

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const state = mongoose.connection.readyState;
    return ok(res, {
      status: state === 1 ? "ok" : "degraded",
      database: ["disconnected", "connected", "connecting", "disconnecting"][state] ?? "unknown",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }),
);

router.use("/auth", authRoutes);
router.get("/files/shop-images/:shopId/:filename", asyncHandler(serveShopImage));

router.use(authenticate);

router.use("/users", userRouter);
router.use("/roles", roleRouter);
router.use("/permissions", permissionRouter);

router.use("/shops", shopRouter);
router.use("/shop-areas", shopAreaRouter);
router.use("/products", productRouter);
router.use("/label-products", labelProductRouter);
router.use("/orders", orderRouter);
router.use("/deliveries", deliveryRouter);
router.use("/payments", paymentRouter);
router.use("/label-orders", labelOrderRouter);
router.use("/labels", labelStockRouter);
router.use("/costs", costRouter);
router.use("/cash-position", cashPositionRouter);
router.use("/dashboard", dashboardRouter);
router.use("/bills", billRouter);
router.use("/import", importRouter);

export default router;
