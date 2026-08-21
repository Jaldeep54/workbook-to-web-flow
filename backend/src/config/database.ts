import mongoose from "mongoose";

import { env, isTest } from "./env.js";
import { logger } from "./logger.js";

/**
 * Single shared Mongoose connection. Every model is registered against the
 * default connection, so nothing else in the codebase touches the driver.
 */
export async function connectDatabase(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  // Model-level indexes are created explicitly by ensureIndexes() (or the
  // seed) rather than implicitly on first use, so a slow index build can never
  // surprise a request in production.
  mongoose.set("autoIndex", false);

  const connection = await mongoose.connect(uri, {
    dbName: env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });

  if (!isTest) {
    logger.info(`MongoDB connected: ${connection.connection.host}/${connection.connection.name}`);
  }

  mongoose.connection.on("error", (error) => logger.error("MongoDB connection error:", error));
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));

  return connection;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
}

/** Builds every declared index. Safe to run repeatedly (idempotent). */
export async function ensureIndexes(): Promise<void> {
  const models = mongoose.modelNames().map((name) => mongoose.model(name));
  for (const model of models) {
    await model.createIndexes();
  }
  if (!isTest) logger.info(`Indexes ensured for ${models.length} collections`);
}

/**
 * Transactions require a replica set. A standalone mongod (the common local
 * setup) doesn't support them, so multi-document writes fall back to running
 * without a session rather than failing outright.
 */
export async function supportsTransactions(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const info = (await admin.command({ hello: 1 })) as { setName?: string; msg?: string };
    return Boolean(info.setName) || info.msg === "isdbgrid";
  } catch {
    return false;
  }
}
