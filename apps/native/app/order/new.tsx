import { useLocalSearchParams } from "expo-router";
import { isOrderType, type OrderType } from "@repo/core";
import { Header, QueryView, Screen } from "@/components";
import { useVoucher } from "@/data/queries";
import { InvoiceForm } from "@/forms/InvoiceForm";

/**
 * New estimate, sales order, delivery challan or purchase order.
 * /order/new?type=sales-order&from=<estimateId> fills it in from another document.
 */
export default function NewOrderScreen() {
  const { type, from, partyId } = useLocalSearchParams<{
    type?: string;
    from?: string;
    partyId?: string;
  }>();
  const kind: OrderType = type && isOrderType(type) ? type : "estimate";
  const source = useVoucher(from ?? "");
  if (!from) return <InvoiceForm kind={kind} initialPartyId={partyId} />;
  if (source.data)
    return <InvoiceForm kind={kind} source={source.data.voucher} />;
  return (
    <Screen header={<Header close title="New document" />}>
      <QueryView query={source}>{() => null}</QueryView>
    </Screen>
  );
}
