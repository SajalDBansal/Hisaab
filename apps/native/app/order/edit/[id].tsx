import { useLocalSearchParams } from "expo-router";
import { isOrderType } from "@repo/core";
import { Header, QueryView, Screen } from "@/components";
import { useVoucher } from "@/data/queries";
import { InvoiceForm } from "@/forms/InvoiceForm";

/** Edit an open estimate or order. */
export default function EditOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const voucher = useVoucher(id);
  const v = voucher.data?.voucher;
  if (v && isOrderType(v.type))
    return <InvoiceForm kind={v.type} editing={v} />;
  return (
    <Screen header={<Header close title="Edit" />}>
      <QueryView query={voucher}>{() => null}</QueryView>
    </Screen>
  );
}
