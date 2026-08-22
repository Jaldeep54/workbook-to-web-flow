import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import mongoose from "mongoose";

import { env, fileUrlSecret } from "../config/env.js";
import { logger } from "../config/logger.js";
import { ApiError } from "../utils/api-error.js";

/**
 * Shop photos are keyed by `<shopId>/<timestamp>-<filename>` — the same key
 * shape the Supabase Storage bucket used, so migrated `image_path` values keep
 * working — and stored through one of two backends, chosen by FILE_STORAGE:
 *
 *  - "disk"   — written under UPLOAD_DIR. The default for a server with a
 *               persistent volume.
 *  - "gridfs" — written into MongoDB. The default on a serverless platform,
 *               where the filesystem is read-only and nothing written to /tmp
 *               survives the next request.
 *
 * Either way they are not publicly served. An `<img>` tag can't send an
 * Authorization header, so reads go through a short-lived HMAC-signed URL (the
 * direct equivalent of the signed URLs this replaced): the API hands out
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

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
};

export const SHOP_IMAGE_DIR = "shop-images";

/** GridFS bucket name — mirrors the on-disk folder so the two are recognisable. */
const BUCKET = "shop_images";

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

export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
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

function bucket(): InstanceType<typeof mongoose.mongo.GridFSBucket> {
  const db = mongoose.connection.db;
  if (!db) throw ApiError.internal("Database connection is not ready");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET });
}

/* ---------------------------------------------------------------- writing */

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

  if (env.FILE_STORAGE === "gridfs") {
    assertSafeKey(key);
    const upload = bucket().openUploadStream(key, {
      contentType: contentTypeForKey(key),
      metadata: { shopId },
    });
    await new Promise<void>((resolve, reject) => {
      upload.once("finish", () => resolve());
      upload.once("error", reject);
      upload.end(file.buffer);
    });
    return key;
  }

  const target = absolutePathForKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, file.buffer);
  return key;
}

/** Best-effort delete — a missing file never fails the caller's action. */
export async function deleteShopImage(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    if (env.FILE_STORAGE === "gridfs") {
      assertSafeKey(key);
      const gridfs = bucket();
      // A key is unique in practice (it carries a millisecond timestamp), but
      // delete every match rather than assuming there is exactly one.
      for await (const file of gridfs.find({ filename: key })) {
        await gridfs.delete(file._id);
      }
      return;
    }

    const target = absolutePathForKey(key);
    if (existsSync(target)) await unlink(target);
  } catch (error) {
    logger.warn(`Could not delete shop image "${key}":`, error);
  }
}

/* ---------------------------------------------------------------- reading */

/**
 * Opens a stored image for streaming. The caller has already verified the
 * signature; this only resolves the key to bytes.
 */
export async function openShopImage(key: string): Promise<{ stream: Readable; contentType: string }> {
  assertSafeKey(key);

  if (env.FILE_STORAGE === "gridfs") {
    const gridfs = bucket();
    const [file] = await gridfs.find({ filename: key }).sort({ uploadDate: -1 }).limit(1).toArray();
    if (!file) throw ApiError.notFound("Image not found");
    return {
      stream: gridfs.openDownloadStream(file._id) as unknown as Readable,
      contentType: file.contentType ?? contentTypeForKey(key),
    };
  }

  const absolute = absolutePathForKey(key);
  if (!existsSync(absolute)) throw ApiError.notFound("Image not found");
  return { stream: createReadStream(absolute), contentType: contentTypeForKey(key) };
}

/* ------------------------------------------------------------ signed URLs */

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
