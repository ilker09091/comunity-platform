/** Longest side a chat photo needs; phones shoot 4000px+ which only slows the upload. */
const MAX_SIDE = 2560;
/** Small photos are already fine to send as they are. */
const SMALL_BYTES = 900 * 1024;

/**
 * Shrinks a photo on the device before upload (like WhatsApp), keeping its orientation and
 * transparency. Anything that cannot be decoded here (GIF, HEIC on some browsers) is returned
 * unchanged, and so is the original whenever re-encoding would not make it smaller.
 */
export async function compressImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap === "undefined") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SMALL_BYTES) return file;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    // JPEG has no transparency, so PNG/WebP (screenshots, stickers) stay WebP.
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.86 : 0.9));
    if (!blob || blob.type !== type || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + (type === "image/jpeg" ? ".jpg" : ".webp");
    return new File([blob], name, { type, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
