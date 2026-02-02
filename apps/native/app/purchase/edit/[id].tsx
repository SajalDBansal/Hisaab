import { useLocalSearchParams } from "expo-router";
import { Header, QueryView, Screen } from "@/components";
import { useVoucher } from "@/data/queries";
import { InvoiceForm } from "@/forms/InvoiceForm";

/** Edit a saved purchase bill: same form, filled in; number and date stay the same. */
export default function EditPurchaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const voucher = useVoucher(id);
  if (voucher.data)
    return <InvoiceForm kind="purchase" editing={voucher.data.voucher} />;
  return (
    <Screen header={<Header close title="Edit bill" />}>
      <QueryView query={voucher}>{() => null}</QueryView>
    </Screen>
  );
}
