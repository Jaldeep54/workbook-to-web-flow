/** Shop photo storage helpers. Images live in the private "shop-images" bucket, one path per shop. */
import { supabase } from "@/integrations/supabase/client";

export const SHOP_IMAGE_BUCKET = "shop-images";

const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "heic", "heif"];
export const SHOP_IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif";

export function isHeicPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "heic" || ext === "heif";
}

function extensionOf(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext && ACCEPTED_EXTENSIONS.includes(ext) ? ext : null;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(-100);
}

/** Uploads a shop photo and returns the storage path to save on the shop record. */
export async function uploadShopImage(shopId: string, file: File): Promise<string> {
  const ext = extensionOf(file.name);
  if (!ext) {
    throw new Error("Unsupported file type — use JPG, PNG, HEIC or HEIF.");
  }
  const path = `${shopId}/${Date.now()}-${sanitizeFilename(file.name)}`;
  const { error } = await supabase.storage.from(SHOP_IMAGE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  return path;
}

/** Best-effort delete — never blocks the caller on failure (e.g. path already gone). */
export async function deleteShopImage(path: string): Promise<void> {
  try {
    await supabase.storage.from(SHOP_IMAGE_BUCKET).remove([path]);
  } catch {
    // ignore — orphaned storage objects aren't worth failing the user's action over
  }
}

/** Signed URL for viewing a private shop image. */
export async function getShopImageUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(SHOP_IMAGE_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
