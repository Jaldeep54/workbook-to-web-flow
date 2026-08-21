/**
 * Shop photo helpers.
 *
 * Uploading and deleting are API calls (`shopsApi.uploadImage` /
 * `removeImage`); the browser never talks to a storage service directly. What
 * lives here is the client-side validation that keeps an obviously wrong file
 * from being uploaded at all, plus the HEIC check the preview needs — browsers
 * can't render HEIC, so those are shown as a "view original" link instead.
 */
const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "heic", "heif"];

export const SHOP_IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif";

export function isHeicPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "heic" || ext === "heif";
}

export function isHeicFile(file: File): boolean {
  return isHeicPath(file.name);
}

export function isAcceptedImage(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return Boolean(ext && ACCEPTED_EXTENSIONS.includes(ext));
}
