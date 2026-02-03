/**
 * Phone: turning printable HTML into a PDF file and sending it.
 * expo-print makes the PDF, expo-sharing opens the share sheet (WhatsApp, email, Drive …).
 * The web version is print.web.ts.
 */
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";

export { whatsappText } from "./whatsapp";

/** "SI/26-27/0025 Sharma Electricals.pdf" → "SI-26-27-0025_Sharma_Electricals.pdf" */
const plainName = (fileName: string) =>
  fileName
    .replace(/\.pdf$/i, "")
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) + ".pdf";

/**
 * Write the PDF into the app's own cache folder under a readable name.
 *
 * Why not share expo-print's file directly? It saves into a folder the share sheet
 * may not read ("Not allowed to read file under given URL", seen in Expo Go).
 * The app's cache folder (Paths.cache) is always readable, so the PDF bytes are
 * written there instead of moving the file.
 */
function writePdf(base64: string, fileName: string): string {
  const file = new File(Paths.cache, plainName(fileName));
  if (file.exists) file.delete();
  file.create();
  file.write(base64, { encoding: "base64" });
  return file.uri;
}

/** Make a PDF from the HTML and open the share sheet with it. */
export async function sharePdf(html: string, fileName: string, title: string) {
  const pdf = await Print.printToFileAsync({ html, base64: true });
  if (!pdf.base64) throw new Error("Couldn't make the PDF. Please try again.");
  const uri = writePdf(pdf.base64, fileName);
  if (!(await Sharing.isAvailableAsync())) {
    await Share.share({ url: uri, title });
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: title,
  });
}

/** Open the system print dialog (printer, or Save as PDF). */
export function printHtml(html: string) {
  return Print.printAsync({ html });
}
