export type CropArea = { x: number; y: number; width: number; height: number };

function blobFromCanvas(canvas: HTMLCanvasElement, type = "image/jpeg"): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This image could not be exported. Please try another image.")), type, 0.92));
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This image could not be opened. Choose another JPEG, PNG or WebP."));
    image.src = url;
  });
}

/** Bake EXIF orientation into pixels before the cropper and export see the image. */
export async function prepareCropImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap | null = null;
  let temporary: string | null = null;
  try {
    let source: CanvasImageSource;
    let width: number, height: number;
    if (typeof createImageBitmap !== "undefined") {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      source = bitmap; width = bitmap.width; height = bitmap.height;
    } else {
      temporary = URL.createObjectURL(file);
      const image = await loadImage(temporary); // Modern browsers apply EXIF to HTML images.
      source = image; width = image.naturalWidth; height = image.naturalHeight;
    }
    if (!width || !height || width * height > 60_000_000) throw new Error("Choose an image smaller than 60 megapixels.");
    const scale = Math.min(1, 4096 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image editing is unavailable in this browser.");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await blobFromCanvas(canvas);
  } finally { bitmap?.close(); if (temporary) URL.revokeObjectURL(temporary); }
}

export function cropOutputSize(area: CropArea, kind: "avatar" | "cover") {
  // The area may start outside the photo (negative x/y) when it was zoomed out to fit entirely.
  if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.width < 1 || area.height < 1) throw new Error("Choose a valid crop area.");
  const ratio = kind === "avatar" ? 1 : 3;
  // High-density output, bounded to the selected area; never upscale beyond it.
  const width = Math.max(ratio, Math.floor(Math.min(kind === "avatar" ? 1024 : 1800, area.width, area.height * ratio) / ratio) * ratio);
  return { width, height: width / ratio };
}

/** Smallest zoom that still shows the whole photo inside the frame (below 100% for wide/tall photos). */
export function fitZoom(imageWidth: number, imageHeight: number, kind: "avatar" | "cover") {
  if (!imageWidth || !imageHeight) return 1;
  const image = imageWidth / imageHeight;
  const frame = kind === "avatar" ? 1 : 3;
  return Math.min(1, image / frame, frame / image);
}

export async function exportCrop(url: string, area: CropArea, kind: "avatar" | "cover"): Promise<File> {
  const image = await loadImage(url);
  const size = cropOutputSize(area, kind);
  const canvas = document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image editing is unavailable in this browser.");
  const ratio = kind === "avatar" ? 1 : 3;
  const width = Math.min(area.width, area.height * ratio), height = width / ratio;
  const x = area.x + (area.width - width) / 2, y = area.y + (area.height - height) / 2;
  const scale = size.width / width;
  const outside = x < 0 || y < 0 || x + width > image.naturalWidth || y + height > image.naturalHeight;
  if (outside) {
    // Empty edges (photo zoomed out to fit): fill them with a soft, blurred copy of the photo.
    context.fillStyle = "#eef1f5";
    context.fillRect(0, 0, size.width, size.height);
    if ("filter" in context) {
      const cover = Math.max(size.width / image.naturalWidth, size.height / image.naturalHeight) * 1.15;
      context.filter = `blur(${Math.round(size.width / 18)}px) brightness(0.92)`;
      context.drawImage(image, (size.width - image.naturalWidth * cover) / 2, (size.height - image.naturalHeight * cover) / 2, image.naturalWidth * cover, image.naturalHeight * cover);
      context.filter = "none";
    }
  }
  // Draw the whole photo positioned relative to the frame; the canvas clips whatever lies outside.
  context.drawImage(image, -x * scale, -y * scale, image.naturalWidth * scale, image.naturalHeight * scale);
  const blob = await blobFromCanvas(canvas);
  return new File([blob], `${kind}-${Date.now()}.jpg`, { type: "image/jpeg" });
}
