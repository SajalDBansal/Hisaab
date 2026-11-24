import { useLocalSearchParams } from "expo-router";
import { MoneyForm } from "@/forms/MoneyForm";

/** Receive money from a customer. Open with ?partyId=… to pre-select the customer. */
export default function NewReceiptScreen() {
  const { partyId, refund } = useLocalSearchParams<{
    partyId?: string;
    refund?: string;
  }>();
  // ?refund=1: a supplier pays back our unused credit (doc 37, T05).
  return (
    <MoneyForm kind="receipt" initialPartyId={partyId} refund={!!refund} />
  );
}
