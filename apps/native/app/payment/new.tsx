import { useLocalSearchParams } from "expo-router";
import { MoneyForm } from "@/forms/MoneyForm";

/** Pay a supplier (with optional TDS). Open with ?partyId=… to pre-select the supplier. */
export default function NewPaymentScreen() {
  const { partyId } = useLocalSearchParams<{ partyId?: string }>();
  return <MoneyForm kind="payment" initialPartyId={partyId} />;
}
