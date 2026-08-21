import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";

import { buildBills } from "../services/bill.service.js";
import { absolutePathForKey, verifySignedImage } from "../services/file.service.js";
import { importWorkbook } from "../services/import.service.js";
import { ApiError } from "../utils/api-error.js";
import { ok } from "../utils/api-response.js";

/* ------------------------------------------------------------------- bills */

/**
 * Returns the fully-resolved bill payload (invoice number, prices, line items)
 * for the selected orders, in the order they were given. The PDF is rendered
 * by the frontend from this — the backend owns the data, the frontend owns the
 * presentation.
 */
export async function generateBills(req: Request, res: Response) {
  const { orderIds } = req.body as { orderIds: string[] };
  return ok(res, await buildBills(orderIds));
}

/* ------------------------------------------------------------------ import */

export async function uploadWorkbook(req: Request, res: Response) {
  if (!req.file) throw ApiError.badRequest("No workbook uploaded");
  const name = req.file.originalname.toLowerCase();
  if (!/\.(xlsx|xlsm|xls)$/.test(name)) {
    throw ApiError.badRequest("Upload an Excel workbook (.xlsx, .xlsm or .xls)");
  }
  return ok(res, await importWorkbook(req.file.buffer));
}

/* ------------------------------------------------------------------- files */

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
};

/**
 * Serves a shop image against a short-lived signed URL rather than a bearer
 * token, because an `<img src>` can't carry an Authorization header. The
 * signature covers both the key and the expiry, so a link can't be edited to
 * reach another file or to live longer.
 */
export async function serveShopImage(req: Request, res: Response) {
  const key = `${req.params.shopId}/${req.params.filename}`;
  verifySignedImage(key, String(req.query.expires ?? ""), String(req.query.signature ?? ""));

  const absolute = absolutePathForKey(key);
  if (!existsSync(absolute)) throw ApiError.notFound("Image not found");

  const ext = path.extname(absolute).slice(1).toLowerCase();
  res.setHeader("content-type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  res.setHeader("cache-control", "private, max-age=3600");
  createReadStream(absolute).pipe(res);
}
