import { useLocalSearchParams } from "expo-router";
import { MoneyForm } from "@/forms/MoneyForm";

/** Receive money from a customer. Open with ?partyId=… to pre-select the customer. */
export default function NewReceiptScreen() {
  const { partyId } = useLocalSearchParams<{ partyId?: string }>();
  return <MoneyForm kind="receipt" initialPartyId={partyId} />;
}
