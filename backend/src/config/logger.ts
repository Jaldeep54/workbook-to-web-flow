import { env } from "./env.js";

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;
const active = LEVELS[env.LOG_LEVEL];

function emit(level: keyof typeof LEVELS, args: unknown[]) {
  if (LEVELS[level] > active) return;
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  if (level === "error") console.error(prefix, ...args);
  else if (level === "warn") console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

export const logger = {
  error: (...args: unknown[]) => emit("error", args),
  warn: (...args: unknown[]) => emit("warn", args),
  info: (...args: unknown[]) => emit("info", args),
  debug: (...args: unknown[]) => emit("debug", args),
};
