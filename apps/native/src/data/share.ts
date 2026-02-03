import { Linking } from "react-native";
import { showError } from "@/components";
import { useMarkReminderSent, usePrepareReminder } from "./queries";
import { confirmAction } from "./confirm";
import { whatsappText } from "./whatsapp";

/**
 * WhatsApp payment reminder: the message lists the open bills and the firm's UPI id,
 * and WhatsApp opens on the party's number with it typed in.
 */
export function useSendReminder() {
  const prepare = usePrepareReminder();
  const markSent = useMarkReminderSent();
  return async (partyId: string) => {
    try {
      const r = await prepare.mutateAsync(partyId);
      const opened = await whatsappText(r.phone, r.text);
      if (!opened) return;
      confirmAction(
        "Reminder sent?",
        "Mark this reminder only after sending the message in WhatsApp.",
        "Mark sent",
        () => {
          markSent.mutate(partyId, {
            onError: (e) => showError("Couldn't record reminder", e),
          });
        },
      );
    } catch (e) {
      showError("Couldn't send reminder", e);
    }
  };
}

/** Opens the dialer. */
export function callPhone(phone: string) {
  return Linking.openURL(`tel:${phone.replace(/\s/g, "")}`);
}

/** Opens a WhatsApp chat (India +91 numbers). */
export function openWhatsApp(phone: string) {
  return Linking.openURL(`https://wa.me/91${phone.replace(/\s/g, "")}`);
}
