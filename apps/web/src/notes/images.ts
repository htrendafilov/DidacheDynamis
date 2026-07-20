const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_STORED_BYTES = 3 * 1024 * 1024;
const MAX_DIMENSION = 1600;

export class NoteImageError extends Error {
  constructor(public readonly code: "type" | "size" | "decode" | "encode") {
    super(`Note image error: ${code}`);
  }
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new NoteImageError("decode"));
    reader.readAsDataURL(file);
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new NoteImageError("encode"))),
      type,
      quality,
    );
  });
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new NoteImageError("decode");
    }
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new NoteImageError("decode"));
    };
    image.src = url;
  });
}

export async function prepareNoteImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new NoteImageError("type");
  if (file.size > MAX_SOURCE_BYTES) throw new NoteImageError("size");

  // Preserve animated GIFs rather than flattening them, but keep them tightly bounded.
  if (file.type === "image/gif") {
    if (file.size > MAX_STORED_BYTES) throw new NoteImageError("size");
    return fileToDataUrl(file);
  }

  const image = await decodeImage(file);
  const width = "naturalWidth" in image ? image.naturalWidth : image.width;
  const height = "naturalHeight" in image ? image.naturalHeight : image.height;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new NoteImageError("encode");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if ("close" in image && typeof image.close === "function") image.close();

  const outputType = file.type === "image/png" ? "image/png" : "image/webp";
  const output = await canvasBlob(canvas, outputType, outputType === "image/webp" ? 0.82 : undefined);
  if (output.size > MAX_STORED_BYTES) throw new NoteImageError("size");
  return fileToDataUrl(output);
}
