import mongoose from "mongoose";

import { connectDatabase, disconnectDatabase, ensureIndexes } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ADMIN_ROLE_SLUG } from "../models/role.model.js";
import { User, hashPassword } from "../models/user.model.js";
import { seedCatalogue } from "./catalogue.seed.js";
import { seedPermissions, seedRoles } from "./permissions.seed.js";

/**
 * Bootstraps a usable system: the permission catalogue, the Admin role (plus
 * two example roles), the administrator account, and the product/label
 * catalogue.
 *
 * Safe to re-run. `--reset` drops the platform collections first (permissions,
 * roles, users) and is refused outright in production, where dropping the
 * administrator table by accident is not a recoverable mistake.
 */
export async function runSeed(options: { reset?: boolean } = {}): Promise<void> {
  if (options.reset) {
    if (env.NODE_ENV === "production") {
      throw new Error("Refusing to run a reset seed against a production database");
    }
    logger.warn("Reset requested — dropping permissions, roles, users and refresh tokens");
    await Promise.all(
      ["permissions", "roles", "users", "refresh_tokens"].map((name) =>
        mongoose.connection.collection(name).deleteMany({}),
      ),
    );
  }

  const permissionIdByName = await seedPermissions();
  const roleIdBySlug = await seedRoles(permissionIdByName);
  await seedCatalogue();

  const adminRoleId = roleIdBySlug.get(ADMIN_ROLE_SLUG);
  if (!adminRoleId) throw new Error("Admin role was not created");

  const existing = await User.findOne({ email: env.ADMIN_EMAIL.toLowerCase() });
  if (existing) {
    // Keep the account usable on re-seed (role and active flag), but never
    // silently reset a password an administrator may have changed.
    existing.role = adminRoleId;
    existing.isActive = true;
    await existing.save();
    logger.info(`Administrator already present: ${existing.email} (role refreshed)`);
  } else {
    await User.create({
      email: env.ADMIN_EMAIL.toLowerCase(),
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      fullName: env.ADMIN_FULL_NAME,
      role: adminRoleId,
      isActive: true,
    });
    logger.info(`Administrator created: ${env.ADMIN_EMAIL}`);
  }
}

/** CLI entry point: `npm run seed` / `npm run seed:reset`. */
const isDirectRun = process.argv[1]?.includes("seeds");
if (isDirectRun) {
  const reset = process.argv.includes("--reset");
  connectDatabase()
    .then(ensureIndexes)
    .then(() => runSeed({ reset }))
    .then(() => {
      logger.info("Seed complete");
      return disconnectDatabase();
    })
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error("Seed failed:", error);
      process.exit(1);
    });
}
