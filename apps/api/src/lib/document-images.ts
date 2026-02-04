import sharp from "sharp";
import { AppError } from "@repo/backend/lib/app-error";

let processing = 0;

// Decode and re-encode actual pixels; EXIF location data and untrusted metadata are discarded.
export async function documentImages(bytes: Uint8Array) {
  if (processing >= 2)
    throw new AppError(
      "IMAGE_BUSY",
      "Image processing is busy. Please retry the upload.",
      503,
    );
  processing++;
  try {
    const full = await sharp(bytes, {
      limitInputPixels: 40_000_000,
      failOn: "warning",
    })
      .rotate()
      .flatten({ background: "white" })
      .resize(2560, 2560, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .timeout({ seconds: 10 })
      .toBuffer();
    const thumbnail = await sharp(full)
      .resize(320, 320, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 60, mozjpeg: true })
      .toBuffer();
    return { full, thumbnail };
  } catch {
    throw new AppError(
      "INVALID_IMAGE",
      "This image cannot be processed. Choose a JPG or PNG under 40 megapixels.",
      422,
    );
  } finally {
    processing--;
  }
}
