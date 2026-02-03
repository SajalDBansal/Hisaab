import { Linking, Share } from "react-native";

/**
 * Open WhatsApp with the text typed in, to an Indian mobile number.
 * Text only: WhatsApp links can't carry a file. Falls back to the share sheet.
 */
export async function whatsappText(phone: string | undefined, text: string) {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (!digits) {
    const result = await Share.share({ message: text });
    return result.action !== Share.dismissedAction;
  }
  if (!/^[1-9]\d{9,14}$/.test(digits))
    throw new Error("Add a valid mobile number to the party first.");
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    const result = await Share.share({ message: text });
    return result.action !== Share.dismissedAction;
  }
}
