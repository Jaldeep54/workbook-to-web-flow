import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { env, fileUrlSecret } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/api-error.js";

/**
 * Shop photos live on disk (or any mounted volume) under UPLOAD_DIR, keyed by
 * `<shopId>/<timestamp>-<filename>` — the same key shape the Supabase Storage
 * bucket used, so migrated `image_path` values keep working.
 *
 * They are not publicly served. An `<img>` tag can't send an Authorization
 * header, so reads go through a short-lived HMAC-signed URL (the direct
 * equivalent of the signed URLs this replaced): the API hands out
 * `/files/shop-images/<key>?expires=…&signature=…`, and the file route
 * verifies it before streaming anything.
 */
const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "heic", "heif"];
const ACCEPTED_MIME = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/octet-stream",
];

export const SHOP_IMAGE_DIR = "shop-images";

export function uploadRoot(): string {
  return path.resolve(process.cwd(), env.UPLOAD_DIR);
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(-100);
}

function extensionOf(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext && ACCEPTED_EXTENSIONS.includes(ext) ? ext : null;
}

/** Blocks path traversal — keys are always `<segment>/<segment>`. */
function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(key) || key.includes("..")) {
    throw ApiError.badRequest("Invalid file key");
  }
}

export function absolutePathForKey(key: string): string {
  assertSafeKey(key);
  const resolved = path.resolve(uploadRoot(), SHOP_IMAGE_DIR, key);
  if (!resolved.startsWith(path.resolve(uploadRoot(), SHOP_IMAGE_DIR))) {
    throw ApiError.badRequest("Invalid file key");
  }
  return resolved;
}

export async function saveShopImage(
  shopId: string,
  file: { originalname: string; mimetype: string; buffer: Buffer },
): Promise<string> {
  const ext = extensionOf(file.originalname);
  if (!ext) throw ApiError.badRequest("Unsupported file type — use JPG, PNG, HEIC or HEIF");
  if (!ACCEPTED_MIME.includes(file.mimetype)) {
    throw ApiError.badRequest(`Unsupported content type "${file.mimetype}"`);
  }

  const key = `${shopId}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
  const target = absolutePathForKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, file.buffer);
  return key;
}

/** Best-effort delete — a missing file never fails the caller's action. */
export async function deleteShopImage(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    const target = absolutePathForKey(key);
    if (existsSync(target)) await unlink(target);
  } catch (error) {
    logger.warn(`Could not delete shop image "${key}":`, error);
  }
}

function signature(key: string, expires: number): string {
  return createHmac("sha256", fileUrlSecret).update(`${key}:${expires}`).digest("hex");
}

export function signedImagePath(key: string, ttlSeconds = env.FILE_URL_TTL_SECONDS): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const params = new URLSearchParams({ expires: String(expires), signature: signature(key, expires) });
  return `${env.API_PREFIX}/files/${SHOP_IMAGE_DIR}/${key}?${params.toString()}`;
}

export function verifySignedImage(key: string, expires: string, provided: string): void {
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) {
    throw ApiError.unauthorized("This file link has expired");
  }
  const expected = Buffer.from(signature(key, expiresAt));
  const actual = Buffer.from(String(provided ?? ""));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw ApiError.unauthorized("Invalid file signature");
  }
}
