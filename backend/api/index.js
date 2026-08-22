import mongoose from "mongoose";

import { createApp } from "../dist/app.js";
import { connectDatabase } from "../dist/config/database.js";

/**
 * Vercel entry point for the Klinzo Operations API.
 *
 * `src/server.ts` is still the entry point everywhere else — it owns the
 * listening socket and the shutdown handlers, neither of which exists on a
 * serverless platform. Here the platform owns the socket and hands us one
 * request at a time, so all this file has to do is make sure a database
 * connection and an Express app exist before delegating.
 *
 * Both are cached on the module, which survives between invocations that land
 * on the same warm instance: a cold start pays for one connection, every later
 * request on that instance pays for none. `ensureIndexes()` is deliberately
 * *not* called — index builds belong to `npm run seed`, not to whichever
 * unlucky request happens to trigger a cold start.
 */
let app;
let connecting;

async function ready() {
  if (mongoose.connection.readyState === 1) return;
  // A failed connection must not be cached, or the instance stays broken for
  // the rest of its life.
  connecting ??= connectDatabase().catch((error) => {
    connecting = undefined;
    throw error;
  });
  await connecting;
}

/**
 * Rebuilds the path Express expects.
 *
 * `vercel.json` rewrites `/api/(?<rest>.*)` here and passes the captured tail
 * as a `rest` query parameter, because the rewrite is free to hand us the
 * destination path (`/api`) rather than the one the browser asked for. Express
 * routes on `/api/v1/...`, so put that back and drop the marker — anything
 * else in the query string is the caller's and stays untouched.
 *
 * A file-based catch-all would be the obvious alternative, but Vercel matches
 * `api/[...slug].js` against a single path segment, so `/api/v1/health` never
 * reaches it.
 */
function restorePath(req) {
  const url = new URL(req.url, "http://localhost");
  const rest = url.searchParams.get("rest");
  if (rest === null) return;
  url.searchParams.delete("rest");
  const query = url.searchParams.toString();
  req.url = `/api/${rest}${query ? `?${query}` : ""}`;
}

export default async function handler(req, res) {
  restorePath(req);
  await ready();
  app ??= createApp();
  return app(req, res);
}
