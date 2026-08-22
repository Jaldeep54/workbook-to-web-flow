import type { Request, Response } from "express";

import { buildBills } from "../services/bill.service.js";
import { openShopImage, verifySignedImage } from "../services/file.service.js";
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

/**
 * Serves a shop image against a short-lived signed URL rather than a bearer
 * token, because an `<img src>` can't carry an Authorization header. The
 * signature covers both the key and the expiry, so a link can't be edited to
 * reach another file or to live longer.
 */
export async function serveShopImage(req: Request, res: Response) {
  const key = `${req.params.shopId}/${req.params.filename}`;
  verifySignedImage(key, String(req.query.expires ?? ""), String(req.query.signature ?? ""));

  const { stream, contentType } = await openShopImage(key);
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "private, max-age=3600");
  stream.pipe(res);
}
