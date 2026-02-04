// Keep small images at their original size and preserve the document's aspect ratio.
export function imageSize(width: number, height: number, longest = 2560) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("This image has invalid dimensions.");
  if (width * height > 40_000_000)
    throw new Error("Choose an image under 40 megapixels.");
  const scale = Math.min(1, longest / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
