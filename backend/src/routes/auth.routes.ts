import { Router } from "express";

import * as controller from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/authenticate.js";
import { authRateLimiter } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/async-handler.js";
import {
  changePasswordSchema,
  loginSchema,
  updateProfileSchema,
} from "../validators/auth.validator.js";

const router = Router();

router.post("/login", authRateLimiter, validate({ body: loginSchema }), asyncHandler(controller.login));
router.post("/refresh", asyncHandler(controller.refresh));
router.post("/logout", asyncHandler(controller.logout));

router.get("/me", authenticate, asyncHandler(controller.me));
router.patch(
  "/me",
  authenticate,
  validate({ body: updateProfileSchema }),
  asyncHandler(controller.updateProfile),
);
router.get("/permissions", authenticate, asyncHandler(controller.myPermissions));
router.post(
  "/change-password",
  authenticate,
  authRateLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(controller.changePassword),
);

export default router;
