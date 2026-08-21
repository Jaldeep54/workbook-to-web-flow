import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase, ensureIndexes } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

/** Process entry point: connect, build indexes, listen, and shut down cleanly. */
async function main() {
  await connectDatabase();
  await ensureIndexes();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Klinzo Operations API listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Don't let a hung connection keep the process alive forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection:", reason));
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception:", error);
    process.exit(1);
  });
}

main().catch((error) => {
  logger.error("Failed to start the API:", error);
  process.exit(1);
});
