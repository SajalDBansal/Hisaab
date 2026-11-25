import { useLocalSearchParams } from "expo-router";
import { MoneyForm } from "@/forms/MoneyForm";

/** Pay a supplier (with optional TDS). Open with ?partyId=… to pre-select the supplier. */
export default function NewPaymentScreen() {
  const { partyId, refund } = useLocalSearchParams<{
    partyId?: string;
    refund?: string;
  }>();
  // ?refund=1: pay a customer back their unused credit (doc 37, T05).
  return (
    <MoneyForm kind="payment" initialPartyId={partyId} refund={!!refund} />
  );
}
