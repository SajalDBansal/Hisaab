import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** The API accepts data URIs up to this many characters (about 150 KB). */
const LIMIT = 200_000;

/**
 * Pick an image and shrink it into a PNG (keeps transparent signatures and
 * stamps) or, if that is still too big, a JPEG data URI (doc 37, T16).
 * Returns null when the user cancels.
 */
export async function pickBrandingImage(
  maxWidth: number,
): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  for (const [format, width, compress] of [
    [SaveFormat.PNG, maxWidth, 1],
    [SaveFormat.JPEG, maxWidth, 0.8],
    [SaveFormat.JPEG, Math.round(maxWidth / 2), 0.7],
  ] as const) {
    const context = ImageManipulator.manipulate(asset.uri);
    try {
      if (asset.width > width) context.resize({ width });
      const rendered = await context.renderAsync();
      try {
        const saved = await rendered.saveAsync({
          format,
          compress,
          base64: true,
        });
        const mime = format === SaveFormat.PNG ? "image/png" : "image/jpeg";
        const uri = saved.base64 ? `data:${mime};base64,${saved.base64}` : "";
        if (uri && uri.length <= LIMIT) return uri;
      } finally {
        rendered.release();
      }
    } finally {
      context.release();
    }
  }
  throw new Error(
    "That image is too large even after shrinking. Try a smaller one.",
  );
}
