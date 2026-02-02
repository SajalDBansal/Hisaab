import { InvoiceList } from "@/lists/InvoiceList";

/** All purchase bills with status filters. */
export default function PurchasesScreen() {
  return <InvoiceList kind="purchase" />;
}
