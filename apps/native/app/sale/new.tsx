import { useLocalSearchParams } from "expo-router";
import { Header, QueryView, Screen } from "@/components";
import { useVoucher } from "@/data/queries";
import { InvoiceForm } from "@/forms/InvoiceForm";

/**
 * New sale bill. ?partyId=… pre-selects the party;
 * ?from=<orderId> fills it in from an estimate / order and marks that as converted.
 */
export default function NewSaleScreen() {
  const { partyId, from } = useLocalSearchParams<{
    partyId?: string;
    from?: string;
  }>();
  const source = useVoucher(from ?? "");
  if (!from) return <InvoiceForm kind="sale" initialPartyId={partyId} />;
  if (source.data)
    return <InvoiceForm kind="sale" source={source.data.voucher} />;
  return (
    <Screen header={<Header close title="New bill" />}>
      <QueryView query={source}>{() => null}</QueryView>
    </Screen>
  );
}
